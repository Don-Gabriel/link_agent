# ByLine: subjects, voice and product polish

## Changes

- Replaced the small native setup menu with a searchable catalogue of 1,112 distinct subjects: 1,100 curated specialties across 55 groups, plus 12 existing categories whose IDs and feed coverage remain compatible.
- Setup offers 61 industry starting points. Authors can combine up to 12 subjects across industries, search by subject or industry words, and add their own editorial focus. Large lists render lazily on mobile; the web picker filters and progressively reveals results.
- Each specialty has a stable ID, editorial definition, scope, hashtag vocabulary and targeted discovery query. Only selected subjects are fetched. Empty legacy selections retain their original scope instead of expanding to the entire catalogue.
- Added a relevance gate: novelty and timeliness cannot compensate for poor subject fit, poor author fit or an unselected category. Current categories take priority over older persona interests.
- Setup samples use the regular judging and writing pipeline, including voice examples and post checks. Preferences are saved into the agent on completion. Local test samples remain explicitly identified as demonstrations.
- Voice customization is optional during setup: ten tones, free-form direction, three writing examples, structure, audience, opening, closing, emoji, word range, hashtag count and excluded phrases. Shared controls keep setup and the later Voice editor consistent. Choosing a preset later preserves personal instructions and excluded phrases.
- Removed the welcome screen's API-key pitch, provider labels in routine web views, raw environment-variable guidance and internal error codes from normal connection failures. Kept meaningful preview-environment disclosures and recovery instructions.
- Removed a fabricated first-person software anecdote from the empty-archive voice preview. Previews now use actual author material or the reviewed setup sample, with an actionable empty state when neither exists.
- Fixed narrow-screen draft actions, overflowing action-menu labels and progress-indicator accessibility values. Refreshed tests that still used pre-timetable responses, old labels or real HTTP clients in fixture screens.

## Verification

The catalogue tests cover unique IDs and labels, all discovery routes, legacy behavior, invalid IDs, optional voice defaults, style validation, scope consistency, source routing and the relevance gate. Local API tests exercise a real isolated PostgreSQL account from setup through completion and subsequent settings changes. Flutter tests cover large-list search, safe cancellation, optional customization, persisted preferences, timetable preparation, review and publishing confirmation.

Validation completed:

- Backend self-tests, catalogue tests and local catalogue API integration tests passed.
- All 92 database checks passed in a newly created, disposable local database, removed after verification.
- Flutter static analysis reported no issues; all 163 Flutter tests passed.
- TypeScript validation and the isolated Next.js production build passed.
- Android debug preview APK built successfully. Gradle reported plugin migration warnings, without a build failure.
- Phone-width voice controls were rendered and visually inspected. Live discovery probes returned populated feeds for solar energy, spatial audio, patient safety, soil health and legal operations.

New discovery endpoints report their actual availability through feed health; the catalogue does not claim that every niche has a fresh story every day. Automated tests use fixtures for model responses or explicit local demonstrations. They do not certify perfect prose from a live model or publish to LinkedIn.
