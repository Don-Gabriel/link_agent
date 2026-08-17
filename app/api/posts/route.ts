/**
 * Custom posts: the composer's endpoint.
 *
 * A custom post enters the SAME table and the same publish path as an
 * agent-written one, so it inherits the idempotency key, the daily cap and the
 * length checks for free. The only differences are kind='custom' and that the
 * text came from a person.
 */
import { NextResponse } from "next/server";
import { getPersona, getPrimaryAgent } from "../../../lib/agents";
import { isCategoryId } from "../../../lib/categories";
import { query } from "../../../lib/db";
import { publishPost } from "../../../lib/distribute";
import { assemblePost, checkLength, MAX_BODY_CHARS } from "../../../lib/format";
import { polishCustomPost } from "../../../lib/writer";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const agent = await getPrimaryAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  let body: {
    text?: string;
    mediaIds?: string[];
    category?: string;
    hashtags?: string[];
    polish?: boolean;
    publishNow?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  let text = (body.text ?? "").trim();
  if (text.length < 20) {
    return NextResponse.json({ error: "text_too_short" }, { status: 400 });
  }
  if (text.length > MAX_BODY_CHARS) {
    return NextResponse.json(
      { error: "text_too_long", detail: `${text.length} chars, max ${MAX_BODY_CHARS}` },
      { status: 400 },
    );
  }

  // Optional polish. A failure here is NOT fatal — the user's own words are
  // perfectly publishable, and losing their draft to a quota error would be
  // the worst possible outcome.
  let polishedBy: string | undefined;
  if (body.polish) {
    const persona = await getPersona(agent.agentId);
    if (persona) {
      const polished = await polishCustomPost(persona, text, agent.style);
      if (polished.ok) {
        text = polished.data.text.trim();
        polishedBy = polished.data.servedBy;
      } else {
        console.warn(`[compose] polish failed (${polished.reason}) — keeping the author's text`);
      }
    }
  }

  const mediaIds = (body.mediaIds ?? []).filter((id) => typeof id === "string").slice(0, 20);
  const hashtags = (body.hashtags ?? [])
    .filter((h) => typeof h === "string")
    .slice(0, agent.style.hashtagCount);
  const category = isCategoryId(body.category) ? body.category : null;

  // Validate the assembled length now rather than at publish time, so the
  // composer can report it while the text is still on screen.
  const assembled = assemblePost({ body: text, hashtags, maxHashtags: agent.style.hashtagCount });
  const length = checkLength(assembled);
  if (!length.withinLimit) {
    return NextResponse.json(
      { error: "too_long_after_escaping", detail: `${length.escapedChars} escaped chars (max 3000)` },
      { status: 400 },
    );
  }

  const inserted = await query<{ id: string; seq: number }>(
    `INSERT INTO posts (agent_id, seq, text, rationale, sources_json, fingerprint, status, kind,
                        category, media_json, hashtags_json)
     SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3, '[]'::jsonb, $4, $5, 'custom', $6, $7, $8
       FROM posts WHERE agent_id = $1
     RETURNING id, seq`,
    [
      agent.agentId,
      text,
      polishedBy ? `Written by you, edited for the hook (${polishedBy}).` : "Written by you.",
      `custom post — ${text.slice(0, 80)}`,
      body.publishNow ? "approved" : "draft",
      category,
      JSON.stringify(mediaIds),
      JSON.stringify(hashtags),
    ],
  );

  const post = inserted[0];
  if (!post) return NextResponse.json({ error: "insert_failed" }, { status: 500 });

  if (body.publishNow) {
    const result = await publishPost(agent.agentId, post.seq);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, id: post.id, seq: post.seq, error: result.reason, ambiguous: result.ambiguous },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, id: post.id, seq: post.seq, permalink: result.permalink });
  }

  return NextResponse.json({ ok: true, id: post.id, seq: post.seq, status: "draft", polishedBy });
}
