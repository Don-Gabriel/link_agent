/**
 * HTML entity decoding, shared by discovery (ingest), the UI (render), and
 * the backfill script. Feed titles arrive with numeric (&#8217;) and named
 * (&rsquo;) entities; both must read as text everywhere.
 */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  trade: "™",
  copy: "©",
  reg: "®",
};

function fromCode(n: number): string {
  try {
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  } catch {
    return "";
  }
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => fromCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => fromCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m: string, name: string) => NAMED[name.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}
