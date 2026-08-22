/**
 * Deterministic verification of a draft against the author's own voice
 * settings.
 *
 * Every rule in lib/style.ts is stated in the prompt and, until this file
 * existed, verified nowhere. isDraft() in writer.ts only checked that the JSON
 * had the right shape and the text was over 100 characters, so a model that
 * returned 400 words against a 220-word cap, opened with a banned phrase, or
 * pasted the source URL into the body produced a draft nobody flagged.
 *
 * That is the wrong division of labour. A language model is good at writing and
 * unreliable at counting; code is the reverse. So the prompt asks, and this
 * checks — and when the check fails the writer gets ONE repair call naming the
 * exact violation, which works far better than restating the rule louder.
 *
 * Nothing here is a matter of taste. Every rule is either arithmetic (word
 * counts, character limits) or a fact about LinkedIn (it renders no markdown;
 * hashtags and source links are appended by lib/format.ts and duplicate if the
 * body carries its own).
 */
import { FOLD_CHARS } from "./format";
import { BULLET_MARK, type StyleConfig } from "./style";

export interface Violation {
  /** Short stable id, for logs and for counting which rules models break. */
  rule: string;
  /** Written at the model: names the failure and what to do about it. */
  detail: string;
}

/** Emoji, including the pictographic ranges people actually use on LinkedIn. */
const EMOJI = /\p{Extended_Pictographic}/u;
const EMOJI_GLOBAL = /\p{Extended_Pictographic}/gu;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The first sentence — the part that has to land before the fold.
 *
 * Checking the whole first LINE would be wrong for prose, where an opening
 * paragraph of 2-4 sentences routinely runs past 210 characters by design.
 * What actually matters is whether the opening claim survives truncation.
 */
export function firstSentence(text: string): string {
  const firstLine = text.trim().split("\n")[0] ?? "";
  const match = /^[\s\S]*?[.!?](?=\s|$)/.exec(firstLine);
  return (match?.[0] ?? firstLine).trim();
}

export function critique(
  text: string,
  style: StyleConfig,
  options: {
    usedQuote?: boolean;
    /**
     * The tags the model returned. OMITTED means "not checked" — the caller
     * has no tag list to judge, which is different from a post with none.
     */
    hashtags?: string[];
  } = {},
): Violation[] {
  const out: Violation[] = [];
  const body = text.trim();
  const lines = body.split("\n").map((l) => l.trim());

  // ---- length
  const words = countWords(body);
  if (words < style.minWords) {
    out.push({
      rule: "too_short",
      detail: `The post is ${words} words. Your setting is ${style.minWords}-${style.maxWords}. Add substance — another concrete detail or consequence — rather than padding.`,
    });
  } else if (words > style.maxWords) {
    out.push({
      rule: "too_long",
      detail: `The post is ${words} words. Your setting is ${style.minWords}-${style.maxWords}. Cut to length, removing the least specific sentences first.`,
    });
  }

  // ---- banned phrases
  const lowered = body.toLowerCase();
  for (const phrase of style.bannedPhrases) {
    if (lowered.includes(phrase.toLowerCase())) {
      out.push({
        rule: "banned_phrase",
        detail: `Contains the banned phrase "${phrase}". Remove it and say the thing directly.`,
      });
    }
  }

  // ---- emoji policy
  const emojiCount = (body.match(EMOJI_GLOBAL) ?? []).length;
  if (style.emoji === "none" && emojiCount > 0) {
    out.push({
      rule: "emoji_forbidden",
      detail: `Contains ${emojiCount} emoji. This author uses none at all — remove every one.`,
    });
  } else if (style.emoji === "sparing") {
    if (emojiCount > 2) {
      out.push({
        rule: "emoji_excess",
        detail: `Contains ${emojiCount} emoji against a limit of 2. Keep at most the two that genuinely replace a word.`,
      });
    }
    if (EMOJI.test(lines[0] ?? "")) {
      out.push({
        rule: "emoji_in_hook",
        detail: "An emoji appears in the first line. The hook must be words only.",
      });
    }
  }

  // ---- markdown. LinkedIn renders none of it; the characters publish literally.
  if (/\*\*[^*]+\*\*|__[^_]+__/.test(body)) {
    out.push({
      rule: "markdown_bold",
      detail:
        "Contains markdown bold (** or __). LinkedIn renders no markdown — the asterisks appear literally on screen. Remove them.",
    });
  }
  if (/`[^`]+`/.test(body)) {
    out.push({
      rule: "markdown_code",
      detail: "Contains backticks. They publish as literal backtick characters. Remove them.",
    });
  }
  if (/^#{1,6}\s/m.test(body)) {
    out.push({
      rule: "markdown_heading",
      detail: "Contains a markdown heading. LinkedIn has no headings — write it as a sentence.",
    });
  }
  if (/^\s*(?:[-*]\s|\d+\.\s)/m.test(body)) {
    out.push({
      rule: "markdown_list",
      detail: `Contains a markdown list marker ("-", "*" or "1."). These publish literally. Use "${BULLET_MARK} " if the section needs bullets, or write it as prose.`,
    });
  }

  // ---- structure
  const bulletLines = lines.filter((l) => l.startsWith(BULLET_MARK)).length;
  if ((style.structure === "bullets" || style.structure === "mixed") && bulletLines < 3) {
    out.push({
      rule: "missing_bullets",
      detail: `Your structure setting is "${style.structure}" but the post has ${bulletLines} bullet lines. It needs at least 3, each starting with "${BULLET_MARK} " on its own line.`,
    });
  }
  if ((style.structure === "prose" || style.structure === "short-lines") && bulletLines > 0) {
    out.push({
      rule: "unexpected_bullets",
      detail: `Your structure setting is "${style.structure}", which has no bullets, but the post has ${bulletLines}. Rewrite them into the flow.`,
    });
  }

  // ---- the fold
  const hook = firstSentence(body);
  if (hook.length > FOLD_CHARS) {
    out.push({
      rule: "hook_past_fold",
      detail: `The opening sentence is ${hook.length} characters and LinkedIn hides everything past about ${FOLD_CHARS}, so it is cut mid-thought. Make the first sentence land the claim on its own.`,
    });
  }

  // ---- things lib/format.ts appends, which duplicate if the body carries them
  if (/https?:\/\/\S+/.test(body)) {
    out.push({
      rule: "url_in_body",
      detail:
        "The body contains a URL. The source link is appended automatically — including it here publishes it twice.",
    });
  }
  if (/(^|\s)#\w+/.test(body)) {
    out.push({
      rule: "hashtag_in_body",
      detail:
        "The body contains a hashtag. Hashtags are appended automatically — including them here publishes them twice.",
    });
  }

  // ---- hashtag count
  //
  // The setting reads "N tags" and means exactly N. It used to be enforced as a
  // ceiling in one direction only: the prompt asked for "0-N" and lib/format.ts
  // trimmed anything above N, so setting ten and receiving three looked like
  // the setting being ignored, and nothing anywhere noticed.
  if (options.hashtags !== undefined) {
    const tags = options.hashtags.length;
    if (tags !== style.hashtagCount) {
      out.push({
        rule: "hashtag_count",
        detail:
          style.hashtagCount === 0
            ? `Returned ${tags} hashtag(s). This author uses none — return an empty array.`
            : `Returned ${tags} hashtag${tags === 1 ? "" : "s"} and the author's setting is exactly ${style.hashtagCount}. ` +
              (tags < style.hashtagCount
                ? `Add ${style.hashtagCount - tags} more that genuinely fit this post — single words, no duplicates, no near-duplicates of each other.`
                : `Drop the ${tags - style.hashtagCount} least relevant.`),
      });
    }
  }

  // ---- the signature
  if (!style.signature && options.usedQuote) {
    out.push({
      rule: "unexpected_signature",
      detail:
        "This author has no signature line configured, but the post reports using a quote. Remove it.",
    });
  }

  return out;
}

/**
 * How bad a draft is, as one comparable number.
 *
 * Counting violations alone is too coarse to choose between two drafts. A post
 * 30 words short and a post 2 words short both have exactly one violation, so a
 * repair that moved from the first to the second scored no better than the
 * original and was discarded — which is why a narrow word range almost never
 * landed inside it. Distance breaks the tie, in words and in tags.
 */
export function severity(text: string, style: StyleConfig, violations: Violation[]): number {
  const words = countWords(text);
  const outOfRange =
    words < style.minWords
      ? style.minWords - words
      : words > style.maxWords
        ? words - style.maxWords
        : 0;
  const tagGap = violations.find((v) => v.rule === "hashtag_count") ? 1 : 0;
  // Violations dominate; distance only separates drafts that break the same
  // number of rules. Capped so one wild draft cannot outrank an extra violation.
  return violations.length * 1000 + Math.min(999, outOfRange) + tagGap;
}

/**
 * Turn violations into one repair instruction.
 *
 * Deliberately specific and finite: naming the exact failures repairs far more
 * reliably than repeating the whole constraint block, which the model has
 * already read once and ignored.
 */
export function repairInstruction(violations: Violation[]): string {
  return [
    "Your draft broke rules the author set. Fix EVERY item below and return the same JSON shape.",
    "Keep the facts, the argument and the source material exactly as they are — this is an edit, not a rewrite.",
    "",
    ...violations.map((v, i) => `${i + 1}. ${v.detail}`),
  ].join("\n");
}

/** One-line summary for logs: "too_long, banned_phrase". */
export function summarize(violations: Violation[]): string {
  return violations.map((v) => v.rule).join(", ");
}
