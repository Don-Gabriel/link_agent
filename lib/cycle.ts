import { withAgentUsage } from './ai-usage';
/**
 * One cycle, end to end:
 *   discover -> recall memory -> judge (1 LLM call, batched) ->
 *   persist rejections -> [write (1 LLM call) -> save draft] ->
 *   record episodes.
 *
 * Runs behind a Postgres advisory lock (transaction-scoped, so it survives
 * Neon's pgbouncer pooling and is released even if the process dies) — the
 * cron ticks and any manual trigger all pass through here, so overlapping
 * triggers can never double-fire.
 *
 * The important difference from the feed-publishing original: a cycle produces
 * a DRAFT. It no longer publishes anything at all. That used to happen inline
 * here when auto_publish was set, which meant the moment a post was written was
 * also the moment it was sent — leaving no window in which a human could read
 * it. Sending is now a separate pass (publishDuePosts in lib/distribute.ts)
 * driven by the post's own scheduled_for, and the gap between the two is the
 * review window that lib/slots.ts exists to create.
 *
 * A failed cycle is a logged non-event: it never throws, never corrupts state,
 * and the next slot tries again.
 */
import {
  getAgentSettings,
  getPersona,
  refreshPersonaIfStale,
  voiceReferencesFor,
  type AgentSettings,
} from "./agents";
import type { CategoryId } from "./categories";
import { getPool, query } from "./db";
import { discover } from "./discovery";
import { hookOf } from "./format";
import { judgeCandidates, PUBLISH_THRESHOLD } from "./judge";
import { diverseWinner, rotateCategories } from './editorial-selection';
import { notify } from "./push";
import { formatInZone } from "./schedule";
import { recall, rememberPublish, rememberRejections } from "./memory";
import { nextDailyRun } from "./schedule";
import {
  claimSlotRun,
  listDueSlots,
  rescheduleSlot,
  settleSlotRun,
  withSlotLock,
  type DueSlot,
} from "./slots";

import { writePost, type PriorPost } from "./writer";

/** Nothing published in this long widens discovery (more sources, higher caps). */
const STALE_HOURS = 48;
/** A cycle that found nothing usable retries this soon rather than losing the day. */
const RETRY_MINUTES = 120;

export interface CycleResult {
  agentId: string;
  ran: boolean;
  drafted: boolean;
  /** Always false now — cycles draft, they never send. Kept so callers and logs
   *  that read this field do not silently break. */
  published: boolean;
  postId?: string;
  seq?: number;
  skippedReason?: string;
  stats?: { n: number; min: number; max: number; mean: number };
  servedBy?: string[];
}

/** What a slot contributes to a cycle: its categories, and where the post lands. */
export interface CycleContext {
  onProgress?: (stage: 'discovering' | 'judging' | 'writing' | 'saving') => Promise<void>;
  reviewDate?: string;
  suppressNotification?: boolean;
  /** Overrides the agent's categories when non-empty. */
  categories?: CategoryId[];
  slotId?: string;
  slotDate?: string;
  /** Stamped onto the draft as posts.scheduled_for — when it should go out. */
  scheduledFor?: Date;
}

/**
 * Record that a cycle ran. Bumps last_run_at and the counter, nothing else.
 *
 * It used to also write scheduler_state.next_run_at, computed from the legacy
 * agents.post_time_local — a column slots replaced and nothing consults any
 * more. So the dashboard cheerfully displayed a "next run" that no longer
 * corresponded to anything: a time derived from a dead setting, for a scheduler
 * that had stopped reading it. next_run_at is now cleared, and the real answer
 * comes from the slots themselves.
 */
async function recordCycleRan(agentId: string): Promise<void> {
  await query(
    `INSERT INTO scheduler_state (agent_id, last_run_at, next_run_at, cycle_count)
     VALUES ($1, now(), NULL, 1)
     ON CONFLICT (agent_id) DO UPDATE
       SET last_run_at = now(), next_run_at = NULL,
           cycle_count = scheduler_state.cycle_count + 1`,
    [agentId],
  );
}

/** The cycle body. Assumes the advisory lock is already held. */
async function runCycle(agentId: string, context: CycleContext = {}): Promise<CycleResult> {
  const servedBy: string[] = [];
  const settings = await getAgentSettings(agentId);
  if (!settings) return { agentId, ran: false, drafted: false, published: false, skippedReason: "unknown_agent" };
  if (settings.paused) {
    // Still reschedule, so unpausing does not require a manual kick.
    await recordCycleRan(agentId);
    return { agentId, ran: false, drafted: false, published: false, skippedReason: "paused" };
  }

  // The identity is derived from the categories, so it is rebuilt here if they
  // have moved since it was last built. Doing it at the top of the cycle rather
  // than in the settings handler means a run of category taps costs one rebuild
  // instead of one per tap, and the rebuild lands before the prompts that read it.
  await refreshPersonaIfStale(agentId);

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

  // 1. Discover. A slot may narrow the agent's categories to its own — that is
  // what stops three posts a day all sounding like the same beat — but it can
  // never widen them beyond what the agent is watching.
  const slotCategories = (context.categories ?? []).filter((c) => settings.categories.includes(c));
  const activeCategories = slotCategories.length > 0 ? slotCategories : settings.categories;
  const coverage = await query<{category:CategoryId|null;seq:number}>(
    'SELECT category,seq FROM posts WHERE agent_id=$1 ORDER BY seq DESC LIMIT 24', [agentId]);
  const recentCategories = coverage.flatMap(r=>r.category?[r.category]:[]);

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

  await context.onProgress?.('discovering');
  const discovered = await discover({categories:rotateCategories(activeCategories,recentCategories),wide:staleFeed,
    topics:persona.identity.interests,rotation:coverage[0]?.seq??0,excludeUrls:[...usedUrls,...cooldownUrls]});

  const candidates = discovered.filter((c) => !usedUrls.has(c.url) && !cooldownUrls.has(c.url));
  console.log(
    `[cycle] agent=${agentId} pool: ${discovered.length} discovered, ${discovered.length - candidates.length} filtered, ${candidates.length} to judge`,
  );

  if (candidates.length === 0) {
    await recordCycleRan(agentId);
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
  //
  // The recent category mix goes in with them. Judging every candidate purely
  // on its own merits reads well in isolation and narrows the profile over
  // time: whichever category yields the strongest stories takes every cycle.
  // Drafts count, not just published posts — a draft has already consumed the
  // subject whether or not the author ever approved it.

  await context.onProgress?.('judging');
  const judged = await judgeCandidates(
    persona,
    activeCategories,
    candidates,
    judgeMemory,
    priorFingerprints,
    recentCategories,
  );
  if (!judged.ok) {
    console.warn(`[cycle] agent=${agentId} judging failed: ${judged.reason}`);
    await recordCycleRan(agentId);
    // A mechanical failure, not a quiet day. "below_threshold" and
    // "no_candidates" are deliberately NOT reported: a silent day is correct
    // behaviour, and an alert for it would train you to ignore the ones that
    // are not.
    await notify(agentId, { kind: "cycle_failed", detail: `judge:${judged.reason}` });
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

  const winner = diverseWinner(scored,activeCategories,recentCategories);
  const rejected = winner ? scored.filter(candidate=>candidate!==winner) : scored;

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
    await recordCycleRan(agentId);
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

  // Few-shot voice references, from the same helper the composer's rewrite and
  // the voice preview use. They were separate before, and the composer's copy
  // simply did not exist — so "Rewrite with AI" ran on the style toggles alone
  // and ignored the author's samples entirely.
  const voice = await voiceReferencesFor(settings);

  // The signature ration counts PUBLISHED posts only. Counting drafts would let
  // a quote in something the author discarded consume the budget, silently
  // suppressing the signature for days afterwards.
  const quotesInLastFivePublished = (
    await query<{ used_quote: boolean }>(
      `SELECT used_quote FROM posts
        WHERE agent_id = $1 AND status = 'published'
        ORDER BY published_at DESC NULLS LAST, seq DESC
        LIMIT 5`,
      [agentId],
    )
  ).filter((r) => r.used_quote).length;

  const runnersUp = scored.filter(candidate => candidate !== winner).slice(0, 2);
  await context.onProgress?.('writing');
  const draft = await writePost({
    persona,
    style: settings.style,
    winner,
    runnersUp,
    memory: writeMemory,
    priorPosts,
    samples: voice.samples,
    editNotes: voice.editNotes,
    publishedQuotesInLastFive: quotesInLastFivePublished,
  });

  if (!draft.ok) {
    console.warn(`[cycle] agent=${agentId} writing failed: ${draft.reason}`);
    await recordCycleRan(agentId);
    return { agentId, ran: true, drafted: false, published: false, skippedReason: `writer:${draft.reason}`, stats, servedBy };
  }
  if (draft.data.servedBy) servedBy.push(draft.data.servedBy);

  await context.onProgress?.('saving');
  const inserted = await query<{ id: string; seq: number }>(
    `INSERT INTO posts (agent_id, seq, text, rationale, sources_json, fingerprint, scores_json,
                        continuity, cycle_id, status, kind, category, hashtags_json, used_quote,
                        slot_id, scheduled_for, review_date,slot_date)
     SELECT $1, byline_next_seq($1), $2, $3, $4, $5, $6, $7, $8, 'draft', 'auto', $9, $10, $11,
            $12, $13, $14,$15
     ON CONFLICT(agent_id,slot_id,slot_date) WHERE slot_date IS NOT NULL
       DO UPDATE SET slot_date=EXCLUDED.slot_date
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
      context.slotId ?? null,
      context.scheduledFor?.toISOString() ?? null,
      context.reviewDate ?? null,
      context.slotDate ?? null,
    ],
  );
  const postId = inserted[0]?.id;
  const seq = inserted[0]?.seq;

  // NOTE: nothing is published here, deliberately. This used to auto-publish
  // inline, which collapsed writing and sending into one instant and left no
  // window to read the draft. Sending is now publishDuePosts() in
  // lib/distribute.ts, driven by the scheduled_for stamped just above.
  console.log(
    context.scheduledFor
      ? `[cycle] agent=${agentId} ${postId} drafted for ${context.scheduledFor.toISOString()}`
      : `[cycle] agent=${agentId} ${postId} drafted — unscheduled, waiting in the queue`,
  );

  // 6. Editorial memory — the publish episode carries intent.
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

  await recordCycleRan(agentId);

  // Announced from HERE rather than from the cron route, so every path that
  // produces a draft says so: the scheduled tick, "Run a cycle now" from the
  // phone, and a forced single-agent run. It was wired into the tick alone,
  // which meant the one case where somebody was definitely holding the phone
  // and waiting — pressing the button — was the one case that stayed silent.
  //
  // The hook, not the post: a notification is a reason to open the app, not a
  // place to read a draft.
  if (seq !== undefined && !context.suppressNotification) {
    await notify(agentId, {
      kind: "draft_ready",
      seq,
      hook: hookOf(draft.data.text).slice(0, 120),
      at: context.scheduledFor ? formatInZone(context.scheduledFor, settings.timezone) : null,
    });
  }

  console.log(
    `[cycle] agent=${agentId} scored n=${stats.n} min=${stats.min} max=${stats.max} mean=${stats.mean} drafted=${postId} servedBy=${servedBy.join(",") || "n/a"}`,
  );
  return { agentId, ran: true, drafted: true, published: false, postId, seq, stats, servedBy };
}

/**
 * Advisory-locked wrapper. Uses a transaction-scoped lock
 * (pg_try_advisory_xact_lock) on a dedicated client: safe through Neon's
 * transaction-mode pooler, and auto-released on COMMIT/ROLLBACK or death.
 * A session-scoped lock would silently not work here — do not "simplify" it.
 */
export async function runCycleWithLock(agentId: string, force = false, context: CycleContext = {}): Promise<CycleResult> {
  return withAgentUsage(agentId,()=>runCycleLocked(agentId,force,context));
}
async function runCycleLocked(agentId: string, force = false, context: CycleContext = {}): Promise<CycleResult> {
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

    const result = await runCycle(agentId, context).catch((err): CycleResult => {
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

/**
 * Generate for one due slot, under that slot's own lock.
 *
 * Order matters here and each step is load-bearing:
 *   1. A slot noticed far past its time is marked missed and rescheduled
 *      WITHOUT generating. Publishing a 09:00 thought at lunchtime is worse
 *      than staying quiet, and we would rather show you that it happened.
 *   2. The run is claimed via the (slot_id, run_date) primary key, so however
 *      many ticks overlap, a slot generates at most once per local day.
 *   3. The slot is rescheduled in a `finally`, so a crash inside the pipeline
 *      cannot leave next_run_at in the past and wedge the slot into retrying
 *      forever.
 */
/**
 * Is something already on its way out at or before this slot's moment?
 *
 * A slot exists to make sure something gets published at that time — not to
 * make sure the AGENT wrote it. If a post is already scheduled to go out by
 * then, generating another one produces two posts competing for one moment and
 * spends two LLM calls to create the problem.
 *
 * Deliberately counts only SCHEDULED posts. An unscheduled draft is not going
 * anywhere on its own, and treating it as "the queue has content" would let one
 * forgotten draft silence the agent permanently — a far worse failure than an
 * occasional extra post, and one nobody would diagnose quickly.
 */
async function queueAlreadyCovers(agentId: string, scheduledFor: Date): Promise<number | null> {
  const rows = await query<{ seq: number }>(
    `SELECT seq FROM posts
       WHERE agent_id = $1
         AND status IN ('draft', 'approved')
         AND scheduled_for IS NOT NULL
         AND scheduled_for <= $2
         AND scheduled_for > now() - interval '5 minutes'
       ORDER BY scheduled_for
       LIMIT 1`,
    [agentId, scheduledFor.toISOString()],
  );
  return rows[0]?.seq ?? null;
}

export async function runSlotCycle(due: DueSlot, manual=false): Promise<CycleResult> {
  return withAgentUsage(due.slot.agentId,()=>runSlotCycleInternal(due,manual));
}
async function runSlotCycleInternal(due: DueSlot, manual=false): Promise<CycleResult> {
  const { slot, runDate, scheduledFor } = due;
  const base: CycleResult = {
    agentId: slot.agentId,
    ran: false,
    drafted: false,
    published: false,
  };

  return withSlotLock(
    slot.id,
    async () => {
      const [existing]=await query<{seq:number}>(`SELECT seq FROM posts WHERE agent_id=$1 AND slot_id=$2 AND
        (slot_date=$3::date OR seq IN(SELECT post_seq FROM slot_runs WHERE slot_id=$2 AND run_date=$3::date)) LIMIT 1`,[slot.agentId,slot.id,runDate]);
      if(existing) {
        await settleSlotRun(slot.id,runDate,'drafted',{postSeq:existing.seq});
        await rescheduleSlot(slot,due.timezone,new Date(Math.max(Date.now(),scheduledFor.getTime())));
        return {...base,ran:true,drafted:true,seq:existing.seq};
      }
      if (!(await claimSlotRun(due,manual))) {
        return { ...base, skippedReason: "already_ran_today" };
      }

      try {
        if (due.missed && !manual) {
          await settleSlotRun(slot.id, runDate, "missed", {
            detail: `Noticed more than ${MISSED_AFTER_LABEL} after ${slot.localTime}; not published late.`,
          });
          console.warn(`[cycle] slot=${slot.id} ${slot.localTime} MISSED for ${runDate}`);
          return { ...base, skippedReason: "missed" };
        }

        // Nothing to write if something is already queued for this moment —
        // whether the author composed it by hand or an earlier run produced it.
        // Recorded as a silent slot with the reason, because the timetable
        // showing a gap it cannot explain is the thing this app refuses to do.
        const [native]=await query('SELECT 1 FROM agents WHERE id=$1 AND owner_id IS NOT NULL',[slot.agentId]);
        const covered = native ? null : await queueAlreadyCovers(slot.agentId, scheduledFor);
        if (covered !== null) {
          await settleSlotRun(slot.id, runDate, "silent", {
            detail: `Post #${covered} is already queued for this slot — nothing new was written.`,
          });
          console.log(
            `[cycle] slot=${slot.id} ${slot.localTime} already covered by p${covered} — skipping generation`,
          );
          return { ...base, ran: true, skippedReason: "queue_already_covers" };
        }

        if(process.env.BYLINE_TEST_MODE==='true') {
          const {generateSetupSample,defaultSetup}=await import('./onboarding');
          const [setup]=await query<{config:typeof defaultSetup}>(`SELECT o.config FROM onboarding o JOIN agents a ON a.owner_id=o.user_id WHERE a.id=$1`,[slot.agentId]);
          const sample=await generateSetupSample({...defaultSetup,...setup?.config});
          const [demo]=await query<{seq:number}>(`INSERT INTO posts(agent_id,seq,text,rationale,sources_json,fingerprint,status,kind,slot_id,slot_date,scheduled_for)
            VALUES($1,byline_next_seq($1),$2,'Local demonstration; no AI call',$3,$4,'draft','auto',$5,$6,$7)
            ON CONFLICT(agent_id,slot_id,slot_date) WHERE slot_date IS NOT NULL DO UPDATE SET slot_date=EXCLUDED.slot_date RETURNING seq`,
            [slot.agentId,sample.text,JSON.stringify(sample.sources),`local-slot:${slot.id}:${runDate}`,slot.id,runDate,
              manual&&scheduledFor.getTime()<=Date.now()?null:scheduledFor]);
          await settleSlotRun(slot.id,runDate,'drafted',{postSeq:demo.seq});
          return {...base,ran:true,drafted:true,seq:demo.seq};
        }
        const result = await runCycleWithLock(slot.agentId, true, {
          categories: slot.categories,
          slotId: slot.id,
          slotDate: runDate,
          scheduledFor: manual && scheduledFor.getTime()<=Date.now() ? undefined : scheduledFor,
          onProgress: async stage => {
            await query('UPDATE slot_runs SET stage=$3 WHERE slot_id=$1 AND run_date=$2',[slot.id,runDate,stage]);
          },
        });

        if (result.drafted) {
          await settleSlotRun(slot.id, runDate, "drafted", { postSeq: result.seq });
        } else if (result.skippedReason === "below_threshold") {
          // The silent day, made legible. Without the score the app can only
          // show a gap, which is indistinguishable from a broken cron.
          await settleSlotRun(slot.id, runDate, "silent", {
            detail: result.stats
              ? `Nothing cleared ${PUBLISH_THRESHOLD} — best was ${result.stats.max} across ${result.stats.n} candidates.`
              : "Nothing cleared the threshold.",
          });
        } else {
          await settleSlotRun(slot.id, runDate, "failed", { detail: result.skippedReason });
        }
        return result;
      } finally {
        const [run]=await query<{outcome:string;attempts:number}>(
          'SELECT outcome,attempts FROM slot_runs WHERE slot_id=$1 AND run_date=$2',[slot.id,runDate]);
        const retry=run && ['failed','silent'].includes(run.outcome) && run.attempts<3 && scheduledFor.getTime()>Date.now();
        if(!retry)await rescheduleSlot(slot, due.timezone, new Date(Math.max(Date.now(), scheduledFor.getTime()))).catch((err) =>
          console.error(`[cycle] slot=${slot.id} reschedule failed:`, err),
        );
      }
    },
    { ...base, skippedReason: "locked" },
  );
}

const MISSED_AFTER_LABEL = "45 minutes";

/**
 * The generation pass: every slot whose review window has opened.
 *
 * Serialized rather than parallel, matching the tick's existing reasoning —
 * cycles share a per-model LLM rate limit, so running them concurrently just
 * produces 429s and a cascade down to the weaker models.
 */
export async function runDueSlots(): Promise<CycleResult[]> {
  const due = await listDueSlots();
  const results: CycleResult[] = [];
  for (const item of due) {
    results.push(
      await runSlotCycle(item).catch((err): CycleResult => {
        console.error(`[cycle] slot=${item.slot.id} crashed:`, err);
        return {
          agentId: item.slot.agentId,
          ran: true,
          drafted: false,
          published: false,
          skippedReason: String(err),
        };
      }),
    );
  }
  return results;
}

