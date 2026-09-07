/**
 * Everything the dashboard renders, in one request: agent settings, LinkedIn
 * connection health, the approval queue, recent history, the rejection log,
 * LLM budget, and any ambiguous sends awaiting a human.
 */
import { NextResponse } from "next/server";
import { getAccountStatus } from "../../../lib/accounts";

import { getRequestAgent } from "../../../lib/request-agent";
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
import { POST_COLUMNS, serializePost, type PostRow } from "../../../lib/post-view";
import { getTodayCalls } from "../../../lib/llm";
import { memoryDegraded } from "../../../lib/memory";
import { describeDays, formatInZone, localClock } from "../../../lib/schedule";
import {
  ensureSlotsMigrated,
  listSlots,
  MAX_LEAD_MINUTES,
  MAX_SLOTS,
  MIN_LEAD_MINUTES,
  MISSED_AFTER_MINUTES,
  schedulerHealth,
  slotTimeline,
  watchdogHealth,
} from "../../../lib/slots";
import { MAX_HASHTAGS, PRESETS } from "../../../lib/style";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const agent = await getRequestAgent();
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
      watchdog,
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
           ORDER BY scheduled_for ASC NULLS LAST, created_at DESC)
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
      watchdogHealth(),
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

    const [review] = await query<{next_delivery_at:Date|null;config:unknown}>(`SELECT o.next_delivery_at,o.config FROM onboarding o JOIN agents a ON a.owner_id=o.user_id WHERE a.id=$1`,[agent.agentId]);
    const [dailyPost] = review ? await query<PostRow>(`SELECT ${POST_COLUMNS} FROM posts WHERE agent_id=$1 AND review_date=$2`,[agent.agentId,localClock(agent.timezone).date]) : [];
    return NextResponse.json({
      reviewDelivery: review ? {nextDeliveryAt:review.next_delivery_at?.toISOString()??null,config:review.config,post:dailyPost ? serializePost(dailyPost) : null,testMode:process.env.BYLINE_TEST_MODE==='true'} : null,
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
          groupLabel: CATEGORIES[id].groupLabel,
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
      // And whether the thing that watches the cron is alive. It runs on GitHub
      // Actions, which disables scheduled workflows in a repository with no
      // commits for 60 days — so the safety net can be switched off by a quiet
      // couple of months with nothing anywhere saying so. A stale timestamp
      // here is the only visible symptom.
      watchdog,
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
