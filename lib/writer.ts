/**
 * Post writing: one LLM call producing the post body, its rationale, a
 * fingerprint, hashtag suggestions and an optional continuity reference — all
 * in the persisted persona's voice.
 *
 * The model writes the BODY ONLY. Source links and hashtags are appended
 * deterministically in lib/format.ts.
 *
 * The voice constraints themselves live in lib/style.ts as per-agent data, not
 * here as constants. That split matters: the default style is a strong
 * editorial opinion — no emojis, no bullets, no call to engage — which is
 * right for a working engineer's own profile and wrong for plenty of other
 * people. styleBlock() renders whichever opinion this agent holds; everything
 * in this file is about the machinery around it.
 *
 * What stays hardcoded is the part that is not a matter of taste: the JSON
 * contract, the continuity rules, and the rationing mechanism that stops a
 * signature catchphrase from becoming a tic.
 */
import type { CategoryId } from "./categories";
import { CATEGORIES } from "./categories";
import type { ScoredCandidate } from "./judge";
import { complete, parseJson } from "./llm";
import type { MemoryContext } from "./memory";
import type { PersonaRecord } from "./persona";
import { personaBlock } from "./persona";
import type { StyleConfig } from "./style";
import { DEFAULT_STYLE, signatureBudget, styleBlock } from "./style";

export interface PriorPost {
  id: string;
  fingerprint: string;
  opening: string; // first ~90 chars of the post text
  usedQuote?: boolean;
}

export interface DraftPost {
  text: string;
  rationale: string;
  fingerprint: string;
  continuity: string | null;
  hashtags: string[];
  used_quote: boolean;
}

function isDraft(v: unknown): v is DraftPost {
  const o = v as DraftPost;
  return (
    !!o &&
    typeof o.text === "string" &&
    o.text.length > 100 &&
    typeof o.rationale === "string" &&
    o.rationale.length > 60 &&
    typeof o.fingerprint === "string" &&
    o.fingerprint.length > 10 &&
    (o.continuity === null || o.continuity === undefined || typeof o.continuity === "string") &&
    (o.hashtags === undefined ||
      (Array.isArray(o.hashtags) && o.hashtags.every((h) => typeof h === "string"))) &&
    typeof o.used_quote === "boolean"
  );
}

function buildSystem(style: StyleConfig): string {
  const tagRule =
    style.hashtagCount === 0
      ? "hashtags: return an empty array. This author does not use them."
      : `hashtags: 0-${style.hashtagCount} single-word alphanumeric tags. ${style.hashtagCount} is the maximum and zero is perfectly acceptable.`;

  return `You write LinkedIn posts as a specific person, posting about things they actually find interesting. Follow their voice exactly.

${styleBlock(style)}

CONTINUITY — real memory, never manufactured:
- If one archive entry takes a position genuinely related to today's story, reference it in the body as your own earlier position, naturally. Set "continuity" to that archive post's id.
- If nothing is genuinely related — the common case — set "continuity" to null and make no callback.

Respond with JSON exactly:
{"text": "...", "rationale": "...", "fingerprint": "...", "continuity": "p3" or null, "hashtags": ["Tag"], "used_quote": true or false}
- text: the post BODY ONLY. Do not include the source URL and do not include hashtags — both are appended automatically afterwards. Including them yourself produces duplicates.
- rationale: 2-4 sentences of genuine editorial reasoning in your own voice — why this earned today's slot, why now, what it beat. Vary the structure between posts; never the fixed formula "This was selected because... It is relevant because... It beat...".
- fingerprint: topic keywords plus a one-line summary of the post's claim.
- ${tagRule}`;
}

export interface WriteArgs {
  persona: PersonaRecord;
  /** The agent's voice configuration. Omitted falls back to the house style. */
  style?: StyleConfig;
  winner: ScoredCandidate;
  runnersUp: ScoredCandidate[];
  memory: MemoryContext;
  priorPosts: PriorPost[];
}

export async function writePost(
  args: WriteArgs,
): Promise<
  { ok: true; data: DraftPost & { callsUsed: number; servedBy?: string } } | { ok: false; reason: string }
> {
  const { persona, winner, runnersUp, memory, priorPosts } = args;
  const style = args.style ?? DEFAULT_STYLE;
  const system = buildSystem(style);
  const category = CATEGORIES[winner.category as CategoryId];

  const runnerLines =
    runnersUp.length > 0
      ? runnersUp.map((r) => `- "${r.title}" (scored ${r.total}): ${r.reason}`).join("\n")
      : "- none today";

  // Ration the signature: tell the model how heavily it has leaned on quotes
  // lately and let it back off, rather than firing a quote every single time.
  // Empty when the agent has no signature configured at all.
  const quotesRecently = priorPosts.slice(0, 5).filter((p) => p.usedQuote).length;
  const quoteGuidance = signatureBudget(style, quotesRecently);

  const archive = (cap: number) =>
    priorPosts.length > 0
      ? priorPosts
          .slice(0, cap)
          .map(
            (p) =>
              `- ${p.id} (opens: "${p.opening}…")${p.usedQuote ? " [used a quote]" : ""} — ${p.fingerprint}`,
          )
          .join("\n")
      : "- none yet (this is your first post — continuity must be null)";

  const build = (factCap: number, summaryLen: number, archiveCap: number) =>
    [
      personaBlock(persona),
      "",
      `TODAY'S CATEGORY: ${category?.label ?? winner.category}`,
      category ? `What belongs here: ${category.blurb}` : "",
      style.hashtagCount > 0
        ? `Suggested hashtag vocabulary (pick at most ${style.hashtagCount}, or none): ${(category?.hashtags ?? []).join(", ")}`
        : "",
      "",
      `SELECTED STORY (scored ${winner.total} — persona fit ${winner.scores.persona_fit}, category fit ${winner.scores.category_fit}, novelty ${winner.scores.novelty}, timeliness ${winner.scores.timeliness}, non-duplication ${winner.scores.non_duplication}):`,
      `Title: ${winner.title}`,
      `Source: ${winner.url}`,
      `Summary: ${winner.summary.slice(0, summaryLen)}`,
      `Judge's reason: ${winner.reason}`,
      "",
      "RUNNERS-UP IT BEAT TODAY:",
      runnerLines,
      "",
      "YOUR PUBLISHED ARCHIVE (newest first — for voice variance and continuity):",
      archive(archiveCap),
      "",
      quoteGuidance ? `SIGNATURE LINE BUDGET: ${quoteGuidance}` : "",
      "",
      `MEMORY — recalled editorial positions (source: ${memory.source}):`,
      memory.facts.length > 0
        ? memory.facts.slice(0, factCap).map((f) => `- ${f}`).join("\n")
        : "- none recalled",
      "",
      "Write the post now.",
    ]
      .filter(Boolean)
      .join("\n");

  let callsUsed = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await complete({
      system:
        attempt === 0
          ? system
          : system +
            "\nYour previous reply was not valid JSON of the required shape. Output ONLY the JSON object.",
      user: build(8, 400, 10),
      compactUser: build(3, 150, 4),
      jsonMode: true,
      maxOutputTokens: 1536,
    });
    callsUsed++;
    if (!res.ok) return { ok: false, reason: res.reason };
    const draft = parseJson(res.text, isDraft);
    if (draft) {
      // Continuity must name a real archive post — anything else becomes null.
      const validIds = new Set(priorPosts.map((p) => p.id));
      const continuity = draft.continuity && validIds.has(draft.continuity) ? draft.continuity : null;
      return {
        ok: true,
        data: {
          ...draft,
          continuity,
          hashtags: (draft.hashtags ?? []).slice(0, style.hashtagCount),
          callsUsed,
          servedBy: res.model,
        },
      };
    }
  }
  return { ok: false, reason: "writer_json_invalid_after_retry" };
}

/**
 * Produce a genuinely DIFFERENT treatment of the same material.
 *
 * Distinct from polishCustomPost, which is conservative by design and told to
 * return a good draft nearly unchanged. That is the wrong behaviour when the
 * user is asking to see another option: handing back the same text with two
 * commas moved looks broken. So this one is instructed to change the angle —
 * a different entry point, a different structure — while holding the facts
 * fixed, because the facts came from a real source and inventing new ones
 * would be the one unforgivable failure here.
 *
 * Nothing is saved. The caller shows the variant and lets a human decide.
 */
export async function rewriteDraft(
  persona: PersonaRecord,
  draft: string,
  style: StyleConfig = DEFAULT_STYLE,
  attempt = 0,
): Promise<{ ok: true; data: { text: string; servedBy?: string } } | { ok: false; reason: string }> {
  const angles = [
    "Open from a different entry point than the current draft — if it opens with the result, open with the problem, and vice versa.",
    "Restructure the argument: lead with the consequence and work backwards to the mechanism.",
    "Tighten hard. Same points, noticeably fewer words, sharper first line.",
    "Foreground the tradeoff or the objection the current draft leaves implicit.",
  ];

  const system = `${buildSystem(style)}

OVERRIDE FOR THIS TASK: you are producing an ALTERNATIVE version of an existing draft, for a human to choose between.
- The FACTS are fixed. Every technology, number, name and claim in the original must survive unchanged. Invent nothing.
- The TREATMENT must genuinely differ. ${angles[attempt % angles.length]}
- Returning something close to the original is a failure — the whole point is to give a real choice.
- Obey every voice constraint above; those are the author's settings, not the original draft's habits.
Respond with JSON exactly: {"text": "...", "rationale": "one line on how this version differs", "fingerprint": "keywords — one-line summary", "continuity": null, "hashtags": [], "used_quote": true or false}`;

  const res = await complete({
    system,
    user: [personaBlock(persona), "", "CURRENT DRAFT:", draft, "", "Write the alternative version."].join("\n"),
    jsonMode: true,
    maxOutputTokens: 1536,
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  const parsed = parseJson(res.text, isDraft);
  if (!parsed) return { ok: false, reason: "rewrite_json_invalid" };
  return { ok: true, data: { text: parsed.text.trim(), servedBy: res.model } };
}

/**
 * Rewrite a user's own draft in the persona's voice, preserving their meaning.
 * Used by the composer's optional "polish" action — deliberately conservative:
 * it is the user's post, so this tightens the hook and strips influencer tics
 * rather than reinventing what they wanted to say.
 */
export async function polishCustomPost(
  persona: PersonaRecord,
  draft: string,
  style: StyleConfig = DEFAULT_STYLE,
): Promise<{ ok: true; data: { text: string; servedBy?: string } } | { ok: false; reason: string }> {
  const system = `${buildSystem(style)}

OVERRIDE FOR THIS TASK: you are editing the author's OWN draft, not choosing a story.
- Keep their meaning, their facts, and anything personal exactly as they meant it. Never invent details, numbers, or events they did not mention.
- Fix the hook so the first line carries the point. Cut filler. Tighten. Preserve their intent even where you would have written it differently.
- Reshape the draft to the structure rules above — if they call for bullets and the author wrote prose, convert it. Their words, your layout.
- If the draft is already good, return it nearly unchanged. Do not pad it to look like work.
- Do NOT add a signature line that was not there unless the draft is obviously reaching for one.
Respond with JSON exactly: {"text": "...", "rationale": "one line on what you changed", "fingerprint": "keywords — one-line summary", "continuity": null, "hashtags": [], "used_quote": true or false}`;

  const res = await complete({
    system,
    user: [personaBlock(persona), "", "AUTHOR'S DRAFT:", draft, "", "Return the edited post."].join("\n"),
    jsonMode: true,
    maxOutputTokens: 1536,
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  const parsed = parseJson(res.text, isDraft);
  if (!parsed) return { ok: false, reason: "polish_json_invalid" };
  return { ok: true, data: { text: parsed.text, servedBy: res.model } };
}
