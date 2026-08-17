/**
 * Everything the dashboard renders, in one request: agent settings, LinkedIn
 * connection health, the approval queue, recent history, the rejection log,
 * LLM budget, and any ambiguous sends awaiting a human.
 */
import { NextResponse } from "next/server";
import { getAccountStatus } from "../../../lib/accounts";
import { getPrimaryAgent } from "../../../lib/agents";
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
import { formatInZone } from "../../../lib/schedule";
import { PRESETS } from "../../../lib/style";

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
  };
}

const POST_COLUMNS = `id, seq, text, rationale, status, kind, category, scores_json,
                      sources_json, media_json, hashtags_json, continuity, used_quote,
                      created_at, published_at`;

export async function GET() {
  try {
    const agent = await getPrimaryAgent();
    if (!agent) {
      return NextResponse.json({
        initialized: false,
        config: { liveMode: liveModeEnabled(), encryptionKey: hasEncryptionKey() },
      });
    }

    const [account, queue, history, rejections, schedule, llm, ambiguous, sent] = await Promise.all([
      getAccountStatus(agent.agentId),
      query<PostRow>(
        `SELECT ${POST_COLUMNS} FROM posts
          WHERE agent_id = $1 AND status IN ('draft', 'approved', 'failed', 'unknown')
          ORDER BY created_at DESC LIMIT 20`,
        [agent.agentId],
      ),
      query<PostRow>(
        `SELECT ${POST_COLUMNS} FROM posts
          WHERE agent_id = $1 AND status = 'published'
          ORDER BY published_at DESC NULLS LAST, seq DESC LIMIT 20`,
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
      sendsToday(agent.agentId),
    ]);

    const nextRunAt = schedule[0]?.next_run_at ?? null;

    return NextResponse.json({
      initialized: true,
      agent,
      account,
      config: {
        liveMode: liveModeEnabled(),
        encryptionKey: hasEncryptionKey(),
        memoryDegraded: memoryDegraded(),
        maxAutoCap: MAX_AUTO_CAP,
        presets: Object.entries(PRESETS).map(([id, p]) => ({
          id,
          label: p.label,
          blurb: p.blurb,
          style: p.style,
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
