/**
 * Post style configuration — the voice rules, lifted out of the writer prompt
 * and made per-agent data.
 *
 * Every constraint here used to be a hardcoded line in writer.ts's SYSTEM
 * string: no emojis, no bullets, no CTA, 120-220 words, two hashtags, the
 * rationed Marvel line. Those rules are a real editorial opinion and a good
 * one for a working engineer's own profile — but they are ONE opinion, and a
 * second user of this app will want a different one. So they become settings
 * with DEFAULT_STYLE reproducing the previous behaviour exactly: an existing
 * install that never touches these controls writes what it wrote yesterday.
 *
 * Two rules are NOT configurable, because they are facts about LinkedIn rather
 * than matters of taste:
 *   - No markdown. LinkedIn renders none of it; asterisks appear literally.
 *   - The first line carries the post, because everything past ~210 characters
 *     is behind "see more".
 * Bullets therefore mean literal unicode marks (see BULLET_MARK) and hard line
 * breaks, which lib/format.ts's tidy() preserves — not "- " markdown, which
 * would publish as a stray hyphen.
 */

/** The bullet character used when structure is "bullets". Renders everywhere LinkedIn does. */
/**
 * Ceiling on hashtags per post.
 *
 * Raised from 5 at the author's request. The house style still defaults to two
 * — beyond a handful they stop marking a topic and start looking like reach
 * farming — but that is a matter of taste and belongs to whoever is posting,
 * not to this file.
 */
export const MAX_HASHTAGS = 15;

export const BULLET_MARK = "→";

export type Structure = "prose" | "bullets" | "short-lines" | "mixed";
export type EmojiPolicy = "none" | "sparing" | "expressive";
export type HookIntensity = "plain" | "sharp" | "bold";
export type CtaPolicy = "none" | "soft" | "direct";
export type Register = "practitioner" | "peer" | "accessible";

/**
 * A rationed catchphrase — generalized from the original Marvel-quote rule.
 * The rationing is the whole point: a well-chosen quote is a voice, the same
 * quote every day is a tic, so the writer is told how heavily it has leaned on
 * this lately and expected to back off.
 */
export interface SignatureConfig {
  /** Where the lines come from, in the user's words: "Marvel films", "F1", "jazz records". */
  source: string;
  /** Hard word cap on the quoted line. */
  maxWords: number;
  /** At most this many of the last five posts may carry one. 0 disables it. */
  budgetPerFive: number;
  /** Overexposed lines banned outright as generic inspiration. */
  banned: string[];
}

export interface StyleConfig {
  /** Paragraphs, a unicode bullet list, punchy one-liners, or a lead plus bullets. */
  structure: Structure;
  emoji: EmojiPolicy;
  /** How hard the first line pushes. It is always the hook; this is about volume. */
  hook: HookIntensity;
  /** Whether the post closes by asking for engagement. */
  cta: CtaPolicy;
  /** Target body length, in words. */
  minWords: number;
  maxWords: number;
  /** How many hashtags lib/format.ts appends. 0-5. */
  hashtagCount: number;
  register: Register;
  /** Rationed catchphrase, or null for none. */
  signature: SignatureConfig | null;
  /** Free-text rules appended verbatim to the prompt. The escape hatch. */
  customRules: string[];
  /** Phrases the writer must never emit. */
  bannedPhrases: string[];
}

/**
 * The house style: exactly the rules that were hardcoded in writer.ts before
 * this file existed. Do not "improve" these defaults — changing them silently
 * changes the voice of every existing install.
 */
export const DEFAULT_STYLE: StyleConfig = {
  structure: "prose",
  emoji: "none",
  hook: "sharp",
  cta: "none",
  minWords: 120,
  maxWords: 220,
  hashtagCount: 2,
  register: "practitioner",
  signature: {
    source: "Marvel films",
    maxWords: 12,
    budgetPerFive: 1,
    banned: [
      "With great power comes great responsibility",
      "I am Iron Man",
      "Avengers, assemble",
      "I can do this all day",
    ],
  },
  customRules: [],
  bannedPhrases: [
    "Here's the thing",
    "Let that sink in",
    "Read that again",
    "Thoughts?",
    "Agree?",
    "game-changer",
    "This is huge",
    "I'm excited to announce",
  ],
};

/**
 * Named starting points. These only fill in a StyleConfig — every field stays
 * individually editable afterwards, so a preset is a shortcut, never a mode.
 */
export const PRESETS: Record<string, { label: string; blurb: string; style: StyleConfig }> = {
  practitioner: {
    label: "Practitioner",
    blurb: "Restrained prose, no emojis, no call to action. Written for colleagues who would mute a growth account.",
    style: DEFAULT_STYLE,
  },
  builder: {
    label: "Builder",
    blurb: "A lead paragraph then scannable bullets, occasional emoji, a light question at the end.",
    style: {
      ...DEFAULT_STYLE,
      structure: "mixed",
      emoji: "sparing",
      cta: "soft",
      minWords: 100,
      maxWords: 180,
      hashtagCount: 3,
    },
  },
  operator: {
    label: "Operator",
    blurb: "Short punchy lines, a bold opening claim, direct ask at the close. Highest-reach register.",
    style: {
      ...DEFAULT_STYLE,
      structure: "short-lines",
      emoji: "expressive",
      hook: "bold",
      cta: "direct",
      minWords: 80,
      maxWords: 150,
      hashtagCount: 4,
      register: "accessible",
      signature: null,
      bannedPhrases: [],
    },
  },
  explainer: {
    label: "Explainer",
    blurb: "Teaching voice for a mixed audience: full bullets, plain language, no jargon left unexplained.",
    style: {
      ...DEFAULT_STYLE,
      structure: "bullets",
      emoji: "sparing",
      hook: "plain",
      cta: "soft",
      minWords: 130,
      maxWords: 240,
      hashtagCount: 3,
      register: "accessible",
      signature: null,
    },
  },
};

// ------------------------------------------------------------------ parsing

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function stringList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= maxLen)
    .slice(0, maxItems);
}

function parseSignature(v: unknown): SignatureConfig | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<SignatureConfig>;
  const source = typeof o.source === "string" ? o.source.trim() : "";
  if (!source) return null;
  const budgetPerFive = clamp(o.budgetPerFive, 0, 5, 1);
  // A budget of zero is how the UI turns the signature off; normalize it to
  // null so every downstream reader has exactly one "no signature" case.
  if (budgetPerFive === 0) return null;
  return {
    source: source.slice(0, 80),
    maxWords: clamp(o.maxWords, 3, 30, 12),
    budgetPerFive,
    banned: stringList(o.banned, 20, 120),
  };
}

/**
 * Parse whatever is in agents.style_json into a complete, valid StyleConfig.
 * Never throws and never returns partial data: an empty object, a null, or a
 * hand-edited row full of nonsense all resolve to DEFAULT_STYLE fields, so the
 * writer prompt is always well-formed.
 */
export function parseStyle(v: unknown): StyleConfig {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ...DEFAULT_STYLE };
  const o = v as Partial<StyleConfig>;

  const minWords = clamp(o.minWords, 40, 400, DEFAULT_STYLE.minWords);
  // Keep the window sane whatever arrives: a max below the min would produce an
  // impossible instruction ("write 200-80 words") that the model resolves at random.
  const maxWords = clamp(o.maxWords, minWords + 20, 500, Math.max(minWords + 20, DEFAULT_STYLE.maxWords));

  return {
    structure: oneOf(o.structure, ["prose", "bullets", "short-lines", "mixed"], DEFAULT_STYLE.structure),
    emoji: oneOf(o.emoji, ["none", "sparing", "expressive"], DEFAULT_STYLE.emoji),
    hook: oneOf(o.hook, ["plain", "sharp", "bold"], DEFAULT_STYLE.hook),
    cta: oneOf(o.cta, ["none", "soft", "direct"], DEFAULT_STYLE.cta),
    minWords,
    maxWords,
    hashtagCount: clamp(o.hashtagCount, 0, MAX_HASHTAGS, DEFAULT_STYLE.hashtagCount),
    register: oneOf(o.register, ["practitioner", "peer", "accessible"], DEFAULT_STYLE.register),
    // These three use presence rather than truthiness: an ABSENT key means
    // "unset, use the house default", while an explicitly supplied empty array
    // means "I want none of these". Reading a missing key as an empty list
    // would silently strip the default banned phrases from every agent whose
    // style_json predates this column.
    signature: "signature" in o ? parseSignature(o.signature) : DEFAULT_STYLE.signature,
    customRules: "customRules" in o ? stringList(o.customRules, 12, 240) : DEFAULT_STYLE.customRules,
    bannedPhrases:
      "bannedPhrases" in o ? stringList(o.bannedPhrases, 40, 80) : DEFAULT_STYLE.bannedPhrases,
  };
}

// ------------------------------------------------------------------ prompting

const STRUCTURE_RULES: Record<Structure, string> = {
  prose:
    "STRUCTURE: paragraphs of 2-4 sentences, two or three paragraphs total. No lists. No one-sentence-per-line drama stacking.",
  bullets: `STRUCTURE: one short lead sentence, then 3-5 bullet lines, then one closing sentence. Start each bullet with "${BULLET_MARK} " on its own line — that exact character, never "-", "*" or "1." (LinkedIn renders no markdown, so those publish literally). Each bullet is one line, under 20 words, and carries a real point rather than a fragment.`,
  "short-lines":
    "STRUCTURE: short punchy lines, most of them one sentence, separated by single line breaks. Group into two or three clusters with a blank line between. This is the highest-energy register — every line must still say something concrete.",
  mixed: `STRUCTURE: a 2-3 sentence lead paragraph that carries the argument, then 3-4 scannable bullet lines each beginning with "${BULLET_MARK} " on its own line (that exact character — LinkedIn renders no markdown), then a one-sentence close. Never "-", "*" or "1.".`,
};

const EMOJI_RULES: Record<EmojiPolicy, string> = {
  none: "EMOJI: none at all. Not in the body, not as bullets, not as decoration.",
  sparing:
    "EMOJI: at most two in the whole post, and only where one genuinely replaces a word or marks a section. Never as bullet points, never in the first line, never decorative. If none fit, use none.",
  expressive:
    "EMOJI: use them naturally to punctuate and to mark sections, roughly one every two or three lines. Never more than one in a row, and never in place of an actual point.",
};

const HOOK_RULES: Record<HookIntensity, string> = {
  plain:
    "HOOK: open by plainly stating the subject and why it matters. Calm and informative, not a pitch.",
  sharp:
    "HOOK: open with the concrete, specific thing — a fact, a number, or a claim someone could disagree with. Never a tease, never throat-clearing, never \"I've been thinking about...\".",
  bold: "HOOK: open with your strongest, most surprising claim, stated flatly in under 12 words. It must be something the post actually goes on to support — a bold opening you then walk back is the worst outcome here.",
};

const CTA_RULES: Record<CtaPolicy, string> = {
  none: "CLOSE: end on your last real point. No call to engage, no question to the reader, no invitation to comment.",
  soft: "CLOSE: you may end with ONE short, genuine question that a knowledgeable reader would actually want to answer — a real open problem, not \"Thoughts?\" or \"Agree?\".",
  direct:
    "CLOSE: end with one clear, specific ask — comment with your own experience, share it, or try the thing. One line, and specific about what you want.",
};

const REGISTER_RULES: Record<Register, string> = {
  practitioner:
    "REGISTER: a working practitioner with an opinion, writing for peers. Assume domain knowledge; never explain the basics.",
  peer: "REGISTER: a knowledgeable colleague explaining something to a broad professional audience. Define jargon in passing, without condescending.",
  accessible:
    "REGISTER: plain language for a mixed audience, most of whom are not specialists. Every technical term gets a short plain-English gloss the first time.",
};

/**
 * Render the style as the prompt's constraint block. Shared by the daily writer
 * and the composer's polish action so a user's manual drafts get edited toward
 * the same voice their automated posts are written in.
 */
export function styleBlock(style: StyleConfig): string {
  const lines: string[] = [
    "HARD VOICE CONSTRAINTS — violating any of these is a failure:",
    STRUCTURE_RULES[style.structure],
    EMOJI_RULES[style.emoji],
    HOOK_RULES[style.hook],
    CTA_RULES[style.cta],
    REGISTER_RULES[style.register],
    `LENGTH: ${style.minWords}-${style.maxWords} words.`,
    "NO markdown of any kind. LinkedIn renders none of it — asterisks, backticks and brackets appear literally on screen.",
    "The FIRST LINE is the whole hook: everything past ~210 characters is hidden behind \"see more\".",
    "Be specific enough to be wrong. Name the actual technology, the actual tradeoff, the actual number. Vagueness is the failure mode that makes these posts worthless.",
  ];

  if (style.bannedPhrases.length > 0) {
    lines.push(
      `BANNED PHRASES — never write any of these, in any casing: ${style.bannedPhrases
        .map((p) => `"${p}"`)
        .join(", ")}.`,
    );
  }

  if (style.signature) {
    const s = style.signature;
    lines.push(
      "",
      `THE SIGNATURE LINE — this person's trademark, drawn from ${s.source}, used with discipline:`,
      `- At most ONE short quote (under ${s.maxWords} words), attributed inline after an em dash.`,
      "- It must illuminate the TECHNICAL point. The connection has to be real: a quote about improvisation over a story about live-coding a set is earned; a quote about heroism over a product launch is not.",
      s.banned.length > 0
        ? `- BANNED as generic inspiration: ${s.banned.map((b) => `"${b}"`).join(", ")} — unless the story gives you a genuinely specific reason to reach for exactly that line.`
        : "",
      "- If no line fits this story, USE NONE. A forced quote is far worse than none, and reads as a bot with a gimmick. Most posts should have none.",
      '- Set "used_quote" to whether you actually included one.',
    );
  } else {
    lines.push("", 'NO catchphrase or signature quote. Always set "used_quote" to false.');
  }

  if (style.customRules.length > 0) {
    lines.push("", "ADDITIONAL RULES FROM THE AUTHOR — these override anything above that conflicts:");
    for (const rule of style.customRules) lines.push(`- ${rule}`);
  }

  return lines.filter((l) => l !== "").join("\n");
}

/**
 * How heavily the signature has been used lately, rendered as budget guidance.
 * Kept here beside the config it enforces rather than in the writer, so the
 * ration and the rule that defines it cannot drift apart.
 */
export function signatureBudget(style: StyleConfig, quotesInLastFive: number): string {
  if (!style.signature) return "";
  const budget = style.signature.budgetPerFive;
  if (quotesInLastFive === 0) {
    return `You have used no signature line in your recent posts. If one genuinely fits today's story, this is a good moment for it.`;
  }
  if (quotesInLastFive < budget) {
    return `You used a signature line ${quotesInLastFive} time(s) in your last 5 posts, against a budget of ${budget}. Another is fine only if it clearly earns its place.`;
  }
  return `You used a signature line in ${quotesInLastFive} of your last 5 posts, at or over your budget of ${budget}. Do NOT use one today unless it is undeniable.`;
}
