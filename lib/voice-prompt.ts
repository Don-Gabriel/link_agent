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
