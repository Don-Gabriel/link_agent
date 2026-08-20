/**
 * Everything the dashboard renders, in one request: agent settings, LinkedIn
 * connection health, the approval queue, recent history, the rejection log,
 * LLM budget, and any ambiguous sends awaiting a human.
 */
import { NextResponse } from "next/server";
import { getAccountStatus } from "../../../lib/accounts";
import { getPrimaryAgent } from "../../../lib/agents";
import { ALL_CATEGORY_IDS, CATEGORIES } from "../../../lib/categories";
import { hasEncryptionKey } from "../../../lib/crypto";
import { query } from "../../../lib/db";
import {
  LINKEDIN_DAILY_REQUESTS,
  MANUAL_DAILY_CAP,
  MAX_AUTO_CAP,
  liveModeEnabled,
  listAmbiguousSends,
  sendsToday,
} from "../../../lib/distribute";
import { hookOf } from "../../../lib/format";
import { getTodayCalls } from "../../../lib/llm";
import { memoryDegraded } from "../../../lib/memory";
import { describeDays, formatInZone } from "../../../lib/schedule";
import {
  ensureSlotsMigrated,
  listSlots,
  MAX_LEAD_MINUTES,
  MAX_SLOTS,
  MIN_LEAD_MINUTES,
  MISSED_AFTER_MINUTES,
  schedulerHealth,
  slotTimeline,
} from "../../../lib/slots";
import { MAX_HASHTAGS, PRESETS } from "../../../lib/style";

export const dynamic = "force-dynamic";

interface PostRow {
  id: string;
  seq: number;
  text: string;
  rationale: string;
  status: string;
  kind: string;
  category: string | null;
  scores_json: Record<string, number> | null;
  sources_json: string[];
  media_json: string[];
  hashtags_json: string[];
  continuity: string | null;
  used_quote: boolean;
  created_at: Date;
  published_at: Date | null;
  scheduled_for: Date | null;
  slot_id: string | null;
  cleared_at: Date | null;
  hold_until: Date | null;
}

function serializePost(r: PostRow) {
  return {
    id: r.id,
    seq: r.seq,
    text: r.text,
    hook: hookOf(r.text),
    rationale: r.rationale,
    status: r.status,
    kind: r.kind,
    category: r.category,
    scores: r.scores_json,
    sources: r.sources_json ?? [],
    media: r.media_json ?? [],
    hashtags: r.hashtags_json ?? [],
    continuity: r.continuity,
    usedQuote: r.used_quote,
    createdAt: r.created_at.toISOString(),
    publishedAt: r.published_at?.toISOString() ?? null,
    // Scheduling. `scheduledFor` null means the post is not on the timetable
    // and will only ever go out if a human sends it by hand.
    scheduledFor: r.scheduled_for?.toISOString() ?? null,
    slotId: r.slot_id,
    clearedAt: r.cleared_at?.toISOString() ?? null,
    // Only reported while genuinely in effect, so the client never has to work
    // out whether an expired hold still counts.
    heldUntil:
      r.hold_until && r.hold_until.getTime() > Date.now() ? r.hold_until.toISOString() : null,
  };
}

const POST_COLUMNS = `id, seq, text, rationale, status, kind, category, scores_json,
                      sources_json, media_json, hashtags_json, continuity, used_quote,
                      created_at, published_at, scheduled_for, slot_id, cleared_at, hold_until`;

export async function GET() {
  try {
    const agent = await getPrimaryAgent();
    if (!agent) {
      return NextResponse.json({
        initialized: false,
        config: { liveMode: liveModeEnabled(), encryptionKey: hasEncryptionKey() },
      });
    }

    const [
      slots,
      account,
      posts,
      rejections,
      schedule,
      llm,
      ambiguous,
      sent,
      timeline,
      scheduler,
    ] = await Promise.all([
      // Migrating a pre-slots agent used to be AWAITED before this batch, which
      // cost a whole extra round trip on every single request to a database
      // that is not in the same country — for a check that has been a no-op
      // since the first time it ran. It needs the agent id and nothing else, so
      // it belongs in the fan-out.
      ensureSlotsMigrated(
        agent.agentId,
        agent.postTimeLocal,
        agent.timezone,
        agent.autoPublish,
      ).catch((err) => {
        console.warn("[status] slot migration skipped:", err);
        return [];
      }),
      getAccountStatus(agent.agentId),
      // Ordered by when it GOES OUT rather than when it was written: with
      // several drafts waiting at once, the one with the nearest deadline is
      // the one that needs reading. Unscheduled drafts sort last.
      // Queue and history in ONE round trip. Two queries over the same table,
      // differing only in which statuses they want, cost two trips to a
      // database that is not in the same country; this fetches both windows at
      // once and splits them below.
      query<PostRow>(
        `(SELECT ${POST_COLUMNS} FROM posts
           WHERE agent_id = $1 AND status IN ('draft', 'approved', 'failed', 'unknown', 'missed')
           ORDER BY scheduled_for ASC NULLS LAST, created_at DESC LIMIT 20)
         UNION ALL
         (SELECT ${POST_COLUMNS} FROM posts
           WHERE agent_id = $1 AND status = 'published'
           ORDER BY published_at DESC NULLS LAST, seq DESC LIMIT 20)`,
        [agent.agentId],
      ),
      query<{ title: string; url: string; reason: string; scores_json: Record<string, number>; created_at: Date }>(
        `SELECT title, url, reason, scores_json, created_at FROM rejections
          WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 15`,
        [agent.agentId],
      ),
      query<{ last_run_at: Date | null; next_run_at: Date | null; cycle_count: number }>(
        "SELECT last_run_at, next_run_at, cycle_count FROM scheduler_state WHERE agent_id = $1",
        [agent.agentId],
      ),
      getTodayCalls().catch(() => []),
      listAmbiguousSends(agent.agentId),
      sendsToday(agent.agentId, agent.timezone),
      slotTimeline(agent.agentId, 7),
      schedulerHealth(),
    ]);

    // Split the single posts fetch back into its two windows.
    const queue = posts.filter((p) => p.status !== "published");
    const history = posts.filter((p) => p.status === "published");

    // The next run comes from the SLOTS, not from scheduler_state. That row's
    // next_run_at was derived from the legacy agents.post_time_local, which
    // slots replaced — so it reported a confident time for a schedule nothing
    // was reading, and the dashboard showed an hour that matched no slot the
    // user had ever set. It is now written as NULL and this reads the real one.
    const nextSlotRun = slots
      .filter((s) => s.enabled && s.nextRunAt)
      .map((s) => new Date(s.nextRunAt!))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const nextRunAt = nextSlotRun ?? null;

    return NextResponse.json({
      initialized: true,
      agent,
      account,
      config: {
        liveMode: liveModeEnabled(),
        encryptionKey: hasEncryptionKey(),
        memoryDegraded: memoryDegraded(),
        maxAutoCap: MAX_AUTO_CAP,
        maxHashtags: MAX_HASHTAGS,
        presets: Object.entries(PRESETS).map(([id, p]) => ({
          id,
          label: p.label,
          blurb: p.blurb,
          style: p.style,
        })),
        // Served rather than hardcoded per client. Both the Flutter app and the
        // web dashboard used to carry their own id -> label maps, so adding a
        // category meant editing three files and an unlisted id rendered as a
        // raw slug like "compute-silicon" until someone noticed.
        categories: ALL_CATEGORY_IDS.map((id) => ({
          id,
          label: CATEGORIES[id].label,
          blurb: CATEGORIES[id].blurb,
        })),
      },
      // Two separate allowances, reported separately — conflating them is what
      // made a day of manual posting look like the agent was out of budget.
      budget: {
        autoUsed: sent.auto,
        autoCap: agent.autoPublishCap,
        manualUsed: sent.manual,
        manualCap: MANUAL_DAILY_CAP,
        linkedinDailyRequests: LINKEDIN_DAILY_REQUESTS,
      },
      schedule: {
        lastRunAt: schedule[0]?.last_run_at?.toISOString() ?? null,
        nextRunAt: nextRunAt?.toISOString() ?? null,
        nextRunLocal: nextRunAt ? formatInZone(nextRunAt, agent.timezone) : null,
        cycleCount: schedule[0]?.cycle_count ?? 0,
      },
      // The timetable, and what each slot actually did over the last week —
      // including the days it stayed silent, which is what stops a deliberate
      // silence from looking like a broken cron.
      slots: slots.map((s) => ({
        ...s,
        daysLabel: describeDays(s.daysMask),
        nextRunLocal: s.nextRunAt ? formatInZone(new Date(s.nextRunAt), agent.timezone) : null,
      })),
      timeline,
      // Whether the cron is alive at all. Without this, a stopped scheduler and
      // a day when nothing cleared the bar look identical from the app.
      scheduler,
      slotLimits: {
        maxSlots: MAX_SLOTS,
        minLeadMinutes: MIN_LEAD_MINUTES,
        maxLeadMinutes: MAX_LEAD_MINUTES,
        missedAfterMinutes: MISSED_AFTER_MINUTES,
      },
      queue: queue.map(serializePost),
      history: history.map(serializePost),
      rejections: rejections.map((r) => ({
        title: r.title,
        url: r.url,
        reason: r.reason,
        scores: r.scores_json,
        createdAt: r.created_at.toISOString(),
      })),
      llm,
      ambiguous,
    });
  } catch (err) {
    console.error("[status] failed:", err);
    return NextResponse.json(
      { error: "status_failed", detail: String((err as Error)?.message ?? err).slice(0, 200) },
      { status: 500 },
    );
  }
}
