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
import { critique, repairInstruction, severity, summarize } from "./critique";
import { voiceBlock, type VoiceSample } from "./voice";
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
  // EXACTLY, not "up to". The setting reads "N tags" in the UI and the author
  // means N — asking for a range let the model return two when ten were set,
  // and nothing downstream could tell that apart from a deliberate choice.
  const tagRule =
    style.hashtagCount === 0
      ? "hashtags: return an empty array. This author does not use them."
      : `hashtags: EXACTLY ${style.hashtagCount} single-word alphanumeric tags — not fewer, not more. They must each genuinely fit this post and must not repeat or near-repeat one another.`;

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
  /** Few-shot voice references — the author's corpus and published archive. */
  samples?: VoiceSample[];
  /** Standing summary of how this author rewrites the agent. */
  editNotes?: string | null;
  /**
   * How many of the last five PUBLISHED posts carried a signature line.
   *
   * Passed in rather than counted from priorPosts, which includes drafts and
   * rejections. A quote in a draft the author threw away was never seen by
   * anyone, so letting it consume the ration means the signature quietly goes
   * missing for days after a discarded draft happened to use one.
   */
  publishedQuotesInLastFive?: number;
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
  const quotesRecently =
    args.publishedQuotesInLastFive ?? priorPosts.slice(0, 5).filter((p) => p.usedQuote).length;
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

  // Samples go directly after the persona and BEFORE the assignment. Register is
  // set by what the model has just read, so examples arriving after the story
  // has been described influence the output far less.
  //
  // The compact variant carries FEWER samples rather than none: it exists for
  // Gemma's 16K TPM ceiling, and three full posts would blow that budget on
  // their own — but dropping the voice reference entirely would mean the
  // fallback model writes in a noticeably different register from the primary.
  const voiceFull = voiceBlock(args.samples ?? [], args.editNotes);
  const voiceCompact = voiceBlock((args.samples ?? []).slice(0, 1), args.editNotes);

  const build = (factCap: number, summaryLen: number, archiveCap: number, voice: string) =>
    [
      personaBlock(persona),
      // Empty when there are no samples and no edit notes, and the .filter(Boolean)
      // below drops it — so an install that never supplies either gets exactly
      // the prompt it got before this existed.
      voice,
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
      "YOUR RECENT POSTS (newest first, drafts included — for voice variance and continuity):",
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
      user: build(8, 400, 10, voiceFull),
      compactUser: build(3, 150, 4, voiceCompact),
      jsonMode: true,
      maxOutputTokens: 1536,
    });
    callsUsed++;
    if (!res.ok) return { ok: false, reason: res.reason };
    let draft = parseJson(res.text, isDraft);
    if (draft) {
      // The draft is well-formed JSON. Whether it obeys the AUTHOR'S rules is a
      // separate question the model is unreliable about, so check it in code
      // and spend one call repairing what it actually got wrong.
      const repaired = await repairIfNeeded(draft, style, persona, {
        samples: args.samples,
        editNotes: args.editNotes,
      });
      callsUsed += repaired.callsUsed;
      draft = repaired.draft;

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
 * Check a draft against the author's settings and, if it broke them, spend one
 * call fixing the specific failures.
 *
 * Bounded at a single repair attempt on purpose. If the second draft still
 * breaks a rule we keep the BETTER of the two rather than looping: a post with
 * one violation is still publishable and waits in the queue for a human, while
 * an unbounded repair loop would burn quota and could still land nowhere. The
 * remaining violations are logged so a rule the models keep breaking is visible
 * rather than merely absorbed.
 */
async function repairIfNeeded(
  draft: DraftPost,
  style: StyleConfig,
  persona: PersonaRecord,
  voice: VoiceOpt = {},
): Promise<{ draft: DraftPost; callsUsed: number }> {
  const check = { usedQuote: draft.used_quote, hashtags: draft.hashtags ?? [] };
  const violations = critique(draft.text, style, check);
  if (violations.length === 0) return { draft, callsUsed: 0 };

  console.warn(`[writer] draft broke ${violations.length} rule(s): ${summarize(violations)} — repairing`);

  const res = await complete({
    system: `${buildSystem(style)}\n\n${repairInstruction(violations)}`,
    user: withVoice(persona, voice, ["YOUR DRAFT:", draft.text, "", "Return the corrected JSON."]),
    jsonMode: true,
    maxOutputTokens: 1536,
  });

  if (!res.ok) {
    console.warn(`[writer] repair call failed (${res.reason}) — keeping the original draft`);
    return { draft, callsUsed: 1 };
  }

  const fixed = parseJson(res.text, isDraft);
  if (!fixed) {
    console.warn("[writer] repair returned unusable JSON — keeping the original draft");
    return { draft, callsUsed: 1 };
  }

  const fixedTags = fixed.hashtags ?? draft.hashtags ?? [];
  const remaining = critique(fixed.text, style, {
    usedQuote: fixed.used_quote,
    hashtags: fixedTags,
  });
  // Compared by severity, not by violation count. Both drafts being "one
  // violation: too short" says nothing about which is closer to the range, and
  // counting alone discarded every repair that improved the length without
  // completely fixing it — which, on a narrow word range, is most of them.
  if (severity(fixed.text, style, remaining) >= severity(draft.text, style, violations)) {
    console.warn(
      `[writer] repair did not improve the draft (${summarize(remaining)}) — keeping the original`,
    );
    return { draft, callsUsed: 1 };
  }

  if (remaining.length > 0) {
    console.warn(`[writer] ${remaining.length} rule(s) still broken after repair: ${summarize(remaining)}`);
  } else {
    console.log("[writer] repair cleared every violation");
  }
  // Carry the original's metadata: the repair is an edit of the TEXT, and its
  // continuity claim has not been validated against the archive. The TAGS do
  // come across — fixing the tag count is one of the things it was asked to do.
  return {
    draft: { ...draft, text: fixed.text, used_quote: fixed.used_quote, hashtags: fixedTags },
    callsUsed: 1,
  };
}

/**
 * Persona, then the author's voice references, then the task.
 *
 * The same order the cycle's writer prompt uses, so a composer rewrite and an
 * agent-written post look at the same evidence about how this person sounds.
 * Omits the block entirely when there is nothing to show, rather than leaving a
 * labelled empty section — which reads to a model as "this person has no voice".
 */
/** The author's voice references, as every prompt-building function takes them. */
type VoiceOpt = { samples?: VoiceSample[]; editNotes?: string | null };

function withVoice(
  persona: PersonaRecord,
  voice: VoiceOpt,
  task: string[],
): string {
  const refs = voiceBlock(voice.samples ?? [], voice.editNotes);
  return [personaBlock(persona), ...(refs ? ["", refs] : []), "", ...task].join("\n");
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
  /**
   * The author's samples and edit notes. Defaulted rather than required so the
   * signature stays compatible, but every real caller should pass them: without
   * them a rewrite obeys the style toggles and ignores the half of the Voice
   * screen that actually demonstrates a voice.
   */
  voice: VoiceOpt = {},
): Promise<{ ok: true; data: { text: string; hashtags: string[]; servedBy?: string } } | { ok: false; reason: string }> {
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
Respond with JSON exactly: {"text": "...", "rationale": "one line on how this version differs", "fingerprint": "keywords — one-line summary", "continuity": null, "hashtags": ["Tag"], "used_quote": true or false}
${style.hashtagCount === 0
  ? "- hashtags: return an empty array. This author does not use them."
  : `- hashtags: EXACTLY ${style.hashtagCount} single-word alphanumeric tags that fit THIS version — not fewer, not more. They are appended automatically, so do not put them in the text.`}`;

  const res = await complete({
    system,
    user: withVoice(persona, voice, ["CURRENT DRAFT:", draft, "", "Write the alternative version."]),
    jsonMode: true,
    maxOutputTokens: 1536,
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  const parsed = parseJson(res.text, isDraft);
  if (!parsed) return { ok: false, reason: "rewrite_json_invalid" };
  // Held to the author's settings exactly as the cycle's writer is. This ran no
  // check at all before, so "Rewrite with AI" was the one path that could hand
  // back a 400-word post against a 300-word ceiling, or two tags against ten,
  // and nothing anywhere noticed.
  const checked = await repairIfNeeded(parsed, style, persona, voice);
  return {
    ok: true,
    data: {
      text: checked.draft.text.trim(),
      hashtags: checked.draft.hashtags ?? [],
      servedBy: res.model,
    },
  };
}

/**
 * Write a follow-up to a post that has already gone out.
 *
 * Distinct from every other writer here. rewriteDraft produces another
 * treatment of the SAME material and polishCustomPost edits what the author
 * typed; this one starts from a published post and goes somewhere new — the
 * objection it raised and never answered, what happened since, the part that
 * got cut. The original is context, not source material.
 *
 * The hard rule is that it must not restate the original. A follow-up that
 * re-explains what everyone already read is the most common way this goes
 * wrong, and it is worse than posting nothing: it spends a slot telling the
 * same audience the same thing.
 *
 * Nothing is saved. The composer shows the text and the author decides, exactly
 * as with a rewrite — a follow-up is a suggestion about what to write next, not
 * a post written on somebody's behalf.
 */
export async function writeFollowUp(
  persona: PersonaRecord,
  original: { text: string; publishedAt: string | null },
  style: StyleConfig = DEFAULT_STYLE,
  voice: VoiceOpt = {},
): Promise<
  { ok: true; data: { text: string; hashtags: string[]; servedBy?: string } } | { ok: false; reason: string }
> {
  const system = `${buildSystem(style)}

OVERRIDE FOR THIS TASK: you are writing a FOLLOW-UP to a post this author already published.
- The original is CONTEXT, not material. Do not summarise it, do not restate its argument, and do not re-explain its terms. The people reading this have already seen it.
- Go somewhere the original did not. A good follow-up does one of these: answers the objection it raised and left hanging, reports what has actually happened since, takes the specific case where the original was general, or admits where it turned out to be wrong.
- Refer back to it briefly and naturally, the way a person picks a thought up days later — one clause, never a recap paragraph.
- Invent nothing. With no new facts, take a position the original implied but never stated outright. That is a real follow-up; a reworded original is not.
- It must stand alone. Someone who missed the first post still has to get something complete out of this one.
Respond with JSON exactly: {"text": "...", "rationale": "one line on what this adds", "fingerprint": "keywords — one-line summary", "continuity": null, "hashtags": ["Tag"], "used_quote": true or false}
${
  style.hashtagCount === 0
    ? "- hashtags: return an empty array. This author does not use them."
    : `- hashtags: EXACTLY ${style.hashtagCount} single-word alphanumeric tags that fit THIS post — not fewer, not more. They are appended automatically, so do not put them in the text.`
}`;

  const res = await complete({
    system,
    user: withVoice(persona, voice, [
      original.publishedAt
        ? `THE POST YOU ARE FOLLOWING UP (published ${original.publishedAt}):`
        : "THE POST YOU ARE FOLLOWING UP:",
      original.text,
      "",
      "Write the follow-up.",
    ]),
    jsonMode: true,
    maxOutputTokens: 1536,
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  const parsed = parseJson(res.text, isDraft);
  if (!parsed) return { ok: false, reason: "followup_json_invalid" };

  // Held to the author's settings like everything else the writer produces.
  const checked = await repairIfNeeded(parsed, style, persona, voice);
  return {
    ok: true,
    data: {
      text: checked.draft.text.trim(),
      hashtags: checked.draft.hashtags ?? [],
      servedBy: res.model,
    },
  };
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
  voice: VoiceOpt = {},
): Promise<{ ok: true; data: { text: string; hashtags: string[]; servedBy?: string } } | { ok: false; reason: string }> {
  const system = `${buildSystem(style)}

OVERRIDE FOR THIS TASK: you are editing the author's OWN draft, not choosing a story.
- Keep their meaning, their facts, and anything personal exactly as they meant it. Never invent details, numbers, or events they did not mention.
- Fix the hook so the first line carries the point. Cut filler. Tighten. Preserve their intent even where you would have written it differently.
- Reshape the draft to the structure rules above — if they call for bullets and the author wrote prose, convert it. Their words, your layout.
- If the draft is already good, return it nearly unchanged. Do not pad it to look like work.
- Do NOT add a signature line that was not there unless the draft is obviously reaching for one.
Respond with JSON exactly: {"text": "...", "rationale": "one line on what you changed", "fingerprint": "keywords — one-line summary", "continuity": null, "hashtags": ["Tag"], "used_quote": true or false}
${style.hashtagCount === 0
  ? "- hashtags: return an empty array. This author does not use them."
  : `- hashtags: EXACTLY ${style.hashtagCount} single-word alphanumeric tags that fit THIS version — not fewer, not more. They are appended automatically, so do not put them in the text.`}`;

  const res = await complete({
    system,
    // The author's own samples matter more here than anywhere else: this is
    // their draft being edited, and the point is that it comes back sounding
    // like them rather than like the house style.
    user: withVoice(persona, voice, ["AUTHOR'S DRAFT:", draft, "", "Return the edited post."]),
    jsonMode: true,
    maxOutputTokens: 1536,
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  const parsed = parseJson(res.text, isDraft);
  if (!parsed) return { ok: false, reason: "polish_json_invalid" };
  const checked = await repairIfNeeded(parsed, style, persona, voice);
  return {
    ok: true,
    data: {
      text: checked.draft.text,
      hashtags: checked.draft.hashtags ?? [],
      servedBy: res.model,
    },
  };
}
