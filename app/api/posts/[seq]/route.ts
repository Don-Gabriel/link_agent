/**
 * Actions on a single post: edit, publish, discard, and resolving an
 * ambiguous send.
 *
 * One route with an explicit `action` rather than five near-identical routes —
 * every one of these needs the same agent lookup, the same seq validation and
 * the same "is this post still in a state where that makes sense" check.
 */
import { NextResponse } from "next/server";
import { getPersona, getPrimaryAgent } from "../../../../lib/agents";
import { query } from "../../../../lib/db";
import { publishPost, resolveAmbiguousSend } from "../../../../lib/distribute";
import { assemblePost, checkLength, MAX_BODY_CHARS } from "../../../../lib/format";
import { rewriteDraft } from "../../../../lib/writer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Action = "edit" | "publish" | "discard" | "resolve" | "rewrite";

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
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const rows = await query<{ status: string }>(
    "SELECT status FROM posts WHERE agent_id = $1 AND seq = $2",
    [agent.agentId, seq],
  );
  if (rows.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const status = rows[0].status;

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
