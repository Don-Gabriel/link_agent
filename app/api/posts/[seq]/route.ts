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
import { getPersona, getPrimaryAgent } from "../../../../lib/agents";
import { query } from "../../../../lib/db";
import { publishPost, resolveAmbiguousSend } from "../../../../lib/distribute";
import { assemblePost, checkLength, MAX_BODY_CHARS } from "../../../../lib/format";
import { HOLD_MINUTES } from "../../../../lib/slots";
import { rewriteDraft } from "../../../../lib/writer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Action =
  | "edit"
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
  const agent = await getPrimaryAgent();
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
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const rows = await query<{
    status: string;
    scheduled_for: Date | null;
    cleared_at: Date | null;
  }>(
    "SELECT status, scheduled_for, cleared_at FROM posts WHERE agent_id = $1 AND seq = $2",
    [agent.agentId, seq],
  );
  if (rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { status, scheduled_for: scheduledFor } = rows[0];

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
        .slice(0, agent.style.hashtagCount);
      const length = checkLength(
        assemblePost({ body: text, hashtags, maxHashtags: agent.style.hashtagCount }),
      );
      if (!length.withinLimit) {
        return NextResponse.json(
          { error: "too_long_after_escaping", detail: `${length.escapedChars} escaped chars` },
          { status: 400 },
        );
      }
      // mediaIds is optional: an editor that only changes text must not silently
      // detach the images already on the post, so absent means "leave alone".
      if (Array.isArray(body.mediaIds)) {
        const mediaIds = body.mediaIds.filter((id) => typeof id === "string").slice(0, 20);
        await query(
          `UPDATE posts SET text = $3, hashtags_json = $4, media_json = $5, status = 'draft'
            WHERE agent_id = $1 AND seq = $2`,
          [agent.agentId, seq, text, JSON.stringify(hashtags), JSON.stringify(mediaIds)],
        );
      } else {
        await query(
          "UPDATE posts SET text = $3, hashtags_json = $4, status = 'draft' WHERE agent_id = $1 AND seq = $2",
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
      await query(
        `UPDATE posts SET cleared_at = now(), hold_until = NULL, status = 'approved'
          WHERE agent_id = $1 AND seq = $2`,
        [agent.agentId, seq],
      );
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
        await query(
          "UPDATE posts SET scheduled_for = NULL, cleared_at = NULL WHERE agent_id = $1 AND seq = $2",
          [agent.agentId, seq],
        );
        return NextResponse.json({ ok: true, scheduledFor: null });
      }
      const when = new Date(body.scheduledFor ?? "");
      if (Number.isNaN(when.getTime())) {
        return NextResponse.json({ error: "bad_scheduled_for" }, { status: 400 });
      }
      await query("UPDATE posts SET scheduled_for = $3 WHERE agent_id = $1 AND seq = $2", [
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
      const result = await publishPost(agent.agentId, seq);
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
      const persona = await getPersona(agent.agentId);
      if (!persona) return NextResponse.json({ error: "persona_not_ready" }, { status: 409 });

      // Deliberately NOT saved. A variant the user has not seen yet must never
      // replace the draft they already approved of — they choose, then the app
      // sends a normal 'edit'.
      const variant = await rewriteDraft(persona, current, agent.style, Number(body.variant ?? 0));
      if (!variant.ok) {
        return NextResponse.json({ error: "rewrite_failed", detail: variant.reason }, { status: 502 });
      }
      return NextResponse.json({
        ok: true,
        text: variant.data.text,
        servedBy: variant.data.servedBy,
      });
    }

    case "resolve": {
      if (typeof body.didPublish !== "boolean") {
        return NextResponse.json({ error: "didPublish_required" }, { status: 400 });
      }
      await resolveAmbiguousSend(agent.agentId, seq, body.didPublish);
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }
}
