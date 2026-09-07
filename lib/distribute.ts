/**
 * The publish path: a stored post -> a post on the member's LinkedIn feed.
 *
 * Everything here is built around one failure mode being much worse than the
 * others. A post that fails to publish is a nuisance you fix and retry. A post
 * that publishes TWICE is on a real person's profile in front of their
 * colleagues and cannot be quietly undone. So:
 *
 *   1. A row in `distributions` with a UNIQUE idempotency key is claimed
 *      BEFORE the API call. Only the caller that wins that insert may publish.
 *      Concurrent cron ticks, a double-clicked button and a retried request
 *      all collapse into one attempt.
 *
 *   2. Failures are split into DEFINITE and AMBIGUOUS.
 *      - Definite (LinkedIn answered with a 4xx): the post did not go out. The
 *        claim is released so a fixed retry can proceed.
 *      - Ambiguous (timeout, network error, 5xx): we do not know whether
 *        LinkedIn accepted it. The claim is KEPT FOREVER and the post is
 *        flagged for a human to check. We cannot resolve this automatically —
 *        reading your own posts back requires r_member_social, a restricted
 *        scope this app does not have — and guessing wrong means double
 *        posting.
 *
 *   3. A daily cap backstops any logic error upstream. LinkedIn's own limit is
 *      150 member requests/day; the point of a much lower cap is that if this
 *      code ever loops, it burns 3 posts and stops, not 150.
 */
import { getUsableToken, recordAccountError, recordAccountOk } from "./accounts";
import { query, getPool, ensureSchema } from "./db";
import { assemblePost, checkLength } from "./format";
import { createPost, postPermalink, type PostImage } from "./linkedin";
import { safeTimeZone } from "./schedule";
import { settleSlotRun } from "./slots";
import { MAX_HASHTAGS } from "./style";
import { refreshEditNotes } from "./voice";

/**
 * Two budgets, because the two risks are completely different.
 *
 * The AGENT publishing on its own is the dangerous one: a logic error there
 * runs unattended against a real profile, so its allowance is small and set by
 * the user (agents.auto_publish_cap, 1-3).
 *
 * A HUMAN pressing Publish has already made the decision, so the only real
 * limit is LinkedIn's: 150 requests per member per day, shared with image
 * uploads and token calls. MANUAL_DAILY_CAP is a loop-breaker well inside that
 * — it exists to catch a retry storm, not to second-guess the author.
 */
export const MANUAL_DAILY_CAP = Number(process.env.MANUAL_DAILY_CAP ?? 40);

/** LinkedIn's documented per-member ceiling, for reporting headroom. */
export const LINKEDIN_DAILY_REQUESTS = 150;

/**
 * Hard bounds on the agent's own allowance. Matches MAX_SLOTS in lib/slots.ts —
 * the cap is derived from how many slots the author actually scheduled, so the
 * two ceilings have to agree or a legal fifth slot would fail at send time.
 */
export const MAX_AUTO_CAP = 5;

export type PublishSource = "auto" | "manual";
export interface ReviewedPost {text:string;hashtags:string[];media:string[]}

export type DistributeResult =
  | { ok: true; postUrn: string; permalink: string }
  | { ok: false; reason: string; needsReauth?: boolean; ambiguous?: boolean; alreadyClaimed?: boolean };

interface PostRow {
  seq: number;
  text: string;
  status: string;
  category: string | null;
  media_json: string[];
  sources_json: string[];
  hashtags_json: string[];
  /** Joined from agents — the hashtag cap has to match what the author chose. */
  style_json: unknown;
  auto_publish_cap: number | null;
  /** Joined from agents — the cap is counted against the author's calendar day. */
  timezone: string | null;
  auto_eligible: boolean;
}

/** Publishing is disabled entirely unless this is explicitly turned on. */
export function liveModeEnabled(): boolean {
  return process.env.LINKEDIN_LIVE === "true" && process.env.BYLINE_TEST_MODE !== "true";
}

/**
 * Sends so far TODAY in the operator's own timezone, split by who initiated them.
 *
 * Deliberately a calendar day rather than a rolling 24 hours. The rolling
 * version is subtly wrong the moment more than one post is scheduled per day:
 * a post sent at 21:00 yesterday is still inside a rolling window when the
 * 09:00 slot fires this morning, so a later slot gets refused with
 * `auto_cap_reached` for no reason a human could see. "Three posts a day" means
 * three per calendar day, and the day that matters is the author's, not UTC's.
 *
 * The boundary is computed in Postgres so DST transitions are handled by the
 * timezone database rather than by arithmetic here. safeTimeZone guards the
 * input because `AT TIME ZONE` throws on an unknown zone.
 */
export async function sendsToday(
  agentId: string,
  timezone?: string | null,
): Promise<{ auto: number; manual: number }> {
  const zone = safeTimeZone(timezone);
  const rows = await query<{ source: string; n: string }>(
    `SELECT source, count(*)::text AS n FROM distributions
      WHERE agent_id = $1 AND status = 'sent'
        AND settled_at >= (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)
      GROUP BY source`,
    [agentId, zone],
  );
  const by = new Map(rows.map((r) => [r.source, Number(r.n)]));
  return { auto: by.get("auto") ?? 0, manual: by.get("manual") ?? 0 };
}

async function loadImages(mediaIds: string[], agentId: string): Promise<PostImage[]> {
  if (mediaIds.length === 0) return [];
  const rows = await query<{ id: string; linkedin_urn: string; alt_text: string | null }>(
    "SELECT id, linkedin_urn, alt_text FROM media_assets WHERE id = ANY($1::uuid[]) AND agent_id=$2 AND status = 'uploaded'",
    [mediaIds, agentId],
  );
  // Preserve the author's ordering — ANY() gives no ordering guarantee, and on
  // a multi-image post the sequence is a deliberate choice.
  const byId = new Map(rows.map((r) => [r.id, r]));
  return mediaIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ imageUrn: r.linkedin_urn, altText: r.alt_text ?? undefined }));
}

/**
 * Publish one stored post. Safe to call twice: the second call returns
 * `alreadyClaimed` without touching LinkedIn.
 */
export async function publishPost(
  agentId: string,
  seq: number,
  source: PublishSource = "manual",
  reviewed?: ReviewedPost,
): Promise<DistributeResult> {
  const rows = await query<PostRow>(
    `SELECT p.seq, p.text, p.status, p.category, p.media_json, p.sources_json, p.hashtags_json,
            a.style_json, a.auto_publish_cap, a.timezone,
            (a.active AND NOT a.paused AND p.scheduled_for <= now()
             AND (p.hold_until IS NULL OR p.hold_until <= now())
             AND (p.cleared_at IS NOT NULL OR
               (a.auto_publish AND EXISTS (SELECT 1 FROM post_slots s WHERE s.id=p.slot_id AND s.auto_publish)))) AS auto_eligible
       FROM posts p JOIN agents a ON a.id = p.agent_id
      WHERE p.agent_id = $1 AND p.seq = $2`,
    [agentId, seq],
  );
  const post = rows[0];
  if (!post) return { ok: false, reason: "post_not_found" };
  if (source === 'auto' && !post.auto_eligible) {
    return { ok: false, reason: 'The schedule, approval or pause setting changed before this send.' };
  }
  if(reviewed&&(!['draft','approved','failed','missed'].includes(post.status)||post.text!==reviewed.text||JSON.stringify(post.hashtags_json??[])!==JSON.stringify(reviewed.hashtags)||JSON.stringify(post.media_json??[])!==JSON.stringify(reviewed.media))) {
    return {ok:false,reason:'This post changed on another device. Refresh and review it again.'};
  }
  if (post.status === "published") return { ok: false, reason: "already_published", alreadyClaimed: true };
  if (!['draft', 'approved', 'failed', 'missed'].includes(post.status)) {
    return { ok: false, reason: 'This post cannot be published in its current state. Refresh and review it in My Posts.' };
  }

  // Explicit isolated testing only; this branch never calls LinkedIn.
  if (process.env.BYLINE_TEST_MODE === 'true' && process.env.BYLINE_LOCAL_ONLY === 'true') {
    await query(`UPDATE posts SET status='published',published_at=now(),rationale='Local approval simulation; not posted to LinkedIn' WHERE agent_id=$1 AND seq=$2 AND status<>'published'`,[agentId,seq]);
    return {ok:true,postUrn:`local-simulation:${agentId}:${seq}`,permalink:''};
  }

  if (!liveModeEnabled()) {
    return { ok: false, reason: "live_mode_disabled — set LINKEDIN_LIVE=true to publish for real" };
  }

  // The agent's allowance and the author's are counted separately, so a day of
  // manual posting never blocks tomorrow's scheduled one, and vice versa.
  const sent = await sendsToday(agentId, post.timezone);
  if (source === "auto") {
    const cap = Math.min(MAX_AUTO_CAP, Math.max(1, post.auto_publish_cap ?? 1));
    if (sent.auto >= cap) {
      return { ok: false, reason: `auto_cap_reached:${sent.auto}/${cap}` };
    }
  } else if (sent.manual >= MANUAL_DAILY_CAP) {
    return { ok: false, reason: `manual_cap_reached:${sent.manual}/${MANUAL_DAILY_CAP}` };
  }

  // ---- Claim the send. This insert is the concurrency control for the whole
  // feature; nothing below runs unless it succeeds.
  const idempotencyKey = `${agentId}:${seq}`;
  const claim = await query<{ id: string }>(
    `INSERT INTO distributions (agent_id, seq, idempotency_key, status, attempts, source)
     VALUES ($1, $2, $3, 'in_flight', 1, $4)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [agentId, seq, idempotencyKey, source],
  );
  if (claim.length === 0) {
    const existing = await query<{ status: string; external_urn: string | null; last_error: string | null }>(
      "SELECT status, external_urn, last_error FROM distributions WHERE idempotency_key = $1",
      [idempotencyKey],
    );
    const prior = existing[0];
    if (prior?.status === "sent" && prior.external_urn) {
      return { ok: true, postUrn: prior.external_urn, permalink: postPermalink(prior.external_urn) };
    }
    return {
      ok: false,
      alreadyClaimed: true,
      ambiguous: prior?.status === "in_flight",
      reason: `already_claimed:${prior?.status ?? "unknown"}${prior?.last_error ? ` (${prior.last_error})` : ""}`,
    };
  }
  const distributionId = claim[0].id;

  // 'in_flight' is a valid target here: an ambiguous outcome records the error
  // while deliberately KEEPING the claim, so nothing ever retries it.
  const settle = async (
    status: "sent" | "failed" | "in_flight",
    fields: { urn?: string; error?: string },
  ): Promise<void> => {
    await query(
      // settled_at stays NULL while in_flight — listAmbiguousSends finds these
      // by age, and stamping them as settled would hide them from that query.
      `UPDATE distributions
          SET status = $2, external_urn = $3, last_error = $4,
              settled_at = CASE WHEN $2 = 'in_flight' THEN NULL ELSE now() END
        WHERE id = $1`,
      [distributionId, status, fields.urn ?? null, fields.error?.slice(0, 500) ?? null],
    );
  };

  /** Definite rejection: release the claim so a corrected retry can run. */
  const releaseClaim = async (error: string): Promise<void> => {
    await query("DELETE FROM distributions WHERE id = $1", [distributionId]);
    await query("UPDATE posts SET status = 'failed' WHERE agent_id = $1 AND seq = $2", [agentId, seq]);
    console.warn(`[distribute] agent=${agentId} p${seq} definite failure, claim released: ${error}`);
  };

  const token = await getUsableToken(agentId);
  if (!token.ok) {
    await releaseClaim(`token_${token.reason}`);
    return {
      ok: false,
      reason: `linkedin_${token.reason}`,
      needsReauth: token.reason === "expired" || token.reason === "not_connected",
    };
  }

  const images = await loadImages(post.media_json ?? [], agentId);
  // A source link is worth including on a text post, but on an image post it
  // competes with the image for the reader's attention and looks like spam.
  const sourceUrl = images.length === 0 ? post.sources_json?.[0] : undefined;
  const text = assemblePost({
    body: post.text,
    sourceUrl,
    hashtags: post.hashtags_json ?? [],
    // Publish the reviewed post's tags, even if the voice has since changed.
    maxHashtags: MAX_HASHTAGS,
  });

  const length = checkLength(text);
  if (!length.withinLimit) {
    await releaseClaim(`too_long:${length.escapedChars}`);
    return { ok: false, reason: `post_too_long:${length.escapedChars}_escaped_chars` };
  }

  const created = await createPost({
    token: token.token,
    authorUrn: token.memberUrn,
    text,
    images,
  });

  if (created.ok) {
    await settle("sent", { urn: created.data.postUrn });
    await query(
      `UPDATE posts SET status = 'published', published_at = now(), linkedin_text = $3
        WHERE agent_id = $1 AND seq = $2`,
      [agentId, seq, text],
    );
    await recordAccountOk(agentId);
    // A published post the author edited is a new training pair. Refreshing
    // here rather than on a timer means the notes update exactly when new
    // evidence appears. Deliberately not awaited for its result and never
    // allowed to throw: this is an improvement to future posts, and it must not
    // be able to affect the outcome of a send that already succeeded.
    void refreshEditNotes(agentId);
    console.log(`[distribute] agent=${agentId} p${seq} published ${created.data.postUrn}`);
    return {
      ok: true,
      postUrn: created.data.postUrn,
      permalink: postPermalink(created.data.postUrn),
    };
  }

  await recordAccountError(agentId, created.reason);

  // AMBIGUOUS: no HTTP answer, or LinkedIn failed server-side. We cannot tell
  // whether the post went out, so the claim is kept and a human is asked.
  const ambiguous = created.status === undefined || created.status >= 500;
  if (ambiguous) {
    await settle("in_flight", { error: `AMBIGUOUS: ${created.reason}` });
    await query("UPDATE posts SET status = 'unknown' WHERE agent_id = $1 AND seq = $2", [agentId, seq]);
    console.error(
      `[distribute] agent=${agentId} p${seq} AMBIGUOUS outcome (${created.reason}) — not retrying; needs manual check`,
    );
    return { ok: false, ambiguous: true, reason: `ambiguous:${created.reason}`, needsReauth: created.needsReauth };
  }

  await releaseClaim(created.reason);
  return { ok: false, reason: created.reason, needsReauth: created.needsReauth };
}

// -------------------------------------------------------------- the send pass

interface DuePostRow {
  agent_id: string;
  seq: number;
  slot_id: string | null;
  scheduled_for: Date;
  run_date: Date | null;
  minutes_late: string;
}

export interface DuePublishResult {
  agentId: string;
  seq: number;
  outcome: "published" | "failed" | "missed" | "ambiguous";
  detail?: string;
}

/**
 * Publish everything whose time has come. The other half of the split that
 * lib/slots.ts creates — cycles write, this sends.
 *
 * A post qualifies only if ALL of these hold:
 *   - its scheduled_for has passed,
 *   - it is not held open in the composer,
 *   - and EITHER a human cleared it OR its slot is set to publish on its own.
 *
 * That last clause is the safety property the whole feature turns on. On a
 * hold-mode slot an unreviewed draft simply never qualifies: it does not fail,
 * it is not retried, it just waits — which is exactly what "nothing I have not
 * read reaches my profile" has to mean.
 *
 * Sends count against the AGENT's allowance even when a human pressed Clear,
 * because a cleared slot post is still part of the scheduled cadence. Only the
 * explicit "Send now" override counts as manual.
 */
export async function publishDuePosts(missedAfterMinutes = 45): Promise<DuePublishResult[]> {
  const due = await query<DuePostRow>(
    `SELECT p.agent_id, p.seq, p.slot_id, p.scheduled_for,
            r.run_date,
            EXTRACT(EPOCH FROM (now() - p.scheduled_for)) / 60 AS minutes_late
       FROM posts p
       JOIN agents a ON a.id = p.agent_id
       LEFT JOIN post_slots s ON s.id = p.slot_id
       LEFT JOIN slot_runs r ON r.slot_id = p.slot_id AND r.post_seq = p.seq
      WHERE p.scheduled_for IS NOT NULL
        AND p.scheduled_for <= now()
        AND p.status IN ('draft', 'approved', 'failed')
        AND (p.hold_until IS NULL OR p.hold_until <= now())
        -- Either a human cleared it, or BOTH switches say it may go on its own.
        --
        -- The agent-level flag is ANDed deliberately. Without it the master
        -- "publish without me" control was dead: the send pass consulted only
        -- the slot, so turning the global switch off changed nothing and the
        -- agent kept publishing. A global stop that does not stop anything is
        -- worse than no control at all.
        --
        -- Clearing still wins over both. Saying yes to a specific post is an
        -- explicit decision about that post, and a global default should not
        -- override it.
        AND (
          p.cleared_at IS NOT NULL
          OR (COALESCE(s.auto_publish, FALSE) AND a.auto_publish)
        )
        AND a.active AND NOT a.paused
      ORDER BY p.scheduled_for`,
  );

  const results: DuePublishResult[] = [];

  for (const row of due) {
    const runDate = row.run_date ? row.run_date.toISOString().slice(0, 10) : null;

    // Too late to be worth sending. This also bounds retries: a definite
    // failure leaves the post eligible on the next tick, and this window is
    // what stops that becoming an unbounded loop.
    if (Number(row.minutes_late) > missedAfterMinutes) {
      const missed = await query("UPDATE posts SET status = 'missed' WHERE agent_id = $1 AND seq = $2 AND scheduled_for = $3 AND status IN ('draft','approved','failed') AND (hold_until IS NULL OR hold_until<=now()) RETURNING seq", [
        row.agent_id,
        row.seq,
        row.scheduled_for,
      ]);
      if (!missed.length) continue;
      if (row.slot_id && runDate) {
        await settleSlotRun(row.slot_id, runDate, "missed", {
          detail: `Not sent within ${missedAfterMinutes} minutes of its time.`,
        });
      }
      console.warn(`[distribute] agent=${row.agent_id} p${row.seq} MISSED its slot`);
      results.push({ agentId: row.agent_id, seq: row.seq, outcome: "missed" });
      continue;
    }

    const result = await publishPost(row.agent_id, row.seq, "auto");

    if (result.ok) {
      if (row.slot_id && runDate) {
        await settleSlotRun(row.slot_id, runDate, "published", { postSeq: row.seq });
      }
      results.push({ agentId: row.agent_id, seq: row.seq, outcome: "published" });
      continue;
    }

    // Ambiguous outcomes are already frozen by publishPost and must never be
    // retried, so they are reported and left exactly as it left them.
    const outcome = result.ambiguous ? "ambiguous" : "failed";
    if (row.slot_id && runDate) {
      await settleSlotRun(row.slot_id, runDate, "failed", { detail: result.reason });
    }
    results.push({ agentId: row.agent_id, seq: row.seq, outcome, detail: result.reason });
  }

  return results;
}

/** Sends stuck in_flight — surfaced in the UI because only a human can resolve them. */
export async function listAmbiguousSends(agentId: string): Promise<
  { seq: number | null; createdAt: string; lastError: string | null }[]
> {
  const rows = await query<{ seq: number | null; created_at: Date; last_error: string | null }>(
    `SELECT seq, created_at, last_error FROM distributions
      WHERE agent_id = $1 AND status = 'in_flight' AND created_at < now() - interval '5 minutes'
      ORDER BY created_at DESC`,
    [agentId],
  );
  return rows.map((r) => ({
    seq: r.seq,
    createdAt: r.created_at.toISOString(),
    lastError: r.last_error,
  }));
}

/**
 * Operator override for a resolved ambiguous send: the human checked LinkedIn
 * and told us what actually happened. `didPublish: false` releases the claim
 * so the post can be retried.
 */
export async function resolveAmbiguousSend(
  agentId: string,
  seq: number,
  didPublish: boolean,
): Promise<boolean> {
  await ensureSchema();
  const client = await getPool()!.connect();
  try {
    await client.query('BEGIN');
    const pending = await client.query(
      "SELECT seq FROM posts WHERE agent_id=$1 AND seq=$2 AND status='unknown' FOR UPDATE",
      [agentId, seq],
    );
    if (!pending.rowCount) {
      await client.query('ROLLBACK');
      return false;
    }
    if (didPublish) {
    await client.query(
      `UPDATE distributions SET status = 'sent', settled_at = now(),
              last_error = 'resolved manually: confirmed published'
        WHERE agent_id = $1 AND seq = $2 AND status = 'in_flight'`,
      [agentId, seq],
    );
    await client.query(
      "UPDATE posts SET status = 'published', published_at = COALESCE(published_at, now()) WHERE agent_id = $1 AND seq = $2",
      [agentId, seq],
    );
    } else {
  await client.query(
    "DELETE FROM distributions WHERE agent_id = $1 AND seq = $2 AND status = 'in_flight'",
    [agentId, seq],
  );
  // A negative confirmation permits a deliberate retry; it must not restart
  // the scheduler and send the post before the user has reviewed it again.
  await client.query("UPDATE posts SET status = 'draft', scheduled_for = NULL, cleared_at = NULL, hold_until = NULL WHERE agent_id = $1 AND seq = $2", [agentId, seq]);
    }
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
