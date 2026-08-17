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
import { ALL_CATEGORY_IDS, categoryBlock, isCategoryId } from "./categories";
import type { Candidate } from "./discovery";
import { complete, parseJson } from "./llm";
import type { MemoryContext } from "./memory";
import type { PersonaRecord } from "./persona";
import { personaBlock } from "./persona";

export const PUBLISH_THRESHOLD = 6.5;

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

function isRawScores(v: unknown): v is RawScore[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (s: RawScore) =>
        typeof s?.index === "number" &&
        inRange(s.persona_fit) &&
        inRange(s.category_fit) &&
        inRange(s.novelty) &&
        inRange(s.timeliness) &&
        inRange(s.non_duplication) &&
        typeof s.category === "string" &&
        typeof s.reason === "string",
    )
  );
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

function candidateLine(c: Candidate, i: number, summaryLen: number): string {
  return `${i}. [${c.source} · likely ${c.categoryHint}] ${c.title}\n   ${c.summary.slice(0, summaryLen)}`;
}

function buildUser(
  persona: PersonaRecord,
  categories: CategoryId[],
  candidates: Candidate[],
  memory: MemoryContext,
  priorFingerprints: string[],
  summaryLen: number,
  factCap: number,
): string {
  const priorParts = [...memory.facts.slice(0, factCap), ...priorFingerprints.slice(0, factCap)];
  return [
    personaBlock(persona),
    "",
    categoryBlock(categories),
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
): Promise<{ ok: true; data: JudgeOutcome } | { ok: false; reason: string }> {
  if (candidates.length === 0) return { ok: false, reason: "no_candidates" };

  const active = categories.length > 0 ? categories : ALL_CATEGORY_IDS;
  const user = buildUser(persona, active, candidates, memory, priorFingerprints, 300, 10);
  // Compact variant for the 16K-TPM Gemma path: shorter summaries, fewer facts.
  const compactUser = buildUser(persona, active, candidates, memory, priorFingerprints, 80, 5);

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
      maxOutputTokens: 3072,
    });
    callsUsed++;
    if (!res.ok) return { ok: false, reason: res.reason };

    const raw = parseJson(res.text, isRawScores);
    if (!raw) continue; // one stricter retry, then give up — never publish unscored

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

    scored.sort((a, b) => b.total - a.total);
    return { ok: true, data: { scored, callsUsed, servedBy: res.model } };
  }
  return { ok: false, reason: "judge_json_invalid_after_retry" };
}
