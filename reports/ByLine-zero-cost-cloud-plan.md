# ByLine cloud deployment status - 27 October 2026

## Working and verified

- Dedicated Cloudflare account: ByLine, b79d736758ce155523d91c41c43f2ccc. API: https://byline-api.byline-b79.workers.dev.
- Dedicated D1 database: byline, 221e7f65-aef1-47be-8150-d6625d3557cf. Both migrations applied.
- Real Gemini preview and background content workflow completed on this deployment; the disposable verification author was removed.
- A naturally scheduled five-minute maintenance workflow completed at 11:30 UTC. Scheduler-aware health returns 200. Work continues without this computer.
- LinkedIn's new ByLine-only callback is saved, and the owner's real phone sign-in succeeded. Onboarding is complete, daily preparation is enabled, and auto-publishing remains off.
- Real Firebase notifications reached the phone. The background draft-ready notification was delivered by scheduled maintenance at 17:30 IST; tapping it opened My posts with draft #1. A second test notification was also received with ByLine foregrounded.
- All 18 cloud database/API tests pass, typecheck passes, and the original Next.js production build passes.
- Signed Android release APK built and independently verified: .byline-local/byline-cloud-release.apk. Package com.linkdin.byline, version 1.0.0+1, label ByLine, dedicated RSA release key. Updated after the real-device sign-in recovery fix at 17:15 IST. SHA-256: DB948F9AA2607C265E34781A5F42B20B76D46D0318C0EA17338B22A9B09E95C5.
- The owner authorized replacing the old debug-signed ByLine Live app. Its APK and local files were backed up under `.byline-local/phone-before-cloud-release`; the signed release was installed successfully on the OPPO CPH2705 on 27 October 2026 at 17:07 IST. ByLine Preview remains installed separately. No post was published.

## Owner constraints and remaining release checks

Never use Hazzino resources or branding. The temporary ByLine server, both workflows and empty D1 database in the original personal account were exported and removed. Other applications there were not changed. Only the dedicated ByLine account may be used going forward.

The owner lifted the earlier phone installation hold and explicitly approved uninstalling the old test app after Android rejected the signature mismatch. Future updates use the dedicated ByLine release signing key and should preserve app data.

The owner selected AI, software and startups, professional tone, and 09:00 India time. Phone onboarding completed at 17:19 IST, one device registered, and the daily slot starts 28 October at 09:00 Asia/Kolkata. A real-device sign-in test exposed a transient network interruption while the external browser was open; the mobile client now retries transient polling failures within the original ten-minute flow lifetime. The updated release recovered the completed sign-in. Twenty relevant mobile tests and targeted static analysis pass.

A real notification was observed in the Android notification shade, and tapping it opened My posts. The onboarding AI sample completed on the phone. The first full draft workflow failed at judging with provider_http_400. Operator diagnostics were added; the retry completed at 17:29:13 IST and saved draft #1. The original provider rejection's detailed cause was not captured, so it is not claimed resolved. For this verification only, the failed occurrence's ten-minute retry delay was advanced to permit a prompt diagnostic retry; production retry limits remain unchanged.

Scheduled maintenance delivered the draft-ready notification at 17:30:06 IST while ByLine was backgrounded. Android recorded the message on linkdin_updates; the notification was visibly found and tapped, opening the saved draft. A separate test notification was received while ByLine was the foreground activity. No localhost port reversal is active. Daily preparation starts 15 minutes before the 09:00 slot, subject to scheduler timing and provider availability. Publishing remains manual and no LinkedIn post was sent. An explicitly approved LinkedIn publication remains untested; do not claim a fully validated public launch.

The final backend version for this verification is 8a63d7ff-5b4d-4430-8df2-32b05aa00747. All 18 backend tests and typecheck pass after adding private provider diagnostics. The phone draft screenshot is saved at `.byline-local/phone-cloud-draft-verified.png`.

Existing Neon data remains quota-paused and was not migrated or deleted. The Vercel website still uses the old backend; this is a mobile API deployment, not a migration of the web dashboard. Independent outage monitoring, an off-provider backup/restore process and public-launch policy pages remain work before a paying-customer launch.

## Costs and operations

No paid plan was selected. Gemini project billing was verified disabled. This deployment remains subject to Cloudflare and Gemini free quotas; it is not unlimited or immune to outages. AI request reservations and publishing attempts have explicit limits. Job retries preserve draft identity; unknown publication outcomes require review instead of blind resends.

See cloud/README.md for deployment, recovery and signing-key details. Private credentials, signing material and smoke-test reports are ignored by Git.
