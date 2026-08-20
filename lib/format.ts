/**
 * Deterministic assembly of the final LinkedIn post text.
 *
 * The model writes the body and nothing else. The source line and hashtags
 * are appended here, in code, because they are the two things a language
 * model reliably mangles: URLs get "helpfully" reworded, and hashtag
 * discipline collapses into a wall of eleven tags the moment the prompt looks
 * away. Structure that must be exact does not belong in a prompt.
 */
import { MAX_COMMENTARY, toLittleText } from "./linkedin";
import { MAX_HASHTAGS } from "./style";

/** Body budget. Escaping expands the text, so this leaves room under the 3000 cap. */
export const MAX_BODY_CHARS = 2400;

/** LinkedIn truncates around here on mobile — the hook has to land before it. */
export const FOLD_CHARS = 210;

export interface AssembleArgs {
  body: string;
  sourceUrl?: string;
  hashtags?: string[];
  /** Per-agent cap from lib/style.ts. Defaults to the house style's two. */
  maxHashtags?: number;
}

function normalizeHashtag(tag: string): string | null {
  const cleaned = tag.replace(/^#/, "").replace(/[^A-Za-z0-9]/g, "");
  // LinkedIn's hashtag template only accepts a single alphanumeric word; a
  // stripped tag under 3 chars is noise rather than a topic.
  return cleaned.length >= 3 && cleaned.length <= 40 ? cleaned : null;
}

/** Collapse the runaway blank lines that LLMs produce, keeping paragraph breaks. */
function tidy(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function assemblePost(args: AssembleArgs): string {
  const parts = [tidy(args.body)];

  if (args.sourceUrl) parts.push(`Source: ${args.sourceUrl}`);

  // Two is a topic marker and fifteen is reach-farming, but which of those the
  // author wants is their call — the cap comes from their style config. This
  // second ceiling exists only so a corrupted config cannot produce a wall of
  // tags; it must never be LOWER than the one parseStyle allows, or a setting
  // the UI accepts would be silently truncated here.
  const cap = Math.min(MAX_HASHTAGS, Math.max(0, args.maxHashtags ?? 2));
  const tags = (args.hashtags ?? [])
    .map(normalizeHashtag)
    .filter((t): t is string => t !== null)
    .filter((t, i, all) => all.indexOf(t) === i)
    .slice(0, cap);
  if (tags.length > 0) parts.push(tags.map((t) => `#${t}`).join(" "));

  return parts.join("\n\n");
}

export interface LengthCheck {
  plainChars: number;
  escapedChars: number;
  withinLimit: boolean;
}

/**
 * Measure against the limit LinkedIn actually enforces — the ESCAPED length.
 * A post of ordinary prose with parentheses and hyphens can gain over a
 * hundred characters once every reserved character grows a backslash, so
 * checking the plaintext length alone will happily hand LinkedIn a post it
 * rejects.
 */
export function checkLength(text: string): LengthCheck {
  const escapedChars = toLittleText(text).length;
  return {
    plainChars: text.length,
    escapedChars,
    withinLimit: escapedChars <= MAX_COMMENTARY,
  };
}

/** The text above the "see more" fold — what most people will actually read. */
export function hookOf(text: string): string {
  const firstLine = text.split("\n")[0];
  return firstLine.length <= FOLD_CHARS ? firstLine : firstLine.slice(0, FOLD_CHARS).trimEnd() + "…";
}
