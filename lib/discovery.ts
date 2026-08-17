/**
 * Candidate discovery — keyless sources only, for reliability.
 * Every source is fetched with its own timeout and try/catch: one dead feed
 * must never abort the cycle. Title + summary is enough; no article-body
 * fetching (cheap and reliable beats complete).
 *
 * Feeds are grouped by the category they usually serve. The grouping only
 * decides which feeds get FETCHED for a given agent — the judge assigns each
 * candidate its final category, because a synth-plugin story turns up on a
 * hardware blog often enough that trusting the source would mislabel it.
 *
 * `verified: false` marks feeds that could not be reached from the build
 * environment (its network blocks several hosts) and are therefore unproven
 * rather than known-good. They cost one logged warning per cycle if dead.
 * Run `npm run check:feeds` from your own network to see the real picture.
 */
import type { CategoryId } from "./categories";
import { ALL_CATEGORY_IDS } from "./categories";
import { decodeEntities } from "./entities";

export interface Candidate {
  title: string;
  url: string;
  summary: string;
  source: string;
  /** The category its source usually serves — a hint for the judge, not a verdict. */
  categoryHint: CategoryId;
  publishedAt?: string;
}

const FETCH_TIMEOUT_MS = 8_000;
const MAX_CANDIDATES = 26;
const MAX_CANDIDATES_WIDE = 34;
const FRESH_HOURS = 72;

export interface DiscoverOptions {
  /** Which categories the agent actually cares about. Empty = all of them. */
  categories?: CategoryId[];
  /** Stale-feed guard: more sources and higher caps when nothing published recently. */
  wide?: boolean;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "linkedin-creator/1.0 (+personal publishing agent)" },
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(s: string): string {
  return decodeEntities(
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function clip(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

// ---- Hacker News (Algolia, JSON, keyless) — emerging tech
async function fromHackerNews(wide: boolean): Promise<Candidate[]> {
  const body = await fetchText(
    `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=${wide ? 20 : 12}`,
  );
  const data = JSON.parse(body) as {
    hits: {
      title?: string;
      url?: string;
      story_text?: string;
      objectID: string;
      created_at?: string;
    }[];
  };
  return data.hits
    .filter((h) => h.title)
    .map((h) => ({
      title: stripHtml(h.title!),
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      summary: clip(stripHtml(h.story_text ?? h.title!), 400),
      source: "hackernews",
      categoryHint: "emerging-tech" as CategoryId,
      publishedAt: h.created_at,
    }));
}

// ---- Generic RSS/Atom parser (regex-based, deliberately tolerant)
function parseFeed(
  xml: string,
  source: string,
  categoryHint: CategoryId,
  limit: number,
): Candidate[] {
  const items = xml.match(/<(?:item|entry)[\s>][\s\S]*?<\/(?:item|entry)>/g) ?? [];
  const out: Candidate[] = [];
  for (const item of items.slice(0, limit)) {
    const title = stripHtml(item.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? "");
    // Atom: <link href="..."/>; RSS: <link>...</link>; arXiv: <id>...</id>
    const url =
      item.match(/<link[^>]*href="([^"]+)"/)?.[1] ??
      stripHtml(item.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1] ?? "") ??
      stripHtml(item.match(/<id>([\s\S]*?)<\/id>/)?.[1] ?? "");
    const summary = stripHtml(
      item.match(
        /<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/,
      )?.[1] ?? "",
    );
    const publishedAt = stripHtml(
      item.match(/<(?:pubDate|published|updated)>([\s\S]*?)<\/(?:pubDate|published|updated)>/)?.[1] ??
        "",
    );
    if (title.length >= 8 && url.startsWith("http")) {
      out.push({ title, url, summary: clip(summary || title, 400), source, categoryHint, publishedAt });
    }
  }
  return out;
}

function arxivUrl(cat: string, n: number): string {
  return `https://export.arxiv.org/api/query?search_query=cat:${cat}&start=0&max_results=${n}&sortBy=submittedDate&sortOrder=descending`;
}

interface Feed {
  name: string;
  url: string;
  category: CategoryId;
  limit: number;
  wideLimit: number;
  wideUrl?: string;
  /** Reachable from the build environment. See the file header. */
  verified: boolean;
  /** Consulted only in wide mode (stale-feed guard). */
  wideOnly?: boolean;
}

export const FEEDS: Feed[] = [
  // -------------------------------------------------- music tech — software
  {
    name: "cdm",
    url: "https://cdm.link/feed/",
    category: "music-tech-software",
    limit: 6,
    wideLimit: 9,
    verified: true,
  },
  {
    name: "musictech",
    url: "https://www.musictech.com/feed/",
    category: "music-tech-software",
    limit: 5,
    wideLimit: 8,
    verified: true,
  },
  {
    name: "arxiv-cs.SD",
    url: arxivUrl("cs.SD", 5),
    wideUrl: arxivUrl("cs.SD", 8),
    category: "music-tech-software",
    limit: 5,
    wideLimit: 8,
    verified: true,
  },
  {
    name: "arxiv-eess.AS",
    url: arxivUrl("eess.AS", 4),
    wideUrl: arxivUrl("eess.AS", 6),
    category: "music-tech-software",
    limit: 4,
    wideLimit: 6,
    verified: true,
  },
  {
    name: "bedroomproducers",
    url: "https://bedroomproducersblog.com/feed/",
    category: "music-tech-software",
    limit: 4,
    wideLimit: 6,
    verified: false,
  },

  // -------------------------------------------------- music tech — hardware
  {
    name: "synthtopia",
    url: "https://www.synthtopia.com/feed/",
    category: "music-tech-hardware",
    limit: 6,
    wideLimit: 9,
    verified: true,
  },
  {
    name: "musicradar",
    url: "https://www.musicradar.com/rss",
    category: "music-tech-hardware",
    limit: 6,
    wideLimit: 9,
    verified: true,
  },
  {
    name: "hackaday",
    url: "https://hackaday.com/blog/feed/",
    category: "music-tech-hardware",
    limit: 5,
    wideLimit: 8,
    verified: true,
  },
  {
    name: "gearnews",
    url: "https://www.gearnews.com/feed/",
    category: "music-tech-hardware",
    limit: 4,
    wideLimit: 6,
    verified: false,
  },

  // ------------------------------------------------------------ emerging tech
  {
    name: "arxiv-cs.AI",
    url: arxivUrl("cs.AI", 5),
    wideUrl: arxivUrl("cs.AI", 8),
    category: "emerging-tech",
    limit: 5,
    wideLimit: 8,
    verified: true,
  },
  {
    name: "arstechnica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
    category: "emerging-tech",
    limit: 5,
    wideLimit: 8,
    verified: true,
  },
  {
    name: "techcrunch",
    url: "https://techcrunch.com/feed/",
    category: "emerging-tech",
    limit: 4,
    wideLimit: 7,
    verified: true,
  },
  {
    name: "theverge",
    url: "https://www.theverge.com/rss/index.xml",
    category: "emerging-tech",
    limit: 4,
    wideLimit: 7,
    verified: true,
  },
  {
    name: "simonwillison",
    url: "https://simonwillison.net/atom/everything/",
    category: "emerging-tech",
    limit: 5,
    wideLimit: 5,
    verified: true,
    wideOnly: true,
  },
  {
    name: "mit-tech-review",
    url: "https://www.technologyreview.com/feed/",
    category: "emerging-tech",
    limit: 6,
    wideLimit: 6,
    verified: true,
    wideOnly: true,
  },
];

/**
 * Freshness filter: drop candidates older than ~72h. A stale pool guarantees
 * falling timeliness scores. Unparsable dates are kept (benefit of the doubt).
 */
function isFresh(c: Candidate): boolean {
  if (!c.publishedAt) return true;
  const t = Date.parse(c.publishedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= FRESH_HOURS * 3_600_000;
}

/**
 * Interleave by category so one prolific feed cannot monopolise the judging
 * slots. Without this, MusicRadar's 50-item feed would crowd out every arXiv
 * paper before the judge ever saw one.
 */
function interleaveByCategory(candidates: Candidate[], cap: number): Candidate[] {
  const buckets = new Map<CategoryId, Candidate[]>();
  for (const c of candidates) {
    const bucket = buckets.get(c.categoryHint) ?? [];
    bucket.push(c);
    buckets.set(c.categoryHint, bucket);
  }
  const lists = [...buckets.values()];
  const out: Candidate[] = [];
  for (let i = 0; out.length < cap; i++) {
    let added = false;
    for (const list of lists) {
      if (i < list.length) {
        out.push(list[i]);
        added = true;
        if (out.length >= cap) break;
      }
    }
    if (!added) break;
  }
  return out;
}

/** Pull candidates across the agent's active categories, newest first. Partial results are normal. */
export async function discover(options: DiscoverOptions = {}): Promise<Candidate[]> {
  const wide = options.wide ?? false;
  const active =
    options.categories && options.categories.length > 0 ? options.categories : ALL_CATEGORY_IDS;
  const activeSet = new Set(active);
  const results: Candidate[] = [];

  if (activeSet.has("emerging-tech")) {
    try {
      results.push(...(await fromHackerNews(wide)));
    } catch (err) {
      console.warn("[discovery] hackernews failed:", String((err as Error)?.message ?? err));
    }
  }

  const feeds = FEEDS.filter(
    (f) => activeSet.has(f.category) && (wide || !f.wideOnly),
  );

  // Fetched concurrently: ~13 feeds at 8s each would blow the cycle budget serially.
  await Promise.all(
    feeds.map(async (feed) => {
      const url = wide && feed.wideUrl ? feed.wideUrl : feed.url;
      const limit = wide ? feed.wideLimit : feed.limit;
      try {
        results.push(...parseFeed(await fetchText(url), feed.name, feed.category, limit));
      } catch (err) {
        console.warn(`[discovery] ${feed.name} failed:`, String((err as Error)?.message ?? err));
      }
    }),
  );

  // Dedupe by URL, drop stale items, newest first, then balance across categories.
  const seen = new Set<string>();
  const unique = results.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
  const fresh = unique.filter(isFresh);
  fresh.sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));

  const balanced = interleaveByCategory(fresh, wide ? MAX_CANDIDATES_WIDE : MAX_CANDIDATES);
  console.log(
    `[discovery] ${balanced.length} selected of ${fresh.length} fresh / ${unique.length} unique, from ${new Set(balanced.map((c) => c.source)).size} sources${wide ? " (WIDE mode)" : ""}`,
  );
  return balanced;
}
