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
 *
 * Previously checked sources retain their verification flags. New sources
 * remain unverified until runtime feed health establishes their availability.
 */
import type { CategoryId } from "./categories";
import { CATEGORIES, LEGACY_CATEGORY_IDS as ALL_CATEGORY_IDS, MAX_SELECTED_CATEGORIES } from "./categories";
import { decodeEntities } from "./entities";
import { boundedText } from './http-body';
export type FeedRecorder = (name:string, outcome:{ok:true;items:number}|{ok:false;error:string})=>Promise<void>;

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
const SPARSE_FRESH_HOURS = 7 * 24;

/**
 * Slots guaranteed per active category, and the ceiling that stops the judge
 * prompt growing without bound.
 *
 * The interleave shares the cap evenly, so a fixed 26 means three categories
 * get eight or nine candidates each and seven get barely three — deep enough to
 * choose from in the first case, a coin toss in the second. The cap therefore
 * grows with how many categories are actually active, and only then.
 *
 * The ceiling matters because every candidate is scored in ONE batched call:
 * past roughly forty the prompt starts crowding the model's output budget and
 * the whole batch can come back truncated and unusable.
 */
const PER_CATEGORY_FLOOR = 5;
const HARD_CANDIDATE_CAP = 40;

export interface DiscoverOptions {
  /** Which categories the agent actually cares about. Empty = all of them. */
  categories?: CategoryId[];
  /** Stale-feed guard: more sources and higher caps when nothing published recently. */
  wide?: boolean;
  /** Cloud deployments reserve requests for writing and notification delivery. */
  maxFetches?: number;
  maxFeeds?: number;
}

type FeedFetch=(url:string,init:RequestInit)=>Promise<Response>;
/** Count redirect hops too; automatic redirects can silently exhaust Workers Free. */
export function boundedFeedFetch(limit:number):FeedFetch {
  let used=0;
  return async (url,init)=>{
    for(let hop=0;hop<3;hop++) {
      if(used>=limit)throw new Error('Source request budget reached');
      used++;
      const response=await fetch(url,{...init,redirect:'manual'});
      if(![301,302,303,307,308].includes(response.status))return response;
      const location=response.headers.get('location');
      await response.body?.cancel();
      if(!location)throw new Error('Feed redirect has no destination');
      const next=new URL(location,url);
      if(!['https:','http:'].includes(next.protocol))throw new Error('Invalid feed redirect');
      url=next.href;
    }
    throw new Error('Feed redirected too many times');
  };
}

async function fetchText(url: string,request:FeedFetch=fetch): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await request(url, {
      signal: controller.signal,
      headers: { "User-Agent": "linkedin-creator/1.0 (+personal publishing agent)" },
    });
    if (!res.ok) {await res.body?.cancel();throw new Error(`http ${res.status}`);}
    return await boundedText(res, 512 * 1024);
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
async function fromHackerNews(wide: boolean,request?:FeedFetch): Promise<Candidate[]> {
  const body = await fetchText(
    `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=${wide ? 20 : 12}`,request,
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
  // Checked from the development network on 2026-09-06: all return populated RSS.
  { name: "HubSpot", url: "https://blog.hubspot.com/marketing/rss.xml", category: "marketing", limit: 8, wideLimit: 12, verified: true },
  { name: "HR Dive", url: "https://www.hrdive.com/feeds/news/", category: "hr", limit: 8, wideLimit: 12, verified: true },
  { name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", category: "finance", limit: 8, wideLimit: 12, verified: true },
  // Publisher RSS endpoints; runtime feed health records actual availability.
  { name: "Banking Dive", url: "https://www.bankingdive.com/feeds/news/", category: "finance", limit: 8, wideLimit: 12, verified: false },
  { name: "ECB Blog", url: "https://www.ecb.europa.eu/rss/blog.html", category: "finance", limit: 6, wideLimit: 8, verified: false },
  { name: "ECB Publications", url: "https://www.ecb.europa.eu/rss/pub.html", category: "finance", limit: 6, wideLimit: 8, verified: false },
  { name: "WHO", url: "https://www.who.int/rss-feeds/news-english.xml", category: "healthcare", limit: 8, wideLimit: 12, verified: true },
  { name: "Entrepreneur", url: "https://www.entrepreneur.com/latest.rss", category: "business", limit: 8, wideLimit: 12, verified: true },

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
    verified: true,
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
    verified: true,
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

  // ------------------------------------------------------ AI & ML engineering
  {
    name: "arxiv-cs.LG",
    url: arxivUrl("cs.LG", 5),
    wideUrl: arxivUrl("cs.LG", 8),
    category: "ai-ml",
    limit: 5,
    wideLimit: 8,
    verified: true,
  },
  {
    name: "arxiv-cs.CL",
    url: arxivUrl("cs.CL", 5),
    wideUrl: arxivUrl("cs.CL", 8),
    category: "ai-ml",
    limit: 5,
    wideLimit: 8,
    verified: true,
  },
  {
    name: "huggingface",
    url: "https://huggingface.co/blog/feed.xml",
    category: "ai-ml",
    limit: 5,
    wideLimit: 8,
    verified: true,
  },

  // --------------------------------------------------------- developer tooling
  {
    name: "github-blog",
    url: "https://github.blog/feed/",
    category: "dev-tooling",
    limit: 4,
    wideLimit: 6,
    verified: true,
  },
  {
    name: "lobsters",
    url: "https://lobste.rs/rss",
    category: "dev-tooling",
    limit: 6,
    wideLimit: 9,
    verified: true,
  },
  {
    name: "changelog",
    url: "https://changelog.com/feed",
    category: "dev-tooling",
    limit: 4,
    wideLimit: 6,
    verified: true,
  },

  // ------------------------------------------------------ hardware & embedded
  {
    // The same Hackaday feed that music-tech-hardware carries, listed again
    // here because it is a general electronics blog and was only ever reachable
    // from a MUSIC category — so an agent watching hardware-embedded and not
    // music-tech-hardware could not see it at all, while that category ran on
    // two sources.
    //
    // Added rather than moved, which is the rule this file states: moving it
    // would silently stop an agent that watches only music-tech-hardware from
    // seeing Hackaday, with no error anywhere. The cost is one duplicate fetch
    // in the rare case where both categories are active, and discover() already
    // dedupes by URL, so nothing is judged twice.
    name: "hackaday-embedded",
    url: "https://hackaday.com/blog/feed/",
    category: "hardware-embedded",
    limit: 5,
    wideLimit: 8,
    verified: true,
  },
  {
    name: "adafruit",
    url: "https://blog.adafruit.com/feed/",
    category: "hardware-embedded",
    limit: 5,
    wideLimit: 8,
    verified: true,
  },
  {
    name: "eevblog",
    url: "https://www.eevblog.com/feed/",
    category: "hardware-embedded",
    limit: 4,
    wideLimit: 6,
    verified: true,
  },

  // --------------------------------------------------------- compute & silicon
  {
    name: "chipsandcheese",
    url: "https://chipsandcheese.com/feed/",
    category: "compute-silicon",
    limit: 4,
    wideLimit: 6,
    verified: true,
  },
  {
    name: "semianalysis",
    url: "https://semianalysis.com/feed/",
    category: "compute-silicon",
    limit: 4,
    wideLimit: 6,
    verified: true,
  },
  {
    name: "phoronix",
    url: "https://www.phoronix.com/rss.php",
    category: "compute-silicon",
    limit: 5,
    wideLimit: 8,
    verified: true,
  },
  {
    name: "arxiv-cs.AR",
    url: arxivUrl("cs.AR", 4),
    wideUrl: arxivUrl("cs.AR", 6),
    category: "compute-silicon",
    limit: 4,
    wideLimit: 6,
    verified: true,
    wideOnly: true,
  },
];

/**
 * Normally use 72 hours, extending to one week only for sparse categories.
 * Unparsable dates are kept and passed to the judge as supplied by the feed.
 */
function isFresh(c: Candidate, hours = FRESH_HOURS): boolean {
  if (!c.publishedAt) return true;
  const t = Date.parse(c.publishedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= hours * 3_600_000;
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

/** Source routing is shared with catalogue coverage checks. No network work here. */
export function feedsForCategories(active: CategoryId[], wide = false): Feed[] {
  const activeSet = new Set(active);
  return [
    ...FEEDS.filter(f => activeSet.has(f.category) && (wide || !f.wideOnly)),
    ...active.filter(id => CATEGORIES[id]?.query).slice(0, MAX_SELECTED_CATEGORIES).map(id => ({
      name: `subject:${id}`, category: id, limit: 8, wideLimit: 12, verified: false,
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(CATEGORIES[id].query! + ' when:7d')}&hl=en-US&gl=US&ceid=US:en`,
    })),
  ];
}

export function balanceFeeds(feeds:Feed[],active:CategoryId[],limit:number):Feed[] {
  const groups=active.map(c=>feeds.filter(f=>f.category===c));
  const selected:Feed[]=[];
  for(let i=0;selected.length<limit;i++) {
    let added=false;
    for(const group of groups)if(group[i]&&selected.length<limit){selected.push(group[i]);added=true;}
    if(!added)break;
  }
  return selected;
}

/** Pull candidates across the agent's active categories, newest first. Partial results are normal. */
export async function discover(recordFeedResult: FeedRecorder, options: DiscoverOptions = {},
  runSource: (name:string, work:()=>Promise<Candidate[]>)=>Promise<Candidate[]> = (_name,work)=>work(),
): Promise<Candidate[]> {
  const wide = options.wide ?? false;
  const active =
    options.categories && options.categories.length > 0 ? options.categories : ALL_CATEGORY_IDS;
  const activeSet = new Set(active);
  const results: Candidate[] = [];
  const request=options.maxFetches===undefined?fetch:boundedFeedFetch(options.maxFetches);

  if (activeSet.has("emerging-tech")) {
    try {
      const hits = await runSource('hackernews',()=>fromHackerNews(wide,request));
      results.push(...hits);
      await recordFeedResult("hackernews", { ok: true, items: hits.length });
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      console.warn("[discovery] hackernews failed:", message);
      await recordFeedResult("hackernews", { ok: false, error: message });
    }
  }

  const available = feedsForCategories(active, wide);
  const feeds=options.maxFeeds===undefined?available:balanceFeeds(available,active,options.maxFeeds);

  // Fetched concurrently: ~13 feeds at 8s each would blow the cycle budget serially.
  await Promise.all(
    feeds.map(async (feed) => {
      const url = wide && feed.wideUrl ? feed.wideUrl : feed.url;
      const limit = wide ? feed.wideLimit : feed.limit;
      try {
        const items = await runSource(feed.name,async()=>parseFeed(await fetchText(url,request), feed.name, feed.category, limit));
        results.push(...items);
        // Zero parsed items counts as a failure, not a quiet day: parseFeed does
        // not filter by date, so even a dormant blog returns its old entries.
        // Zero means the format changed or the response was not a feed at all —
        // which is what a redesigned site's 200-with-an-HTML-error-page looks like.
        await recordFeedResult(feed.name, { ok: true, items: items.length });
      } catch (err) {
        const message = String((err as Error)?.message ?? err);
        console.warn(`[discovery] ${feed.name} failed:`, message);
        await recordFeedResult(feed.name, { ok: false, error: message });
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
  const fresh = unique.filter(c => isFresh(c));
  // Quiet categories need a useful pool over weekends too. Supplement only
  // categories with fewer than five recent stories, using at most a week's
  // material. The judge still sees the actual date and applies the same bar.
  const sparse = new Set(active.filter(category =>
    fresh.filter(c => c.categoryHint === category).length < PER_CATEGORY_FLOOR));
  fresh.push(...unique.filter(c => sparse.has(c.categoryHint) &&
    !isFresh(c) && isFresh(c, SPARSE_FRESH_HOURS)));
  fresh.sort((a, b) => (Date.parse(b.publishedAt ?? "") || 0) - (Date.parse(a.publishedAt ?? "") || 0));

  const base = wide ? MAX_CANDIDATES_WIDE : MAX_CANDIDATES;
  const cap = Math.min(HARD_CANDIDATE_CAP, Math.max(base, active.length * PER_CATEGORY_FLOOR));
  const balanced = interleaveByCategory(fresh, cap);
  console.log(
    `[discovery] ${balanced.length} selected (cap ${cap} for ${active.length} categories) of ${fresh.length} fresh / ${unique.length} unique, from ${new Set(balanced.map((c) => c.source)).size} sources${wide ? " (WIDE mode)" : ""}`,
  );
  return balanced;
}
