import { ownsMedia } from '../../../../lib/media-ownership';
/**
 * Actions on a single post: edit, clear, publish, discard, hold, reschedule,
 * and resolving an ambiguous send.
 *
 * One route with an explicit `action` rather than nine near-identical routes —
 * every one of these needs the same agent lookup, the same seq validation and
 * the same "is this post still in a state where that makes sense" check.
 *
 * CLEAR AND PUBLISH ARE DIFFERENT THINGS, and the split is the whole point of
 * the scheduling work. `clear` means "I have read this, let it go out at its
 * scheduled time" — the normal action, and the one the primary button in the
 * app performs. `publish` means "send it right now, never mind the schedule" —
 * an override. Before slots existed there was only one action and approving a
 * draft sent it immediately, which is the wrong default the moment a post has a
 * time of its own.
 */
import { NextResponse } from "next/server";
import { getPersona, voiceReferencesFor } from "../../../../lib/agents";
import { getRequestAgent } from "../../../../lib/request-agent";
import { query } from "../../../../lib/db";
import { publishPost, resolveAmbiguousSend, type ReviewedPost } from "../../../../lib/distribute";
import { assemblePost, checkLength, MAX_BODY_CHARS } from "../../../../lib/format";
import { HOLD_MINUTES } from "../../../../lib/slots";
import { rewriteDraft, writeFollowUp } from "../../../../lib/writer";
import { MAX_HASHTAGS } from "../../../../lib/style";

export const dynamic = "force-dynamic";
// Two model calls in the worst case, not one: rewrite and followup both go
// through repairIfNeeded, which spends a second call whenever the draft misses
// the author's word range or hashtag count — which, on a narrow range, is most
// of the time. Sixty seconds fitted one call comfortably and two only sometimes.
export const maxDuration = 120;

type Action =
  | "edit"
  | "followup"
  | "clear"
  | "unclear"
  | "publish"
  | "discard"
  | "resolve"
  | "rewrite"
  | "hold"
  | "release"
  | "reschedule";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ seq: string }> },
) {
  const agent = await getRequestAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  const seq = Number((await context.params).seq);
  if (!Number.isInteger(seq) || seq < 1) {
    return NextResponse.json({ error: "bad_seq" }, { status: 400 });
  }

  let body: {
    action?: Action;
    text?: string;
    hashtags?: string[];
    mediaIds?: string[];
    didPublish?: boolean;
    variant?: number;
    scheduledFor?: string | null;
    reviewed?: ReviewedPost;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  if(body.mediaIds!==undefined && (!Array.isArray(body.mediaIds) || !await ownsMedia(agent.agentId,body.mediaIds)))return NextResponse.json({error:'invalid_media'},{status:400});
  if(body.reviewed && (typeof body.reviewed.text!=='string'||!Array.isArray(body.reviewed.hashtags)||!Array.isArray(body.reviewed.media)))return NextResponse.json({error:'invalid_review'},{status:400});
  const rows = await query<{
    status: string;
    scheduled_for: Date | null;
    cleared_at: Date | null;
    sources_json: string[];
    media_json: string[];
  }>(
    "SELECT status, scheduled_for, cleared_at, sources_json, media_json FROM posts WHERE agent_id = $1 AND seq = $2",
    [agent.agentId, seq],
  );
  if (rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { status, scheduled_for: scheduledFor } = rows[0];
  if (body.action !== 'resolve' && body.action !== 'release' && body.action !== 'publish') {
    const sending = await query(
      `SELECT 1 FROM distributions WHERE agent_id=$1 AND seq=$2 AND status IN ('in_flight','sent')`,
      [agent.agentId, seq],
    );
    if (status === 'unknown' || sending.length) {
      return NextResponse.json({ error: 'This send has already started. Refresh My Posts and confirm its result before making changes.' }, { status: 409 });
    }
  }

  switch (body.action) {
    case "edit": {
      if (status === "published") {
        // The Posts API can patch commentary, but the edit would not match
        // what is stored here and LinkedIn shows an "edited" marker anyway.
        return NextResponse.json({ error: "cannot_edit_published" }, { status: 409 });
      }
      const text = (body.text ?? "").trim();
      if (text.length < 20 || text.length > MAX_BODY_CHARS) {
        return NextResponse.json({ error: "bad_text_length" }, { status: 400 });
      }
      const hashtags = (body.hashtags ?? [])
        .filter((h) => typeof h === "string")
        .slice(0, MAX_HASHTAGS);
      const length = checkLength(
        assemblePost({ body: text, hashtags, maxHashtags: MAX_HASHTAGS,
          sourceUrl: (body.mediaIds ?? rows[0].media_json ?? []).length === 0 ? rows[0].sources_json?.[0] : undefined }),
      );
      if (!length.withinLimit) {
        return NextResponse.json(
          { error: "too_long_after_escaping", detail: `${length.escapedChars} escaped chars` },
          { status: 400 },
        );
      }
      // COALESCE, so original_text is written once and only once. Every edit
      // after the first is a human revising their own revision; overwriting it
      // each time would leave the column holding the previous human draft
      // rather than the machine's, and the pair would stop being evidence of
      // anything. This is the training signal the app used to delete daily.
      //
      // mediaIds is optional: an editor that only changes text must not silently
      // detach the images already on the post, so absent means "leave alone".
      if (Array.isArray(body.mediaIds)) {
        const mediaIds = body.mediaIds.filter((id) => typeof id === "string").slice(0, 20);
        await query(
          `UPDATE posts
              SET original_text = COALESCE(original_text, text),
                  text = $3, hashtags_json = $4, media_json = $5, status = 'draft', cleared_at = NULL
            WHERE agent_id = $1 AND seq = $2`,
          [agent.agentId, seq, text, JSON.stringify(hashtags), JSON.stringify(mediaIds)],
        );
      } else {
        await query(
          `UPDATE posts
              SET original_text = COALESCE(original_text, text),
                  text = $3, hashtags_json = $4, status = 'draft', cleared_at = NULL
            WHERE agent_id = $1 AND seq = $2`,
          [agent.agentId, seq, text, JSON.stringify(hashtags)],
        );
      }
      return NextResponse.json({ ok: true });
    }

    case "clear": {
      if (status === "published") {
        return NextResponse.json({ error: "already_published" }, { status: 409 });
      }
      if (!scheduledFor) {
        // Clearing an unscheduled post would mark it ready and then nothing
        // would ever collect it. Say so rather than leaving it silently stuck.
        return NextResponse.json(
          {
            error: "not_scheduled",
            detail: "This post has no send time. Give it one with `reschedule`, or use `publish` to send it now.",
          },
          { status: 409 },
        );
      }
      // Releases any stale edit hold in the same breath: saying "this is ready"
      // is unambiguously the end of editing it.
      const cleared=await query(
        `UPDATE posts SET cleared_at = now(), hold_until = NULL, status = 'approved'
          WHERE agent_id = $1 AND seq = $2 AND ($3::text IS NULL OR
          (status IN ('draft','approved','failed','missed') AND text=$3 AND COALESCE(hashtags_json,'[]'::jsonb)=$4::jsonb AND COALESCE(media_json,'[]'::jsonb)=$5::jsonb)) RETURNING seq`,
        [agent.agentId,seq,body.reviewed?.text??null,JSON.stringify(body.reviewed?.hashtags??[]),JSON.stringify(body.reviewed?.media??[])],
      );
      if(!cleared.length)return NextResponse.json({error:'This post changed on another device. Refresh and review it again.'},{status:409});
      return NextResponse.json({ ok: true, scheduledFor: scheduledFor.toISOString() });
    }

    case "unclear": {
      if (status === "published") {
        return NextResponse.json({ error: "already_published" }, { status: 409 });
      }
      await query(
        "UPDATE posts SET cleared_at = NULL, status = 'draft' WHERE agent_id = $1 AND seq = $2",
        [agent.agentId, seq],
      );
      return NextResponse.json({ ok: true });
    }

    case "hold": {
      // Taken when the composer opens a scheduled post, so a send cannot fire
      // mid-edit. Time-bounded rather than a flag: a crashed app must not be
      // able to silence a slot forever.
      if (status === "published") {
        return NextResponse.json({ error: "already_published" }, { status: 409 });
      }
      await query(
        `UPDATE posts SET hold_until = now() + make_interval(mins => $3)
          WHERE agent_id = $1 AND seq = $2`,
        [agent.agentId, seq, HOLD_MINUTES],
      );
      return NextResponse.json({ ok: true, holdMinutes: HOLD_MINUTES });
    }

    case "release": {
      await query("UPDATE posts SET hold_until = NULL WHERE agent_id = $1 AND seq = $2", [
        agent.agentId,
        seq,
      ]);
      return NextResponse.json({ ok: true });
    }

    case "reschedule": {
      if (status === "published") {
        return NextResponse.json({ error: "cannot_reschedule_published" }, { status: 409 });
      }
      // null is meaningful: it lifts the post off the schedule entirely and
      // returns it to the queue as something to send by hand.
      if (body.scheduledFor === null) {
        // Approval belongs to the scheduled send. Removing that time also
        // withdraws approval, so a cleared post becomes a draft again. Keep
        // real failure/ambiguous states intact instead of hiding their outcome.
        const unscheduled = await query(
          `UPDATE posts p
              SET scheduled_for = NULL, cleared_at = NULL,
                  status = CASE WHEN p.status IN ('approved','missed') THEN 'draft' ELSE p.status END
            WHERE p.agent_id = $1 AND p.seq = $2 AND p.status <> 'published'
              AND NOT EXISTS (
                SELECT 1 FROM distributions d
                 WHERE d.agent_id = p.agent_id AND d.seq = p.seq
                   AND d.status IN ('in_flight', 'sent')
              )
            RETURNING seq`,
          [agent.agentId, seq],
        );
        if (!unscheduled.length) {
          return NextResponse.json(
            { error: "This post is being sent or has already been sent. Refresh to see its latest status." },
            { status: 409 },
          );
        }
        return NextResponse.json({ ok: true, scheduledFor: null });
      }
      const when = new Date(body.scheduledFor ?? "");
      if (Number.isNaN(when.getTime())) {
        return NextResponse.json({ error: "bad_scheduled_for" }, { status: 400 });
      }
      if (when.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'Pick a send time in the future.' }, { status: 400 });
      }
      await query("UPDATE posts SET scheduled_for = $3, cleared_at = NULL, status = 'draft' WHERE agent_id = $1 AND seq = $2 AND status IN ('draft','approved','failed','missed')", [
        agent.agentId,
        seq,
        when.toISOString(),
      ]);
      return NextResponse.json({ ok: true, scheduledFor: when.toISOString() });
    }

    case "publish": {
      if (status === "published") {
        return NextResponse.json({ error: "already_published" }, { status: 409 });
      }
      if (status === "unknown") {
        return NextResponse.json(
          { error: "resolve_ambiguous_first", detail: "Check LinkedIn and resolve this send first." },
          { status: 409 },
        );
      }
      const result = await publishPost(agent.agentId, seq,'manual',body.reviewed);
      if (!result.ok) {
        return NextResponse.json(
          { ok: false, error: result.reason, needsReauth: result.needsReauth, ambiguous: result.ambiguous },
          { status: 502 },
        );
      }
      return NextResponse.json({ ok: true, permalink: result.permalink, postUrn: result.postUrn });
    }

    case "discard": {
      if (status === "published") {
        return NextResponse.json({ error: "cannot_discard_published" }, { status: 409 });
      }
      await query("UPDATE posts SET status = 'rejected' WHERE agent_id = $1 AND seq = $2", [
        agent.agentId,
        seq,
      ]);
      return NextResponse.json({ ok: true });
    }

    case "rewrite": {
      if (status === "published") {
        return NextResponse.json({ error: "cannot_rewrite_published" }, { status: 409 });
      }
      const rows = await query<{ text: string }>(
        "SELECT text FROM posts WHERE agent_id = $1 AND seq = $2",
        [agent.agentId, seq],
      );
      const current = rows[0]?.text ?? "";
      if (current.length < 20) {
        return NextResponse.json({ error: "nothing_to_rewrite" }, { status: 400 });
      }
      const [persona, voice] = await Promise.all([
        getPersona(agent.agentId),
        voiceReferencesFor(agent),
      ]);
      if (!persona) return NextResponse.json({ error: "persona_not_ready" }, { status: 409 });

      // Deliberately NOT saved. A variant the user has not seen yet must never
      // replace the draft they already approved of — they choose, then the app
      // sends a normal 'edit'.
      const variant = await rewriteDraft(persona, current, agent.style, Number(body.variant ?? 0), voice);
      if (!variant.ok) {
        return NextResponse.json({ error: "rewrite_failed", detail: variant.reason }, { status: 502 });
      }
      // Hashtags are SUGGESTIONS. The composer keeps whatever the author chose
      // and fills the remaining room under the cap from these, so pressing
      // rewrite can never delete a tag someone typed on purpose.
      return NextResponse.json({
        ok: true,
        text: variant.data.text,
        hashtags: (variant.data.hashtags ?? []).slice(0, agent.style.hashtagCount),
        servedBy: variant.data.servedBy,
      });
    }

    case "followup": {
      // Only from something that actually went out. A follow-up to a draft is a
      // rewrite with extra steps, and rewrite already exists for that.
      if (status !== "published") {
        return NextResponse.json(
          { error: "not_published", detail: "Follow-ups are written from posts that have gone out." },
          { status: 409 },
        );
      }
      const rows = await query<{ text: string; published_at: Date | null }>(
        "SELECT text, published_at FROM posts WHERE agent_id = $1 AND seq = $2",
        [agent.agentId, seq],
      );
      const original = rows[0];
      if (!original || original.text.length < 20) {
        return NextResponse.json({ error: "nothing_to_follow" }, { status: 400 });
      }

      const [persona, voice] = await Promise.all([
        getPersona(agent.agentId),
        voiceReferencesFor(agent),
      ]);
      if (!persona) return NextResponse.json({ error: "persona_not_ready" }, { status: 409 });

      const followUp = await writeFollowUp(
        persona,
        {
          text: original.text,
          publishedAt: original.published_at?.toISOString().slice(0, 10) ?? null,
        },
        agent.style,
        voice,
      );
      if (!followUp.ok) {
        return NextResponse.json({ error: "followup_failed", detail: followUp.reason }, { status: 502 });
      }

      // Deliberately NOT saved, exactly like a rewrite. This is a suggestion
      // about what to write next; the composer shows it and the author decides.
      return NextResponse.json({
        ok: true,
        text: followUp.data.text,
        hashtags: followUp.data.hashtags.slice(0, agent.style.hashtagCount),
        servedBy: followUp.data.servedBy,
      });
    }

    case "resolve": {
      if (typeof body.didPublish !== "boolean") {
        return NextResponse.json({ error: "didPublish_required" }, { status: 400 });
      }
      if (!await resolveAmbiguousSend(agent.agentId, seq, body.didPublish)) {
        return NextResponse.json({ error: 'This post no longer has an unconfirmed send. Refresh My Posts.' }, { status: 409 });
      }
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }
}
