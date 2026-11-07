# ByLine project state and next milestones

ByLine is a substantial working prototype of a LinkedIn writing assistant. The Flutter client, Next.js backend and PostgreSQL workflow are worth continuing. The immediate objective is a dependable private beta: an author signs in, sets their topics and voice, receives a useful draft, edits it and chooses whether to publish.

## Current capabilities

The code includes individual native accounts, LinkedIn and Google OAuth flows, resumable onboarding, 1,112 subjects, custom voice instructions and samples, a composer, a unified timetable, draft review, an archive, account deletion and Android notifications. The backend includes source discovery, scoring, writing, AI usage allowances, account ownership checks and duplicate publication protection.

The restored preview uses a separate PostgreSQL database on port 55440 and a backend on port 3100. Its drafts and publication results are demonstrations. A separate live development environment now runs on port 3000 with database `byline_live`. The owner supplied fresh Gemini and LinkedIn credentials; the existing Firebase project and ByLine Android registration were recovered. Gemini generated a real source-based sample successfully. Both Google projects reported billing disabled. LinkedIn consent and physical notification delivery remain pending. The original private configuration and old database contents have not been restored.

## Verified on 27 October 2026

| Check | Result |
| --- | --- |
| Flutter static analysis | No issues |
| Flutter widget and transport suite | 163 tests passed |
| Backend logic and catalogue suites | Passed |
| ByLine session and setup logic | Passed |
| Disposable PostgreSQL integration suite | 92 checks passed |
| Local account and Timetable API suite | 57 checks passed |
| Catalogue API persistence | Passed |
| Native OAuth return and cancellation | 10 checks passed without contacting providers |
| Next.js production build and type checking | Passed |
| npm dependency audit after updates | Zero known vulnerabilities reported |
| Android build and USB installation | Passed on connected CPH2705 running Android 16 |
| Physical phone onboarding and preparation | Completed all six steps with default technology topics; home shows one prepared demonstration draft |
| Restart and reinstall | Single-command startup restored the backend; the phone retained its account and prepared draft |
| Live Gemini sample | Generated 119 words with one source using gemini-3.5-flash-lite; sample was not a fixture |
| Live Android install | ByLine Live built and installed alongside Preview; LinkedIn consent remains user action |

These results establish the local workflow, compile health and one real model sample. Provider consent, live publication, physical push delivery and hosted reliability still need verification. September reports describe earlier successes and should not be read as proof of this installation's current live status.

## Changes made during restoration

Updated Next.js to 15.5.28, refreshed affected transitive dependencies and pinned its PostCSS dependency to 8.5.32. These address the reported [Next.js advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw) and [PostCSS advisory](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) while retaining the current Next.js major version.

Repaired an integration suite that still called retired daily-delivery actions. It now verifies asynchronous Timetable preparation, account isolation, draft deduplication, edits, skipped and published states, exact posting minutes and simulated publishing. Added `npm run test:local` and `npm run test:byline` as explicit checks.

Added `npm run local:phone` to prepare local storage, start the backend, build if needed, forward USB traffic, install and open the preview. Preview builds now have a dedicated APK filename so a subsequent live build cannot accidentally replace the installer input. Use `npm run local:phone -- -Rebuild` after mobile changes.

## What stands between this prototype and paying customers

1. **Complete real integration checks.** Gemini generation works and Firebase project access is restored. Complete LinkedIn consent and verify foreground/background notifications before a deliberately reviewed real publication. Secrets are kept in ignored local configuration. The current live setup scripts contain the recovered Firebase project and app identifiers and need adjustment if the projects change.
2. **Make the service independent of this computer.** Choose and deploy an HTTPS backend, persistent database, scheduler and notification credentials. Test restart recovery, backups and restoration. The USB preview stops working when the computer sleeps, the backend stops or forwarding disconnects.
3. **Prepare customer distribution and operations.** Configure release signing; the Android release configuration currently uses debug signing. Provide privacy and support material, account data export, provider linking if both sign-in methods are offered, operational alerts and a tested deletion procedure for any external memory service. Account deletion already exists in the app.
4. **Validate usefulness with a small pilot.** Start with one clearly defined audience, such as independent consultants who struggle to publish consistently. This is a proposed pilot, not validated demand. Track setup completion, first useful draft, editing effort, weekly use, and willingness to pay. Keep manual approval as the default.
5. **Add monetization after measuring usage.** The repository has no payment checkout, subscription entitlements or payment webhook implementation. Measure all generation and regeneration costs per active author before setting a price. Then add a bounded plan, payment lifecycle handling and support procedures.

The next milestone is one fully verified author journey using real integrations on the connected phone. After that, test several consecutive scheduled days and invite a small pilot group. A valuation, market demand or sustainable profit cannot be inferred from passing software tests.
