# ByLine 1.0.4: navigation, notices and research diversity

Release date: 7 November 2026. Android version **1.0.4 (5)**.

## App changes

- Foreground action notices and schedule Undo notices dismiss after six seconds.
  Flutter's action-button default previously kept them open indefinitely.
- The follow-up progress notice also expires after six seconds. Completing that
  request no longer hides an unrelated notification that arrived later.
- Selecting Home, My posts or Me resets that destination to the top, including
  tapping an already selected tab and opening a destination from a notification.
  My posts resets both its draft and archive lists while retaining the selected view.
- The README prominently links the signed APK and phone installation instructions.
  The previous browser-only LinkedIn sign-in fix remains included.

## Research and selection changes

Cloud generation previously omitted category history from judging and always
selected the highest scoring story. Personal free-text interests were not used as
discovery searches. This could repeatedly select music despite other saved subjects.

`lib/editorial-selection.ts` now selects among qualifying stories using recent
category counts and recency. It avoids repeating the last category when another
qualifying category is available. Subject fit must reach 7/10, author fit 6/10,
non-duplication 7/10, and overall quality 6.5/10. Category rotation does not waive
these gates. Drafts and rejected posts count as consumed ideas.

`lib/discovery-core.ts` searches Google News and Bing News for every selected
subject, adds free-text topic searches, rotates sources/search angles, and balances
publishers within categories. Cloud research selects up to 20 feeds, with six
concurrent source tasks and at most 24 external fetches including redirects. A
failed workflow source is skipped instead of repeatedly spending that budget.
The judge receives at most 40 candidates. Quiet subjects may use material up to
seven days old; the usual freshness window is 72 hours.

Tracking parameters and Bing redirect wrappers are normalized. Previously used
source links and near-identical headlines are removed before the candidate cap.
Cloud history loads the latest 100 posts; a transactional save guard also prevents
two generated drafts from saving the same exact source URL. Setup retries exclude
the previous sample and include its category in editorial history. Both the
Cloudflare runtime and original PostgreSQL cycle use the shared selection logic.

This broadens research even with one selected subject. It uses publisher feeds
and news-search excerpts, not unrestricted full-page crawling. Fresh, relevant
evidence is still necessary; no implementation can guarantee an unlimited supply
of new stories for every narrow topic. Explicit timetable category restrictions
remain respected.

## Verification

- Flutter analyzer passed; all **184 Flutter tests** passed, including seven new
  regression tests for timed notices, phone/desktop navigation, archive state and
  late request completion.
- Cloud typecheck, dry-run bundle and all **38 cloud tests** passed. New checks
  cover repeated category rotation, relevance gates, URL/headline deduplication,
  source breadth, concurrency, failed feeds, setup retries and concurrent D1 saves.
- Root logic/health tests, the 1,112-subject catalogue check, ByLine logic tests,
  the Next.js production build and all **92 PostgreSQL checks** passed.
- A live discovery check returned **34 candidates from 31 publishers**, covering
  finance, AI and music. All 20 selected source feeds returned material, including
  the two personal-topic searches. Counts are one observed run, not a guarantee.
- Production generated a real onboarding sample and a background draft for an
  isolated temporary author. The test author had automatic publishing disabled,
  no LinkedIn grant, no posting slots and no notification devices. It was removed
  after verification. No LinkedIn post was published.
- The live scheduler-aware health endpoint returned HTTP 200, and an
  unauthenticated protected endpoint returned HTTP 401.
- Android `aapt` verified package `com.linkdin.byline`, version 1.0.4/build 5,
  minimum API 24, target API 36 and ARM64/ARMv7/x86-64 support. `apksigner`
  verified the existing release certificate. The exact APK hash is recorded in
  `releases/android/SHA256SUMS` and `release.json`.

The cloud regression suite is now included in GitHub CI alongside the existing
web, PostgreSQL and Flutter checks. No phone was installed or reset during this
work. Physical-device notification delivery and a new real LinkedIn consent flow
were not repeated. The PDF was not changed.

Production origin: `https://byline-api.byline-b79.workers.dev`, dedicated ByLine
account only. Final deployment version:
`ca2e175e-670b-4af0-aaf1-711a33523c8b`. Existing deployed variables and secrets
were preserved with `wrangler deploy --keep-vars`; no schema migration was needed.
