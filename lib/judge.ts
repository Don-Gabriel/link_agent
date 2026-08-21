/**
 * Editorial judging: ONE batched LLM call scores every candidate 0-10 on
 * five criteria and assigns it a category. Publish only the single top
 * candidate, and only above the threshold.
 *
 * A day that publishes nothing is correct behavior — there is no floor
 * forcing a post out. On a personal LinkedIn profile that matters more than
 * it did in the original feed: silence costs nothing, a weak post costs
 * credibility with people who actually know you.
 */
import type { CategoryId } from "./categories";
import { ALL_CATEGORY_IDS, CATEGORIES, categoryBlock, isCategoryId } from "./categories";
import type { Candidate } from "./discovery";
import { complete, parseJson } from "./llm";
import type { MemoryContext } from "./memory";
import type { PersonaRecord } from "./persona";
import { personaBlock } from "./persona";

export const PUBLISH_THRESHOLD = 6.5;

/**
 * Output tokens to allow for a batch of `n` candidates.
 *
 * One scored object runs about 70-90 tokens once the one-line reason is
 * included, so the budget has to track the batch or the array is cut off
 * mid-object. Ceilinged at 8192 because past that the model is being asked for
 * more than any single response should carry.
 */
export function outputBudgetFor(n: number): number {
  return Math.min(8192, Math.max(2048, 400 + n * 110));
}

export interface Scores {
  persona_fit: number;
  category_fit: number;
  novelty: number;
  timeliness: number;
  non_duplication: number;
}

export interface ScoredCandidate extends Candidate {
  scores: Scores;
  total: number;
  reason: string;
  category: CategoryId;
}

interface RawScore extends Scores {
  index: number;
  category: string;
  reason: string;
}

function inRange(n: unknown): n is number {
  return typeof n === "number" && n >= 0 && n <= 10;
}

/** One entry, judged on its own merits. */
export function isRawScore(s: unknown): s is RawScore {
  const o = s as RawScore;
  return (
    !!o &&
    typeof o.index === "number" &&
    inRange(o.persona_fit) &&
    inRange(o.category_fit) &&
    inRange(o.novelty) &&
    inRange(o.timeliness) &&
    inRange(o.non_duplication) &&
    typeof o.category === "string" &&
    typeof o.reason === "string"
  );
}

/**
 * Accept the array, then keep the entries that are actually usable.
 *
 * This used to require `v.every(...)` — every single entry valid or the whole
 * batch discarded. With 34 candidates in one response that is a bad bet: one
 * truncated tail object, one score of 11, one missing `reason`, and a day's
 * discovery is thrown away with `judge_json_invalid_after_retry` and no clue
 * which entry was at fault.
 *
 * Dropping bad entries is safe rather than lax. Nothing is published unscored:
 * a candidate that does not survive validation simply is not considered, the
 * caller still sorts by total and still refuses to publish anything below
 * PUBLISH_THRESHOLD. The failure mode this replaces was strictly worse — it
 * discarded the GOOD entries too.
 */
function isRawScores(v: unknown): v is RawScore[] {
  return Array.isArray(v) && v.some(isRawScore);
}

const SYSTEM = `You are the editorial judgment of a working engineer who posts on LinkedIn about their genuine interests. Score EVERY numbered candidate 0-10 on:
- persona_fit: would THIS person post about this, given their voice, interests and opinions?
- category_fit: does it clearly belong to one of the active categories, and is it substantial enough to be worth a post rather than a link?
- novelty: does it add something beyond what has already been covered (see PRIOR COVERAGE)?
- timeliness: is there a reason to write about it right now?
- non_duplication: 10 = nothing like it in prior coverage; 0 = already covered.

Also assign "category": the id of the single active category it best belongs to.

Be discriminating. This publishes to a real professional profile where the author's colleagues will read it, so most candidates in a batch deserve middling or low scores. Reserve 8+ for something the author would genuinely stop and write about. Product announcements with nothing new in them, funding rounds, and press releases restating a spec sheet are 3s and 4s no matter how big the brand.

Respond with a JSON array, one object per candidate, exactly:
[{"index": number, "persona_fit": number, "category_fit": number, "novelty": number, "timeliness": number, "non_duplication": number, "category": "category-id", "reason": "one line"}]
Include every candidate index exactly once.`;

/**
 * What the profile has actually been publishing, by category.
 *
 * Scoring each candidate purely on its own merits is right for quality and
 * wrong for range: whichever category happens to produce the strongest stories
 * wins every single cycle, and a profile that watches seven interests quietly
 * becomes a profile about one. non_duplication catches a repeated STORY; it has
 * nothing to say about a repeated subject.
 *
 * This tilts the bar rather than reserving slots. Nothing here can force out a
 * post the judge does not rate — an under-covered category still has to earn
 * its score, and a silent day is still an acceptable outcome.
 */
function coverageBlock(active: CategoryId[], recent: CategoryId[]): string {
  if (recent.length === 0) return "RECENT COVERAGE BY CATEGORY: nothing published yet — score purely on merit.";
  const counts = new Map<CategoryId, number>();
  for (const c of recent) counts.set(c, (counts.get(c) ?? 0) + 1);
  const lines = active.map((id) => {
    const n = counts.get(id) ?? 0;
    return `- ${id} (${CATEGORIES[id].label}): ${n} of the last ${recent.length} posts`;
  });
  return [
    `RECENT COVERAGE BY CATEGORY (last ${recent.length} posts):`,
    ...lines,
    "This profile is meant to cover all of its active categories, not the one that writes most easily.",
    "A candidate in a category that already dominates the list above must be clearly better — higher novelty and a real reason to write now — to deserve another post. A candidate in an active category with little or no recent coverage is worth more, all else equal.",
    "Do not invent merit to fill a gap. If nothing outside the dominant category is any good, score it that way and let the day be silent.",
  ].join("\n");
}

function candidateLine(c: Candidate, i: number, summaryLen: number): string {
  return `${i}. [${c.source} · likely ${c.categoryHint}] ${c.title}\n   ${c.summary.slice(0, summaryLen)}`;
}

function buildUser(
  persona: PersonaRecord,
  categories: CategoryId[],
  candidates: Candidate[],
  memory: MemoryContext,
  priorFingerprints: string[],
  recentCategories: CategoryId[],
  summaryLen: number,
  factCap: number,
): string {
  const priorParts = [...memory.facts.slice(0, factCap), ...priorFingerprints.slice(0, factCap)];
  return [
    personaBlock(persona),
    "",
    categoryBlock(categories),
    "",
    coverageBlock(categories, recentCategories),
    "",
    `PRIOR COVERAGE AND POSITIONS (memory source: ${memory.source}):`,
    priorParts.length > 0 ? priorParts.map((f) => `- ${f}`).join("\n") : "- none yet",
    "",
    `CANDIDATES (${candidates.length}):`,
    ...candidates.map((c, i) => candidateLine(c, i, summaryLen)),
  ].join("\n");
}

export interface JudgeOutcome {
  scored: ScoredCandidate[]; // sorted by total desc
  callsUsed: number;
  servedBy?: string;
}

export async function judgeCandidates(
  persona: PersonaRecord,
  categories: CategoryId[],
  candidates: Candidate[],
  memory: MemoryContext,
  priorFingerprints: string[],
  /** Categories of the most recent posts, newest first. Drives the coverage tilt. */
  recentCategories: CategoryId[] = [],
): Promise<{ ok: true; data: JudgeOutcome } | { ok: false; reason: string }> {
  if (candidates.length === 0) return { ok: false, reason: "no_candidates" };

  const active = categories.length > 0 ? categories : ALL_CATEGORY_IDS;
  const recent = recentCategories.filter((c) => active.includes(c));
  const user = buildUser(persona, active, candidates, memory, priorFingerprints, recent, 300, 10);
  // Compact variant for the 16K-TPM Gemma path: shorter summaries, fewer facts.
  const compactUser = buildUser(persona, active, candidates, memory, priorFingerprints, recent, 80, 5);

  let callsUsed = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await complete({
      system:
        attempt === 0
          ? SYSTEM
          : SYSTEM +
            "\nYour previous reply was not valid JSON of the required shape. Output ONLY the JSON array.",
      user,
      compactUser,
      jsonMode: true,
      // Scaled to the batch. A fixed 3072 was comfortable for the 12-15
      // candidates a normal cycle produces and far too tight for the 34 that
      // WIDE mode yields, so the array came back truncated mid-object — valid
      // JSON nowhere, and the whole day's discovery discarded.
      maxOutputTokens: outputBudgetFor(candidates.length),
    });
    callsUsed++;
    if (!res.ok) return { ok: false, reason: res.reason };

    const raw = parseJson(res.text, isRawScores);
    if (!raw) {
      // Say what actually came back. "invalid JSON" with no sample is the least
      // actionable log line in the system — it cannot distinguish a truncated
      // response from a refusal from a model wrapping the array in prose.
      const text = res.text.trim();
      console.warn(
        `[judge] unusable response from ${res.model} (attempt ${attempt + 1}): ` +
          `${text.length} chars, ends ${JSON.stringify(text.slice(-120))}`,
      );
      continue; // one stricter retry, then give up — never publish unscored
    }

    const scored: ScoredCandidate[] = [];
    for (const s of raw) {
      const c = candidates[s.index];
      if (!c) continue;
      const total =
        Math.round(
          ((s.persona_fit + s.category_fit + s.novelty + s.timeliness + s.non_duplication) / 5) *
            100,
        ) / 100;
      // Fall back to the source's hint if the model invents a category id.
      const category: CategoryId =
        isCategoryId(s.category) && active.includes(s.category)
          ? s.category
          : active.includes(c.categoryHint)
            ? c.categoryHint
            : active[0];
      scored.push({
        ...c,
        scores: {
          persona_fit: s.persona_fit,
          category_fit: s.category_fit,
          novelty: s.novelty,
          timeliness: s.timeliness,
          non_duplication: s.non_duplication,
        },
        total,
        category,
        reason: s.reason.slice(0, 300),
      });
    }
    if (scored.length === 0) continue;
    if (scored.length < candidates.length) {
      // Not fatal, but worth seeing: a model that drops candidates every cycle
      // is quietly shrinking the pool the winner is chosen from.
      console.warn(
        `[judge] scored ${scored.length} of ${candidates.length} candidates — ${candidates.length - scored.length} entries were unusable`,
      );
    }

    scored.sort((a, b) => b.total - a.total);
    return { ok: true, data: { scored, callsUsed, servedBy: res.model } };
  }
  return { ok: false, reason: "judge_json_invalid_after_retry" };
}
