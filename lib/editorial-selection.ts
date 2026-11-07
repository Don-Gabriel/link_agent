import type { CategoryId } from './categories';
import type { Candidate } from './discovery-core';
import { PUBLISH_THRESHOLD, type ScoredCandidate } from './judge-core';

/** Tracking links must not make an already-used article look new. */
export function storyUrl(value: string): string {
  try {
    let url = new URL(value);
    if (/(^|\.)bing\.com$/.test(url.hostname) && url.pathname === '/news/apiclick.aspx') {
      const target = url.searchParams.get('url');
      if (target) url = new URL(target);
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|msclkid|oc)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch { return ''; }
}

const words = (text: string) => new Set(text.toLowerCase().replace(/\s+[-|–—]\s+[^-|–—]+$/, '')
  .match(/[\p{L}\p{N}]{3,}/gu)?.filter(w => !['the','and','for','with','from','that','this','into','its','are','has','new'].includes(w)) ?? []);

/** Conservative overlap guard for syndicated headlines and prior story fingerprints. */
export function sameStory(a: string, b: string): boolean {
  const left = words(a), right = words(b);
  if (Math.min(left.size, right.size) < 5) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const common = [...left].filter(w => right.has(w)).length;
  return common / (left.size + right.size - common) >= 0.78;
}

export function unseenStories(candidates: Candidate[], usedUrls: string[], priorCoverage: string[] = []): Candidate[] {
  const used = new Set(usedUrls.map(storyUrl).filter(Boolean));
  const titles = [...priorCoverage];
  const result: Candidate[] = [];
  for (const candidate of candidates) {
    const url = storyUrl(candidate.url);
    if (!url || used.has(url) || titles.some(title => sameStory(candidate.title, title))) continue;
    used.add(url); titles.push(candidate.title);
    result.push({...candidate, url});
  }
  return result;
}

/** Oldest/least-covered subjects get the first discovery slots, independent of saved order. */
export function rotateCategories(active: CategoryId[], recent: CategoryId[]): CategoryId[] {
  const window = recent.filter(c => active.includes(c)).slice(0, Math.max(12, active.length * 2));
  const count = (category: string) => window.filter(c => c === category).length;
  const age = (category: string) => window.includes(category) ? window.indexOf(category) : window.length;
  return [...new Set(active)].sort((a,b) => count(a)-count(b) || age(b)-age(a));
}

/** Rotation only chooses among stories that already passed every quality gate. */
export function diverseWinner(scored: ScoredCandidate[], active: CategoryId[], recent: CategoryId[]): ScoredCandidate | null {
  let eligible = scored.filter(c => c.total >= PUBLISH_THRESHOLD && active.includes(c.category) &&
    c.scores.category_fit >= 7 && c.scores.persona_fit >= 6 && c.scores.non_duplication >= 7);
  const last = recent.find(c => active.includes(c));
  if (last && eligible.some(c => c.category !== last)) eligible = eligible.filter(c => c.category !== last);
  const window=recent.filter(c=>active.includes(c)).slice(0,Math.max(12,active.length*2));
  const count=(c:string)=>window.filter(id=>id===c).length;
  const age=(c:string)=>window.includes(c)?window.indexOf(c):window.length;
  eligible.sort((a,b) => count(a.category)-count(b.category) || age(b.category)-age(a.category) || b.total-a.total ||
    b.scores.novelty-a.scores.novelty);
  return eligible[0] ?? null;
}
