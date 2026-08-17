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
import { query } from "./db";
import { assemblePost, checkLength } from "./format";
import { createPost, postPermalink, type PostImage } from "./linkedin";
import { parseStyle } from "./style";

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

/** Hard bounds on what a user may set the agent's own allowance to. */
export const MAX_AUTO_CAP = 3;

export type PublishSource = "auto" | "manual";

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
}

/** Publishing is disabled entirely unless this is explicitly turned on. */
export function liveModeEnabled(): boolean {
  return process.env.LINKEDIN_LIVE === "true";
}

/** Sends in the last rolling 24h, split by who initiated them. */
export async function sendsToday(agentId: string): Promise<{ auto: number; manual: number }> {
  const rows = await query<{ source: string; n: string }>(
    `SELECT source, count(*)::text AS n FROM distributions
      WHERE agent_id = $1 AND status = 'sent' AND settled_at > now() - interval '24 hours'
      GROUP BY source`,
    [agentId],
  );
  const by = new Map(rows.map((r) => [r.source, Number(r.n)]));
  return { auto: by.get("auto") ?? 0, manual: by.get("manual") ?? 0 };
}

async function loadImages(mediaIds: string[]): Promise<PostImage[]> {
  if (mediaIds.length === 0) return [];
  const rows = await query<{ id: string; linkedin_urn: string; alt_text: string | null }>(
    "SELECT id, linkedin_urn, alt_text FROM media_assets WHERE id = ANY($1::uuid[]) AND status = 'uploaded'",
    [mediaIds],
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
): Promise<DistributeResult> {
  const rows = await query<PostRow>(
    `SELECT p.seq, p.text, p.status, p.category, p.media_json, p.sources_json, p.hashtags_json,
            a.style_json, a.auto_publish_cap
       FROM posts p JOIN agents a ON a.id = p.agent_id
      WHERE p.agent_id = $1 AND p.seq = $2`,
    [agentId, seq],
  );
  const post = rows[0];
  if (!post) return { ok: false, reason: "post_not_found" };
  if (post.status === "published") return { ok: false, reason: "already_published", alreadyClaimed: true };

  if (!liveModeEnabled()) {
    return { ok: false, reason: "live_mode_disabled — set LINKEDIN_LIVE=true to publish for real" };
  }

  // The agent's allowance and the author's are counted separately, so a day of
  // manual posting never blocks tomorrow's scheduled one, and vice versa.
  const sent = await sendsToday(agentId);
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

  const images = await loadImages(post.media_json ?? []);
  // A source link is worth including on a text post, but on an image post it
  // competes with the image for the reader's attention and looks like spam.
  const sourceUrl = images.length === 0 ? post.sources_json?.[0] : undefined;
  const text = assemblePost({
    body: post.text,
    sourceUrl,
    hashtags: post.hashtags_json ?? [],
    maxHashtags: parseStyle(post.style_json).hashtagCount,
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
): Promise<void> {
  if (didPublish) {
    await query(
      `UPDATE distributions SET status = 'sent', settled_at = now(),
              last_error = 'resolved manually: confirmed published'
        WHERE agent_id = $1 AND seq = $2 AND status = 'in_flight'`,
      [agentId, seq],
    );
    await query(
      "UPDATE posts SET status = 'published', published_at = COALESCE(published_at, now()) WHERE agent_id = $1 AND seq = $2",
      [agentId, seq],
    );
    return;
  }
  await query(
    "DELETE FROM distributions WHERE agent_id = $1 AND seq = $2 AND status = 'in_flight'",
    [agentId, seq],
  );
  await query("UPDATE posts SET status = 'approved' WHERE agent_id = $1 AND seq = $2", [agentId, seq]);
}
