/**
 * One daily cycle, end to end:
 *   discover -> recall memory -> judge (1 LLM call, batched) ->
 *   persist rejections -> [write (1 LLM call) -> save draft] ->
 *   optionally publish -> schedule tomorrow -> record episodes.
 *
 * Runs behind a Postgres advisory lock (transaction-scoped, so it survives
 * Neon's pgbouncer pooling and is released even if the process dies) — the
 * cron ticks and any manual trigger all pass through here, so overlapping
 * triggers can never double-fire.
 *
 * The important difference from the feed-publishing original: a cycle produces
 * a DRAFT. Whether that draft reaches LinkedIn is a separate decision, made by
 * the agent's auto_publish flag, and the publish itself is guarded again by
 * its own idempotency key in lib/distribute.ts. A failed cycle is a logged
 * non-event: it never throws, never corrupts state, and tomorrow it tries
 * again.
 */
import { getAgentSettings, getPersona, type AgentSettings } from "./agents";
import { getPool, query } from "./db";
import { discover } from "./discovery";
import { publishPost } from "./distribute";
import { judgeCandidates, PUBLISH_THRESHOLD } from "./judge";
import { recall, rememberPublish, rememberRejections } from "./memory";
import { nextDailyRun } from "./schedule";
import { writePost, type PriorPost } from "./writer";

/** Nothing published in this long widens discovery (more sources, higher caps). */
const STALE_HOURS = 48;
/** A cycle that found nothing usable retries this soon rather than losing the day. */
const RETRY_MINUTES = 120;

export interface CycleResult {
  agentId: string;
  ran: boolean;
  drafted: boolean;
  published: boolean;
  postId?: string;
  skippedReason?: string;
  stats?: { n: number; min: number; max: number; mean: number };
  servedBy?: string[];
}

async function scheduleNext(
  agentId: string,
  settings: AgentSettings,
  options: { retrySoon?: boolean } = {},
): Promise<void> {
  const next = options.retrySoon
    ? new Date(Date.now() + RETRY_MINUTES * 60_000)
    : nextDailyRun(settings.timezone, settings.postTimeLocal);
  await query(
    `INSERT INTO scheduler_state (agent_id, last_run_at, next_run_at, cycle_count)
     VALUES ($1, now(), $2, 1)
     ON CONFLICT (agent_id) DO UPDATE
       SET last_run_at = now(), next_run_at = $2, cycle_count = scheduler_state.cycle_count + 1`,
    [agentId, next.toISOString()],
  );
}

/** The cycle body. Assumes the advisory lock is already held. */
async function runCycle(agentId: string): Promise<CycleResult> {
  const servedBy: string[] = [];
  const settings = await getAgentSettings(agentId);
  if (!settings) return { agentId, ran: false, drafted: false, published: false, skippedReason: "unknown_agent" };
  if (settings.paused) {
    // Still reschedule, so unpausing does not require a manual kick.
    await scheduleNext(agentId, settings);
    return { agentId, ran: false, drafted: false, published: false, skippedReason: "paused" };
  }

  const persona = await getPersona(agentId);
  if (!persona) {
    return { agentId, ran: false, drafted: false, published: false, skippedReason: "persona_not_ready" };
  }
  const name = persona.input.name;

  // STALE GUARD: nothing written for 48h+ -> widen discovery. The threshold is
  // never lowered to force a post; the input gets fixed instead.
  const newest = await query<{ newest: Date | null }>(
    "SELECT max(created_at) AS newest FROM posts WHERE agent_id = $1",
    [agentId],
  );
  const newestAt = newest[0]?.newest?.getTime() ?? 0;
  const staleFeed = Date.now() - newestAt > STALE_HOURS * 3_600_000;
  if (staleFeed) {
    console.warn(
      `[cycle] agent=${agentId} stale (newest ${newestAt ? new Date(newestAt).toISOString() : "never"}) — widening discovery`,
    );
  }

  // 1. Discover across the agent's active categories.
  const discovered = await discover({ categories: settings.categories, wide: staleFeed });

  // Hard dedup: never re-judge a URL already written about (drafts included —
  // a rejected draft still consumed the story).
  const usedUrls = new Set(
    (
      await query<{ sources_json: string[] }>("SELECT sources_json FROM posts WHERE agent_id = $1", [
        agentId,
      ])
    ).flatMap((r) => r.sources_json ?? []),
  );

  // Rejection cooldown: a URL scored and rejected in the last 24h does not get
  // to burn a judging slot again. After 24h it may be re-judged — timeliness
  // genuinely changes.
  const cooldownUrls = new Set(
    (
      await query<{ url: string }>(
        "SELECT DISTINCT url FROM rejections WHERE agent_id = $1 AND created_at > now() - interval '24 hours'",
        [agentId],
      )
    ).map((r) => r.url),
  );

  const candidates = discovered.filter((c) => !usedUrls.has(c.url) && !cooldownUrls.has(c.url));
  console.log(
    `[cycle] agent=${agentId} pool: ${discovered.length} discovered, ${discovered.length - candidates.length} filtered, ${candidates.length} to judge`,
  );

  if (candidates.length === 0) {
    await scheduleNext(agentId, settings, { retrySoon: true });
    return { agentId, ran: true, drafted: false, published: false, skippedReason: "no_candidates" };
  }

  // 2. Recall prior coverage (Breeth, falling back to Postgres fingerprints).
  const topics = candidates.slice(0, 8).map((c) => c.title).join("; ");
  const judgeMemory = await recall(agentId, topics);
  const priorFingerprints =
    judgeMemory.source === "postgres"
      ? []
      : (
          await query<{ fingerprint: string }>(
            "SELECT fingerprint FROM posts WHERE agent_id = $1 ORDER BY seq DESC LIMIT 20",
            [agentId],
          )
        ).map((r) => r.fingerprint);

  // 3. Judge — ONE batched call for all candidates.
  const judged = await judgeCandidates(
    persona,
    settings.categories,
    candidates,
    judgeMemory,
    priorFingerprints,
  );
  if (!judged.ok) {
    console.warn(`[cycle] agent=${agentId} judging failed: ${judged.reason}`);
    await scheduleNext(agentId, settings, { retrySoon: true });
    return { agentId, ran: true, drafted: false, published: false, skippedReason: `judge:${judged.reason}` };
  }
  if (judged.data.servedBy) servedBy.push(judged.data.servedBy);
  const scored = judged.data.scored;

  const totals = scored.map((s) => s.total);
  const stats = {
    n: totals.length,
    min: Math.min(...totals),
    max: Math.max(...totals),
    mean: Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 100) / 100,
  };

  const winner = scored[0].total >= PUBLISH_THRESHOLD ? scored[0] : null;
  const rejected = winner ? scored.slice(1) : scored;

  // 4. Persist every rejection with its per-criterion scores and a reason.
  const cycleId =
    (
      await query<{ cycle_count: number }>(
        "SELECT cycle_count FROM scheduler_state WHERE agent_id = $1",
        [agentId],
      )
    )[0]?.cycle_count ?? 0;
  for (const r of rejected) {
    await query(
      `INSERT INTO rejections (agent_id, cycle_id, title, url, scores_json, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        agentId,
        cycleId + 1,
        r.title,
        r.url,
        JSON.stringify({ ...r.scores, total: r.total }),
        winner ? r.reason : `${r.reason} (top score ${r.total} below ${PUBLISH_THRESHOLD} threshold)`,
      ],
    );
  }

  if (!winner) {
    await scheduleNext(agentId, settings);
    console.log(`[cycle] agent=${agentId} nothing cleared ${PUBLISH_THRESHOLD} — silent day (max ${stats.max})`);
    return { agentId, ran: true, drafted: false, published: false, skippedReason: "below_threshold", stats, servedBy };
  }

  // 5. Write the draft.
  const writeMemory = await recall(agentId, winner.title);
  const priorRows = await query<{
    id: string;
    fingerprint: string;
    opening: string;
    used_quote: boolean;
  }>(
    `SELECT id, fingerprint, left(text, 90) AS opening, used_quote
       FROM posts WHERE agent_id = $1 ORDER BY seq DESC LIMIT 10`,
    [agentId],
  );
  const priorPosts: PriorPost[] = priorRows.map((p) => ({
    id: p.id,
    fingerprint: p.fingerprint,
    opening: p.opening,
    usedQuote: p.used_quote,
  }));

  const runnersUp = scored.slice(1, 3);
  const draft = await writePost({
    persona,
    style: settings.style,
    winner,
    runnersUp,
    memory: writeMemory,
    priorPosts,
  });

  if (!draft.ok) {
    console.warn(`[cycle] agent=${agentId} writing failed: ${draft.reason}`);
    await scheduleNext(agentId, settings, { retrySoon: true });
    return { agentId, ran: true, drafted: false, published: false, skippedReason: `writer:${draft.reason}`, stats, servedBy };
  }
  if (draft.data.servedBy) servedBy.push(draft.data.servedBy);

  const inserted = await query<{ id: string; seq: number }>(
    `INSERT INTO posts (agent_id, seq, text, rationale, sources_json, fingerprint, scores_json,
                        continuity, cycle_id, status, kind, category, hashtags_json, used_quote)
     SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3, $4, $5, $6, $7, $8, 'draft', 'auto', $9, $10, $11
       FROM posts WHERE agent_id = $1
     RETURNING id, seq`,
    [
      agentId,
      draft.data.text,
      draft.data.rationale,
      JSON.stringify([winner.url]),
      draft.data.fingerprint,
      JSON.stringify({ ...winner.scores, total: winner.total }),
      draft.data.continuity,
      cycleId + 1,
      winner.category,
      JSON.stringify(draft.data.hashtags ?? []),
      draft.data.used_quote,
    ],
  );
  const postId = inserted[0]?.id;
  const seq = inserted[0]?.seq;

  // 6. Publish, but only if the operator has handed over that decision.
  let published = false;
  if (settings.autoPublish && seq !== undefined) {
    // 'auto' — counted against the agent's own small allowance, never the
    // author's. A busy day of manual posting must not silence tomorrow's cycle.
    const result = await publishPost(agentId, seq, "auto");
    published = result.ok;
    if (!result.ok) {
      console.warn(`[cycle] agent=${agentId} ${postId} auto-publish failed: ${result.reason}`);
    }
  } else {
    console.log(`[cycle] agent=${agentId} ${postId} drafted — waiting for approval`);
  }

  // 7. Editorial memory — the publish episode carries intent.
  await rememberPublish(agentId, name, {
    title: winner.title,
    rationale: draft.data.rationale,
    runnersUp: runnersUp.map((r) => r.title),
  });
  await rememberRejections(
    agentId,
    name,
    rejected.slice(0, 3).map((r) => ({ title: r.title, reason: r.reason })),
  );

  await scheduleNext(agentId, settings);

  console.log(
    `[cycle] agent=${agentId} scored n=${stats.n} min=${stats.min} max=${stats.max} mean=${stats.mean} drafted=${postId} published=${published} servedBy=${servedBy.join(",") || "n/a"}`,
  );
  return { agentId, ran: true, drafted: true, published, postId, stats, servedBy };
}

/**
 * Advisory-locked wrapper. Uses a transaction-scoped lock
 * (pg_try_advisory_xact_lock) on a dedicated client: safe through Neon's
 * transaction-mode pooler, and auto-released on COMMIT/ROLLBACK or death.
 * A session-scoped lock would silently not work here — do not "simplify" it.
 */
export async function runCycleWithLock(agentId: string, force = false): Promise<CycleResult> {
  const pool = getPool();
  if (!pool) return { agentId, ran: false, drafted: false, published: false, skippedReason: "no_database" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock(42, hashtext($1)) AS locked",
      [agentId],
    );
    if (!lock.rows[0].locked) {
      await client.query("ROLLBACK");
      return { agentId, ran: false, drafted: false, published: false, skippedReason: "locked" };
    }

    // Re-check dueness INSIDE the lock so two ticks cannot both pass it.
    if (!force) {
      const due = await client.query(
        `SELECT 1 FROM scheduler_state s
           JOIN agents a ON a.id = s.agent_id
          WHERE s.agent_id = $1 AND a.active AND NOT a.paused
            AND (s.next_run_at IS NULL OR s.next_run_at <= now())`,
        [agentId],
      );
      if (due.rows.length === 0) {
        await client.query("ROLLBACK");
        return { agentId, ran: false, drafted: false, published: false, skippedReason: "not_due_or_paused" };
      }
    }

    const result = await runCycle(agentId).catch((err): CycleResult => {
      console.error(`[cycle] agent=${agentId} crashed:`, err);
      return { agentId, ran: true, drafted: false, published: false, skippedReason: String(err) };
    });

    await client.query("COMMIT"); // releases the advisory lock
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`[cycle] lock wrapper failed for agent=${agentId}:`, err);
    return { agentId, ran: false, drafted: false, published: false, skippedReason: String(err) };
  } finally {
    client.release();
  }
}

/** All active, unpaused agents whose cycles are due right now. */
export async function listDueAgents(): Promise<string[]> {
  const due = await query<{ id: string }>(
    `SELECT a.id FROM agents a
       LEFT JOIN scheduler_state s ON s.agent_id = a.id
      WHERE a.active AND NOT a.paused
        AND (s.agent_id IS NULL OR s.next_run_at IS NULL OR s.next_run_at <= now())
      ORDER BY a.created_at`,
  );
  return due.map((r) => r.id);
}
