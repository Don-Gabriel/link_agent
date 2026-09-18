/**
 * Teaching the writer what this person actually sounds like.
 *
 * lib/style.ts describes a voice from the OUTSIDE — structure, emoji policy,
 * word counts, banned phrases. Those are real constraints and worth having, but
 * they are a description of a voice rather than the voice itself, which is why
 * output written only against them reads as competent and generic.
 *
 * This module supplies the inside view, from two sources:
 *
 *   SAMPLES  Real posts. Either ones the author pasted in as "this is how I
 *            want to sound", or their own published posts from the archive.
 *            Few-shot examples move a model's register further than any amount
 *            of instruction, because they carry rhythm, hedging, vocabulary and
 *            the shape of an argument — none of which survive being described.
 *
 *   EDITS    What the author changed when they rewrote the agent. Every edited
 *            draft is a labelled pair: the machine's attempt, and the version a
 *            human was willing to put their name on. Distilled into a standing
 *            note, that is the sharpest correction signal available.
 *
 * Both are optional. With neither, the prompt is exactly what it was before this
 * file existed, so an install that never supplies a sample is unaffected.
 */
import { query } from "./db";
import { complete } from "./llm";

/** Hard cap per sample. Long enough for a real post, short enough for the budget. */
const MAX_SAMPLE_CHARS = 2400;
/** How many samples the author may store. */
const MAX_CORPUS = 10;
/** How many reach any single prompt. More crowds out the actual assignment. */
export const SAMPLES_IN_PROMPT = 3;
/** Edit pairs needed before a summary is worth deriving. */
export const MIN_PAIRS_FOR_NOTES = 3;

export interface VoiceSample {
  text: string;
  /** Where it came from, which changes how the model is told to read it. */
  origin: "corpus" | "published";
}

/**
 * Parse whatever is in agents.corpus_json into usable samples.
 *
 * Never throws and never returns junk: a hand-edited row, a null, or an array
 * of numbers all resolve to an empty list, which simply means no samples reach
 * the prompt.
 */
export function parseCorpus(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length >= 80)
    .map((s) => s.slice(0, MAX_SAMPLE_CHARS))
    .slice(0, MAX_CORPUS);
}

/**
 * Choose which samples to show, preferring the author's own pasted corpus.
 *
 * Corpus first because it is an explicit statement of intent — "this is how I
 * want to sound" — whereas a published post may simply be one the author let
 * through rather than one they admired. Published posts fill the remainder, so
 * an install with no corpus still gets few-shot examples once it has an
 * archive.
 */
export function pickSamples(
  corpus: string[],
  published: string[],
  limit = SAMPLES_IN_PROMPT,
): VoiceSample[] {
  // Both sides are trimmed before comparison. parseCorpus already trims what it
  // stores, but this function must not depend on its caller having done so —
  // otherwise a single trailing space defeats the duplicate check below and the
  // model is handed the same post twice under two different labels.
  const out: VoiceSample[] = corpus
    .slice(0, limit)
    .map((text) => ({ text: text.trim().slice(0, MAX_SAMPLE_CHARS), origin: "corpus" as const }));

  for (const text of published) {
    if (out.length >= limit) break;
    const trimmed = text.trim().slice(0, MAX_SAMPLE_CHARS);
    if (trimmed.length < 80) continue;
    // Never show the model a sample it is about to be asked to avoid repeating.
    if (out.some((s) => s.text === trimmed)) continue;
    out.push({ text: trimmed, origin: "published" });
  }

  return out;
}

/**
 * Render samples and edit notes as a prompt block, or "" when there is nothing
 * to say.
 *
 * The framing matters as much as the content. Samples are labelled as voice
 * references and explicitly NOT as subject matter, because a model given three
 * posts about synthesisers will happily write a fourth about synthesisers
 * regardless of what story it was actually handed.
 */
export function voiceBlock(samples: VoiceSample[], editNotes?: string | null): string {
  const parts: string[] = [];

  if (samples.length > 0) {
    parts.push(
      "HOW THIS PERSON ACTUALLY WRITES — study these before writing:",
      "These are voice references, NOT subject matter. Do not write about what they are about, and do not reuse their sentences. Take the rhythm, the sentence length, the vocabulary, how much they hedge, how they open and how they end.",
    );
    samples.forEach((s, i) => {
      parts.push(
        "",
        `--- SAMPLE ${i + 1} (${s.origin === "corpus" ? "chosen by the author as a model of their voice" : "one of their own published posts"}) ---`,
        s.text,
      );
    });
    parts.push("--- END SAMPLES ---");
  }

  if (editNotes && editNotes.trim().length > 0) {
    parts.push(
      "",
      "HOW THIS AUTHOR EDITS YOU — learned from drafts they rewrote before publishing. Pre-empt these corrections rather than making them necessary again:",
      editNotes.trim(),
    );
  }

  return parts.join("\n");
}

// ------------------------------------------------------------ edit learning

export interface EditPair {
  original: string;
  final: string;
}

const NOTES_SYSTEM = `You analyse how a specific person edits AI-written LinkedIn posts, so a writing model can pre-empt their corrections.

You will see pairs: the draft a model produced, and the version the person actually published after editing it.

Report ONLY patterns that appear in more than one pair. A single edit is a preference about that post; a repeated edit is a rule about their voice.

Write 3-6 short imperative lines, each a specific instruction a writer could follow. Name concrete things — words they cut, structures they collapse, hedges they remove, openings they rewrite. "Be more concise" is useless; "cut the scene-setting first sentence and open on the number" is useful.

If the pairs show no repeated pattern, reply with exactly: NONE

Reply with the lines only. No preamble, no numbering, no JSON.`;

/**
 * Distil edit pairs into a standing instruction block.
 *
 * Returns null when there is nothing honest to say — too few pairs, an
 * unavailable model, or a genuine absence of repeated patterns. Null is a
 * perfectly good outcome: an invented "pattern" derived from one edit would
 * push the voice in a direction the author never asked for, which is worse than
 * leaving the prompt as it was.
 */
export async function deriveEditNotes(pairs: EditPair[]): Promise<string | null> {
  if (pairs.length < MIN_PAIRS_FOR_NOTES) return null;

  const user = pairs
    .slice(0, 12)
    .map(
      (p, i) =>
        `PAIR ${i + 1}\n[model wrote]\n${p.original.slice(0, 1200)}\n\n[they published]\n${p.final.slice(0, 1200)}`,
    )
    .join("\n\n----\n\n");

  const res = await complete({
    system: NOTES_SYSTEM,
    user,
    maxOutputTokens: 512,
  });
  if (!res.ok) {
    console.warn(`[voice] could not derive edit notes: ${res.reason}`);
    return null;
  }

  const text = res.text.trim();
  if (!text || /^NONE$/im.test(text)) return null;
  return text.slice(0, 1500);
}

/**
 * Refresh an agent's edit notes if enough NEW evidence has accumulated.
 *
 * Guarded on a count rather than a timer, and only ever recomputed when the
 * number of pairs has grown by at least MIN_PAIRS_FOR_NOTES since the last
 * derivation. Two reasons: an LLM call per publish would be pure waste when the
 * evidence has not changed, and a summary that churns on every edit would make
 * the voice wander instead of settle.
 *
 * Only PUBLISHED posts count. A draft the author edited and then discarded is
 * not evidence of how they want to sound — it is evidence of a post they did
 * not want at all.
 *
 * Never throws. This is a background improvement; failing it must never affect
 * a publish.
 */
export async function refreshEditNotes(agentId: string): Promise<boolean> {
  const {withAgentUsage}=await import('./ai-usage');
  return withAgentUsage(agentId,()=>refreshOwnedEditNotes(agentId)).catch(()=>false);
}

async function refreshOwnedEditNotes(agentId: string): Promise<boolean> {
  try {
    const pairs = await query<{ original_text: string; text: string }>(
      `SELECT original_text, text FROM posts
        WHERE agent_id = $1 AND status = 'published'
          AND original_text IS NOT NULL AND original_text <> text
        ORDER BY published_at DESC NULLS LAST, seq DESC
        LIMIT 12`,
      [agentId],
    );

    if (pairs.length < MIN_PAIRS_FOR_NOTES) return false;

    const state = await query<{ edit_notes_from: number }>(
      "SELECT edit_notes_from FROM agents WHERE id = $1",
      [agentId],
    );
    const derivedFrom = state[0]?.edit_notes_from ?? 0;
    if (pairs.length < derivedFrom + MIN_PAIRS_FOR_NOTES) return false;

    const notes = await deriveEditNotes(
      pairs.map((p) => ({ original: p.original_text, final: p.text })),
    );
    if (!notes) {
      // Record the attempt anyway, so a set of pairs with no repeated pattern
      // is not re-analysed on every publish forever.
      await query("UPDATE agents SET edit_notes_from = $2 WHERE id = $1", [agentId, pairs.length]);
      return false;
    }

    await query("UPDATE agents SET edit_notes = $2, edit_notes_from = $3 WHERE id = $1", [
      agentId,
      notes,
      pairs.length,
    ]);
    console.log(`[voice] agent=${agentId} edit notes refreshed from ${pairs.length} pairs`);
    return true;
  } catch (err) {
    console.warn(`[voice] refreshEditNotes failed for agent=${agentId}:`, err);
    return false;
  }
}
