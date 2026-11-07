# ByLine cloud backend

Flutter's API runs on Cloudflare Workers, D1, Cron Triggers and Workflows. Gemini generates drafts, Firebase delivers notifications, and LinkedIn uses each author's OAuth grant. The computer can be off after deployment. The original Next.js/PostgreSQL backend remains separate and is not deployed by this package.

## Deployment ownership

Use only the dedicated **ByLine** account `b79d736758ce155523d91c41c43f2ccc`. The live API is `https://byline-api.byline-b79.workers.dev`, and its D1 database is `221e7f65-aef1-47be-8150-d6625d3557cf`. The owner explicitly prohibited using Hazzino resources or branding. Do not deploy into the original personal account, rename its shared subdomain, or modify its other applications. All temporary ByLine resources created there were exported and removed; no user records were present.

## Verification and release

From `cloud/`: `npm ci`, `npm run types`, `npm run typecheck`, `npm test`. Tests use an isolated Miniflare database. Root `npm test` and `npm run build:check` check the existing Next.js adapters.

`scripts/prepare-secrets.mjs` writes ignored `../.byline-local/cloud-secrets.json` from the owner's private `.env` and dedicated Firebase service account. Signing/encryption keys are preserved across runs. FCM is verified with a validate-only request. Never commit, print or embed secrets in an APK. Back up keys securely; losing the encryption key prevents reading stored LinkedIn grants.

After verifying the intended account and database in `wrangler.jsonc`, apply `npx wrangler d1 migrations apply byline --remote`, then deploy with `npx wrangler deploy --secrets-file ../.byline-local/cloud-secrets.json`. Keep `LINKEDIN_LIVE=false` during initial verification. Author accounts also start paused with auto-publishing off.

1. Verify `/api/health` succeeds and protected routes reject unauthenticated requests.
2. With publishing disabled, set `BYLINE_CLOUD_ORIGIN` to the approved HTTPS origin and run `npx tsx scripts/remote-smoke.ts`. It creates one disposable author, generates a real preview/background draft, then removes that author. It consumes a few AI requests, without publishing or sending notifications.
3. Verify a naturally scheduled maintenance workflow completes. A manual trigger does not prove the timer fired. Cron configuration can take up to 15 minutes to propagate.
4. Register the approved `/api/linkedin/callback` and verify real sign-in. Preserve existing callbacks unless asked otherwise.
5. Prepare Android using the approved origin and matching Firebase project. **Do not install or update the owner's phone without fresh explicit permission.**
6. Verify real device notifications and a user-approved publication before calling those integrations end-to-end verified.

For Android, run `node scripts/prepare-cloud-android.mjs https://byline-api.byline-b79.workers.dev` from the repository root, then `scripts/build-cloud-android.ps1`. The output is `.byline-local/byline-cloud-release.apk`. Signing uses `.byline-local/byline-release.p12` and ignored `mobile/android/key.properties`; preserve both in a secure backup. These scripts contain no installation command. The previously installed debug build uses a different signing certificate; do not uninstall or replace it without explicit permission and a data-preservation plan.

## Limits and recovery

Jobs are saved before workflow dispatch, and the next tick retries failed dispatches. Drafts use stable request and slot identities. Revision checks stop obsolete preparation. Atomic publication claims prevent duplicate sends. Unknown LinkedIn outcomes require human resolution rather than an automatic resend.

External-request budgets are explicit for the free deployment: discovery spends at most 24 fetches (including redirect hops), selecting up to 12 feeds across the selected subjects. Generation shares a 12-attempt AI budget per invocation, including transient retries. A completed generation dispatches only its own notification, to at most 10 devices plus the Firebase credential request. Maintenance drains at most three notification rows per tick. Do not raise these independently: Workers Free limits external subrequests to 50, including redirects. These are separate from the daily per-author and shared provider allowances.

Temporary AI network/5xx failures try Gemini 3.1 Flash-Lite after the primary Gemini 3.5 Flash-Lite; both were verified accessible on the existing free-tier project on 5 November 2026. Each actual request reserves the same author's daily allowance and the selected model's shared allowance. If both are temporarily unavailable, the existing durable Workflow step backoff applies. Successful source steps remain saved. Quota exhaustion and exhausted invocation budgets do not trigger repeated transport requests. Failure notifications report the real outcome; they do not imply a draft was saved. Free-tier model availability and quotas still require periodic review against Google's pricing and project limits.

The scheduler reconciles failed workflow instances, recovers already-saved drafts and queues LinkedIn expiry reminders. `/api/health?check=scheduler` returns 503 when the last tick is missing or older than 16 minutes; `/api/health` checks database availability. Use the scheduler-aware URL for external uptime monitoring. An in-provider health check alone cannot alert during a total provider outage.

This is bounded free hosting, not unlimited capacity or guaranteed availability. D1 has read/write/storage limits, Workflows has usage limits, and Gemini has API quotas. Global and per-author AI reservation caps are enforced; no paid fallback is configured. Keep Gemini project billing disabled for this zero-cost setup. LinkedIn credentials expire and users must reconnect.

A total Cloudflare outage also stops its timer. Independent monitoring and tested off-provider backups remain launch requirements for paying customers. Existing Neon data is quota-paused and has not been migrated. The Vercel website still uses its original backend.

References: [Cron propagation](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
