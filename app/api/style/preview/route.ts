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
 * voice", not "can the model write something". Falls back to a built-in sample
 * on a fresh install with an empty archive.
 *
 * Costs one LLM call, so it is button-triggered and never runs on keystroke.
 */
import { NextResponse } from "next/server";
import { getPersona, getPrimaryAgent, voiceReferencesFor } from "../../../../lib/agents";
import { query } from "../../../../lib/db";
import { assemblePost, checkLength, hookOf } from "../../../../lib/format";
import { parseStyle } from "../../../../lib/style";
import { polishCustomPost } from "../../../../lib/writer";

export const dynamic = "force-dynamic";
// polishCustomPost, plus a possible repair call.
export const maxDuration = 120;

/** Used only when the archive is empty — deliberately plain, so the style does the work. */
const SAMPLE = `I spent the weekend replacing a hand-rolled retry loop with a proper backoff library, and the incident rate on that service dropped to zero. The original loop retried three times with no jitter, so every client in the fleet retried in lockstep and turned a two-second blip into a thundering herd. The fix was twelve lines shorter than what it replaced. Most reliability work looks like this: not clever, just correcting an assumption nobody revisited.`;

export async function POST(request: Request) {
  const agent = await getPrimaryAgent();
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
      sourceLabel = `your most recent post (${recent[0].id})`;
    } else {
      source = SAMPLE;
      sourceLabel = "a built-in sample (your archive is empty)";
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
  const sampleTags = ["MusicTech", "AudioDev", "DSP", "Engineering", "BuildingInPublic"].slice(
    0,
    style.hashtagCount,
  );
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
