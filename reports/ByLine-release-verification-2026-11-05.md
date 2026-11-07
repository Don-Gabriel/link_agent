# ByLine release verification — 5 November 2026

## Installed and deployed

- Installed release **1.0.2+3**, package `com.linkdin.byline`, in place on the owner's OPPO CPH2705. No uninstall; login and cloud content preserved.
- APK SHA-256: `8F0B84D52AAAD072C4751128BFB3BA98C87766FD8A9B0385BF8654591769C831`.
- Dedicated ByLine API: https://byline-api.byline-b79.workers.dev
- Worker version: `25e21cb6-88b1-419c-8dcf-3d388a88d49f`.
- Daily slot remains 09:00 Asia/Kolkata. Automatic publishing remains off.

## Root causes and corrections

1. Cloud source discovery could exhaust the 50-external-request free-plan limit, including redirect chains, before the AI call and immediate notification. Discovery now selects feeds across categories and explicitly budgets 24 requests including redirects. AI work shares a 12-attempt budget per invocation; immediate notification targets only the current job, at most 11 requests. Background notification dispatch handles three outbox rows per batch to leave capacity for other maintenance work.
2. Temporary AI service failures now try an explicitly selected free fallback, Gemini 3.1 Flash-Lite, after Gemini 3.5 Flash-Lite. Both actual attempts reserve quota. Persisted generation steps also retry temporary provider failures using Workflow backoff, preserving successful discovery steps. Quota exhaustion does not trigger the transport retry. Provider failures are reported without exposing raw diagnostics in the app.
3. Android logout sent the notification token in a query while the cloud API required JSON. Version 1.0.2 sends a JSON body; the backend also accepts older clients' DELETE query format. Ownership checks prevent a previous account's logout from unregistering a newly signed-in account's device.
4. The previously built 1.0.1 reconnect fixes are included: refresh on resume, bounded GET-only connection retry, visible manual-job progress/failure, notification preference in status, and durable failure alerts. Publishing mutations are never automatically replayed.

## Checks completed

- 49 Flutter API/reconnection tests pass, including authenticated device unregister before logout.
- Targeted Flutter analysis passes.
- 29 backend tests pass, with TypeScript checks.
- Root application self-tests and Next.js production build pass.
- Multi-account tests cover separate drafts, schedules, settings, job status, sessions, revocation, deletion, notification ownership, same-phone account switching, and concurrent idempotent saves/publishing.
- Notification tests simulate four accounts with ten devices each; each receives only its own draft identifier, and dispatch stays bounded.
- The live scheduler health check passes.
- Real failure notification was seen in Android's notification panel: “Your draft needs attention”, with the AI service unavailable explanation. The app displayed the same outcome rather than a generic connection failure.
- The owner's original publication is confirmed in the database at 2026-10-27T12:12:33.608Z. No new LinkedIn post was published during this verification.

## Current verification limits

The real cloud job completed through Gemini 3.1 Flash-Lite after the primary returned HTTP 503. Draft #2 was saved at 17:59:02 UTC; its notification was accepted by Firebase at 17:59:03 UTC. ByLine was backgrounded, the ready notification was visible in Android, and tapping it opened My posts with draft #2 and no connection error.

An additional publication-readiness issue was caught: the original 400–500-word draft exceeded LinkedIn's limit when assembled with its source and nine tags. The writer now checks body and complete-post character budgets during repair and before marking a generated draft ready. Long bullet-format instructions no longer impose an incompatible under-20-words-per-bullet rule. The owner explicitly selected 250–350 words, and that preference is saved. The provider rejected a further rewrite request, so the assistant shortened the existing test draft directly and saved it through the authenticated edit API after validation. Draft #2 now has 281 whitespace-delimited words; the complete source-and-nine-tag post measures 1,888 escaped characters, below 3,000. It remains unpublished. This manual correction is distinct from the earlier successfully verified automatic generation.

A second real person's LinkedIn OAuth sign-in has not been performed; multi-user isolation is tested using separate local accounts in the compiled Workers runtime. Provider outages remain possible even with model fallback.

Free budgets are enforced; these checks do not establish unlimited capacity or an availability guarantee. The separate old Vercel/Neon website was not migrated in this task. No paid service or unrelated account was used.

Reference: [Cloudflare subrequest limits, including redirects](https://developers.cloudflare.com/workers/platform/limits/#subrequests).

## Discard correction — 5 November 2026

The user's p2 discard had saved status `rejected`, but `/api/review-delivery` still returned it under Other posts today. The feed now excludes discarded posts and removes discarded slot drafts from ready entries while retaining the consumed occurrence. Matching uses the saved slot date, so clearing a scheduled timestamp cannot reassign the occurrence.

Deployed dedicated ByLine Worker version `44a4ca6f-bfbc-4835-a5a0-5908502ce9d0`. All 30 backend tests passed, including manual and scheduled discard, repeated reads, and preservation of another author's draft; TypeScript passed. Live authenticated reads showed p2 absent from Home and the queue, with published p1 and p3 preserved. Observed the installed phone automatically remove p2 and show p3 under Other posts today. No APK update was required.
