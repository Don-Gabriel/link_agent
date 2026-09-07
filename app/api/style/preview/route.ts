/**
 * Style preview: run a candidate voice config over real material and return
 * the result, WITHOUT saving anything.
 *
 * The controls in the settings panel are abstract — "structure: mixed",
 * "emoji: sparing" — and nobody can predict what those produce in combination.
 * Guessing, saving, then waiting until tomorrow's cycle to find out is a
 * terrible loop, so this closes it: pick settings, press preview, read the
 * post, adjust.
 *
 * It rewrites the author's most recent post rather than inventing a story,
 * because the interesting question is "what would MY posts look like in this
 * voice", not "can the model write something". Uses a reviewed setup sample or
 * an author-supplied example when the archive is empty.
 *
 * Costs one LLM call, so it is button-triggered and never runs on keystroke.
 */
import { NextResponse } from "next/server";
import { getPersona, voiceReferencesFor } from "../../../../lib/agents";
import { getRequestAgent } from "../../../../lib/request-agent";
import { query } from "../../../../lib/db";
import { assemblePost, checkLength, hookOf } from "../../../../lib/format";
import { parseStyle } from "../../../../lib/style";
import { polishCustomPost } from "../../../../lib/writer";

export const dynamic = "force-dynamic";
// polishCustomPost, plus a possible repair call.
export const maxDuration = 120;

export async function POST(request: Request) {
  const agent = await getRequestAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  const [persona, voice] = await Promise.all([
    getPersona(agent.agentId),
    voiceReferencesFor(agent),
  ]);
  if (!persona) return NextResponse.json({ error: "persona_not_ready" }, { status: 409 });

  let body: { style?: unknown; text?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({error:'Check your preview settings.'},{status:400});

  // Merge the candidate over the SAVED style, matching how PATCH /api/settings
  // applies a patch — otherwise the preview shows a different voice than the
  // one you would actually get by saving.
  const style = parseStyle({
    ...agent.style,
    ...(body.style && typeof body.style === "object" && !Array.isArray(body.style) ? body.style : {}),
  });

  let source = typeof body.text === "string" ? body.text.trim() : "";
  let sourceLabel = "your draft";
  if (!source) {
    const recent = await query<{ text: string; id: string }>(
      `SELECT text, id FROM posts WHERE agent_id = $1 ORDER BY seq DESC LIMIT 1`,
      [agent.agentId],
    );
    if (recent[0]) {
      source = recent[0].text;
      sourceLabel = 'your most recent post';
    } else {
      const [setup]=await query<{text:string}>(`SELECT o.preview->>'text' AS text FROM onboarding o JOIN agents a ON a.owner_id=o.user_id WHERE a.id=$1 AND o.accepted_revision=o.preview_revision AND o.preview IS NOT NULL`,[agent.agentId]);
      source = setup?.text || voice.samples[0]?.text || '';
      sourceLabel = setup?.text ? 'your reviewed setup sample' : 'your writing sample';
      if (!source) return NextResponse.json({error:'preview_source_required',detail:'Add a writing sample or save a draft to preview your voice.'},{status:409});
    }
  }

  // The preview has to run the SAME prompt the real writer runs, samples and
  // all. A preview that consults only the style toggles would look convincing
  // and still not be what saving this voice actually produces.
  const result = await polishCustomPost(persona, source, style, voice);
  if (!result.ok) {
    return NextResponse.json({ error: "preview_failed", detail: result.reason }, { status: 502 });
  }

  // Show it exactly as LinkedIn would receive it, hashtags and all — the
  // hashtag count is one of the settings being previewed.
  const sampleTags = (result.data.hashtags ?? []).slice(0, style.hashtagCount);
  const assembled = assemblePost({
    body: result.data.text,
    hashtags: sampleTags,
    maxHashtags: style.hashtagCount,
  });

  return NextResponse.json({
    ok: true,
    sourceLabel,
    before: source,
    after: assembled,
    hook: hookOf(assembled),
    length: checkLength(assembled),
    style,
    servedBy: result.data.servedBy,
  });
}
