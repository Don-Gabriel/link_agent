/**
 * Feed reachability check. Run from YOUR network:  npm run check:feeds
 *
 * Several music-tech hosts were unreachable from the environment this project
 * was built in, which could mean the feed is dead or could mean that network
 * blocked the host. Rather than guess, the feed list ships with those marked
 * unverified and this script tells you the truth from where it actually runs.
 *
 * Feed URLs are read straight out of lib/discovery.ts so the two can never
 * drift apart.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(join(root, "lib", "discovery.ts"), "utf8");

// Match the { name: "...", url: ... } shape of each FEEDS entry.
//
// The url value is EITHER a quoted literal OR a helper call like
// arxivUrl("cs.SD", 5). It must be matched as one of those two alternatives
// rather than as "everything up to the next comma" — the naive version stops
// at the comma INSIDE the helper's argument list, so every arXiv feed came out
// as an unparseable fragment and got reported as a dead source it never was.
const entries = [
  ...source.matchAll(/name:\s*"([^"]+)",\s*\n?\s*url:\s*("[^"]*"|[A-Za-z_$][\w$]*\([^)]*\)),/g),
].map((m) => ({
  name: m[1],
  raw: m[2].trim(),
}));

const resolved = entries.map((entry) => {
  if (entry.raw.startsWith('"')) return { ...entry, url: entry.raw.slice(1, -1) };
  // arxivUrl("cs.SD", 5) — reconstruct the query the helper builds.
  const arxiv = /arxivUrl\("([^"]+)",\s*(\d+)\)/.exec(entry.raw);
  if (arxiv) {
    return {
      ...entry,
      url: `https://export.arxiv.org/api/query?search_query=cat:${arxiv[1]}&start=0&max_results=${arxiv[2]}&sortBy=submittedDate&sortOrder=descending`,
    };
  }
  return { ...entry, url: null };
});

console.log(`Checking ${resolved.length} feeds…\n`);
let live = 0;

for (const feed of resolved) {
  if (!feed.url) {
    console.log(`  ?  ${feed.name.padEnd(18)} could not resolve URL from source`);
    continue;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: { "User-Agent": "linkedin-creator/1.0 (+feed check)" },
    });
    const body = await res.text();
    const items = (body.match(/<(?:item|entry)[\s>]/g) ?? []).length;
    if (res.ok && items > 0) {
      live++;
      console.log(`  ok ${feed.name.padEnd(18)} ${String(items).padStart(3)} items`);
    } else {
      console.log(`  !! ${feed.name.padEnd(18)} http ${res.status}, ${items} items`);
    }
  } catch (err) {
    console.log(`  XX ${feed.name.padEnd(18)} ${String(err?.message ?? err)}`);
  } finally {
    clearTimeout(timer);
  }
}

console.log(`\n${live}/${resolved.length} feeds returned items.`);
console.log("Anything marked XX or !! can be removed from FEEDS in lib/discovery.ts,");
console.log("or left alone — a dead feed costs one logged warning per cycle and nothing else.");
