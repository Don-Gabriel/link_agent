import { ownsMedia } from '../../../lib/media-ownership';
/**
 * Custom posts: the composer's endpoint.
 *
 * A custom post enters the SAME table and the same publish path as an
 * agent-written one, so it inherits the idempotency key, the daily cap and the
 * length checks for free. The only differences are kind='custom' and that the
 * text came from a person.
 */
import { NextResponse } from "next/server";
import { getPersona, voiceReferencesFor } from "../../../lib/agents";
import { getRequestAgent } from "../../../lib/request-agent";
import { isCategoryId } from "../../../lib/categories";
import { query } from "../../../lib/db";
import { publishPost } from "../../../lib/distribute";
import { assemblePost, checkLength, MAX_BODY_CHARS } from "../../../lib/format";
import { polishCustomPost } from "../../../lib/writer";
import { MAX_HASHTAGS } from "../../../lib/style";
import { POST_COLUMNS, serializePost, type PostRow } from "../../../lib/post-view";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Load older published posts without losing them behind the status window. */
export async function GET(request: Request) {
  const agent = await getRequestAgent();
  if (!agent) return NextResponse.json({ error: 'not_initialized' }, { status: 400 });
  const value = new URL(request.url).searchParams.get('before');
  const before = value === null ? null : Number(value);
  if (before !== null && (!Number.isInteger(before) || before < 1)) {
    return NextResponse.json({ error: 'bad_cursor' }, { status: 400 });
  }
  const posts = await query<PostRow>(
    `SELECT ${POST_COLUMNS} FROM posts
     WHERE agent_id=$1 AND status='published' AND ($2::int IS NULL OR
       (published_at,seq) < (SELECT published_at,seq FROM posts WHERE agent_id=$1 AND seq=$2))
     ORDER BY published_at DESC NULLS LAST, seq DESC LIMIT 21`,
    [agent.agentId, before],
  );
  return NextResponse.json({ posts: posts.slice(0,20).map(serializePost), hasMore: posts.length > 20 },
    { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const agent = await getRequestAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  let body: {
    text?: string;
    mediaIds?: string[];
    category?: string;
    hashtags?: string[];
    polish?: boolean;
    publishNow?: boolean;
    /** ISO instant. Puts a hand-written post on the timetable like any other. */
    scheduledFor?: string;
    clientRequestId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  if (body.polish && body.publishNow) {
    return NextResponse.json({ error: 'Save and review the polished draft before publishing it.' }, { status: 409 });
  }
  if (body.clientRequestId !== undefined && !/^[A-Za-z0-9_-]{20,100}$/.test(body.clientRequestId)) {
    return NextResponse.json({ error: 'bad_request_id' }, { status: 400 });
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
  // Tags the polish step suggested, used only if the author gave none.
  let polishedTags: string[] = [];
  if (body.polish) {
    // Both reads at once — they are independent, and this sits in front of an
    // LLM call the author is already waiting on.
    const [persona, voice] = await Promise.all([
      getPersona(agent.agentId),
      voiceReferencesFor(agent),
    ]);
    if (persona) {
      const polished = await polishCustomPost(persona, text, agent.style, voice);
      if (polished.ok) {
        text = polished.data.text.trim();
        polishedBy = polished.data.servedBy;
        // Only when the author supplied none of their own. Polishing should
        // never overwrite tags someone deliberately chose.
        if (polishedTags.length === 0) polishedTags = polished.data.hashtags ?? [];
      } else {
        console.warn(`[compose] polish failed (${polished.reason}) — keeping the author's text`);
      }
    }
  }

  const mediaIds = (body.mediaIds ?? []).filter((id) => typeof id === "string").slice(0, 20);
  if(!await ownsMedia(agent.agentId,mediaIds))return NextResponse.json({error:'invalid_media'},{status:400});
  const hashtags = [
    ...(body.hashtags ?? []).filter((h) => typeof h === "string"),
    ...((body.hashtags?.length ?? 0) === 0 ? polishedTags.slice(0, agent.style.hashtagCount) : []),
  ].slice(0, MAX_HASHTAGS);
  const category = isCategoryId(body.category) ? body.category : null;

  // Validate the assembled length now rather than at publish time, so the
  // composer can report it while the text is still on screen.
  const assembled = assemblePost({ body: text, hashtags, maxHashtags: MAX_HASHTAGS });
  const length = checkLength(assembled);
  if (!length.withinLimit) {
    return NextResponse.json(
      { error: "too_long_after_escaping", detail: `${length.escapedChars} escaped chars (max 3000)` },
      { status: 400 },
    );
  }

  // A hand-written post can be put on the timetable exactly like a generated
  // one: the send pass does not care who wrote the text, only that the time has
  // come and it is cleared. Scheduling one counts as clearing it — you wrote
  // it, so there is nothing left for you to review.
  let scheduledFor: Date | null = null;
  if (body.scheduledFor && !body.publishNow) {
    const when = new Date(body.scheduledFor);
    if (Number.isNaN(when.getTime())) {
      return NextResponse.json({ error: "bad_scheduled_for" }, { status: 400 });
    }
    if (when.getTime() < Date.now()) {
      return NextResponse.json(
        { error: "scheduled_in_the_past", detail: "Pick a time in the future." },
        { status: 400 },
      );
    }
    scheduledFor = when;
  }

  const inserted = await query<{ id: string; seq: number; text: string; hashtags_json: string[]; media_json: string[]; status: string }>(
    `INSERT INTO posts (agent_id, seq, text, rationale, sources_json, fingerprint, status, kind,
                        category, media_json, hashtags_json, scheduled_for, cleared_at, client_request_id)
     SELECT $1, byline_next_seq($1), $2, $3, '[]'::jsonb, $4, $5, 'custom', $6, $7, $8,
            $9, CASE WHEN $9::timestamptz IS NULL THEN NULL ELSE now() END, $10
     ON CONFLICT (agent_id,client_request_id) WHERE client_request_id IS NOT NULL
     DO UPDATE SET client_request_id=EXCLUDED.client_request_id
     RETURNING id, seq, text, hashtags_json, media_json, status`,
    [
      agent.agentId,
      text,
      polishedBy ? `Written by you, edited for the hook (${polishedBy}).` : "Written by you.",
      `custom post — ${text.slice(0, 80)}`,
      body.publishNow || scheduledFor ? "approved" : "draft",
      category,
      JSON.stringify(mediaIds),
      JSON.stringify(hashtags),
      scheduledFor?.toISOString() ?? null,
      body.clientRequestId ?? null,
    ],
  );

  const post = inserted[0];
  if (!post) return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  if (post.text !== text || JSON.stringify(post.hashtags_json) !== JSON.stringify(hashtags) || JSON.stringify(post.media_json) !== JSON.stringify(mediaIds)) {
    return NextResponse.json({ error: 'Your earlier save succeeded. This draft is already in My Posts; review it before saving these newer changes.', seq: post.seq }, { status: 409 });
  }

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

  return NextResponse.json({
    ok: true,
    id: post.id,
    seq: post.seq,
    status: post.status,
    scheduledFor: scheduledFor?.toISOString() ?? null,
    polishedBy,
  });
}
