# Finance daily preparation

## Observed cause

Read-only inspection of the new finance account showed completed onboarding,
an unpaused agent, and a successful Gemini judging call. Its first daily
preparation on 2026-09-06 scored one Federal Reserve enforcement-action update
at 5.2, below the unchanged 6.5 threshold. No post was inserted. Finance had only
one configured feed and discovery excluded material older than 72 hours.

The daily review worker discarded the cycle's `below_threshold` result and
stored a generic failure. The endpoint also returned the same generic failure
when a retry was cooling down, already running, or exhausted for the day.

## Changes

- Add Banking Dive, ECB Blog and ECB Publications to finance discovery.
- Supplement categories with fewer than five recent candidates using articles
  no older than seven days. Keep candidate caps, deduplication, rejection
  cooldown, per-user/provider AI limits and the 6.5 quality threshold.
- Give judging and writing the publication date and current date. Remove the
  judge's universal assumption that every client is an engineer.
- Persist the actual cycle failure reason; map it to safe, specific client
  messages without exposing raw provider or database errors.
- Report active preparation, retry cooldown and exhausted automatic retries.
  An explicit Prepare request may reopen one attempt after cooldown; background
  retries remain capped. Do not require a database edit to recover.
- Scope review settlement to the requested account during manual preparation.

The existing Android and Windows API clients display these server messages, so
no client rebuild or reinstall is needed. The Next.js development server loads
these changes on subsequent requests.

## Sources and validation limits

Publisher endpoints: https://www.bankingdive.com/feeds/news/,
https://www.ecb.europa.eu/rss/blog.html and
https://www.ecb.europa.eu/rss/pub.html. ECB documents its feeds at
https://www.ecb.europa.eu/home/html/rss.en.html. The browser fetcher recognized
RSS content but cannot render that content type; the new feeds are marked
unverified until observed by runtime feed health.

TypeScript compilation: `npx tsc --noEmit --incremental false` passed.
No test suite, app launch, live generation, notification or publication was
triggered. No live account data was edited. User acceptance testing remains
with the user. Broader discovery improves the candidate pool; it cannot
guarantee a suitable article or a successful provider response on every run.
