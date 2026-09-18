# ByLine client pilot on Render

This is the current deployment path for clients who bring their own Gemini key.
The original operator deployment remains documented in DEPLOY.md. Image generation is a later feature.

## Cost and service limits

Use one **Free** Render Node web service and the existing Neon free project. Do not create Render's free PostgreSQL database for durable client data: it expires after 30 days. Do not add a paid Render cron job, disk or worker. Render's free service sleeps after 15 idle minutes and shares 750 running hours/month with the workspace's other free services. There is no uptime guarantee; this is a small pilot, not unrestricted production hosting. Check bandwidth, build minutes, outbound usage and Neon compute/storage allowances before onboarding more clients. Never enable billing or automatic paid upgrades to avoid a quota stop.

A five-minute external cron can keep the service running most of the month (up to 744 hours), leaving little of a shared 750-hour allowance for other services. Multiple active free apps in the same workspace may exhaust it. Cold starts can delay requests. Do not promise exact-time posting or uninterrupted access on this setup.

## Hosted service

1. Run `npm run build:check`, `npm run test:byok`, `npm test`, and Flutter analysis/tests.
2. Push the reviewed release branch to the existing private GitHub repository. Keep the repository private. Connect it to Render with Node, the Free plan, Ohio region, build command `npm ci --include=dev && npm run build`, start command `npm run start:hosted`, health check `/api/health`, and auto-deploy Off. The same settings are in `render.yaml` for new Blueprint installs.
3. `node scripts/prepare-render-env.mjs` creates a new `byline_public` database inside the existing Neon project and writes ignored `.byline-release/render.env`. Run `node scripts/scope-hosted-db.mjs` to replace administrator database access with a dedicated non-admin role before uploading the file. It does not copy personal accounts/posts or the operator's Gemini key. Run preparation once; securely back up that file. If using another database, supply its connection string directly. If migrating existing records, preserve their original `TOKEN_ENCRYPTION_KEY`.
4. Import that file into Render's environment variables. The file contains database access, the existing LinkedIn developer credentials, and newly generated server secrets. Add optional Firebase service-account fields only for a dedicated messaging service account. Never deploy the local Firebase CLI refresh/access-token files. There is no hosted operator Gemini key.
5. Deploy. Startup applies the additive database migration before starting Next.js. The public URL comes from `RENDER_EXTERNAL_URL`. Shared-password access and local test modes are forced off; native users always use their own Gemini key.
6. In the existing LinkedIn developer app, add `https://ACTUAL-RENDER-HOST/api/linkedin/callback` as an authorized redirect. Preserve existing redirect URLs. The app needs OpenID Connect sign-in and Share on LinkedIn (`openid profile w_member_social`; email is not needed). Set the website and privacy-policy URLs to this service where required. Leave Google sign-in unconfigured until account linking is implemented.
7. Verify `/api/health`, `/privacy`, `/support`, unauthenticated API rejection, and the native sign-in flow. `LINKEDIN_LIVE=false` permits drafting but blocks actual publication. Enable it only after the intended LinkedIn account and review flow have been verified. Existing drafts default to manual approval.

## Scheduling and notifications

Use cron-job.org to GET `/api/cron/wake` every five minutes, with header `X-Cron-Secret` from this installation. Never put the secret in the URL. The endpoint returns 202, then runs the existing tick in the background. Slot locks and publishing idempotency handle duplicate triggers. The endpoint does not make successful delivery or exact timing guarantees.

Use `/api/watchdog` every three hours with the same header if you want an independent scheduler check. Do not replace the original installation's GitHub Actions secrets with this pilot's values. Free Actions quotas are shared too. Configure scheduler failure notifications in the scheduler provider. Health probes do not query the database, so Render's frequent liveness checks do not continuously wake Neon.

Push needs `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` and `FCM_PRIVATE_KEY` from a dedicated service account authorized to send FCM messages. Store the key only in Render and an encrypted operator backup. Without them the app still works, but phone reminders will not arrive.

## Android distribution

Run `scripts/build-release-android.ps1 -PublicUrl https://ACTUAL-RENDER-HOST -BuildNumber 2`. Set `JAVA_HOME` and install Flutter/Android build tools first. The helper generates a private signing keystore only if none exists. Back up `.byline-release/private/` **and** `mobile/android/key.properties`; losing them prevents updates to the installed app. Neither belongs in Git.

The output is `.byline-release/byline.apk`, signed with the release key, with a fixed HTTPS service address and cleartext traffic disabled. It uses package `com.linkdin.byline`; a previously installed debug-signed ByLine Live app must be uninstalled before this release can be installed. The original app uses a different package. Give clients the APK directly during assisted installation. For a public download page, host only the APK (never the private directory or environment file) and set `BYLINE_ANDROID_DOWNLOAD_URL` to its HTTPS URL. Google Play publication is a separate paid developer-account/distribution process.

## Onboarding each client

1. Generate a single-use invitation with `npm run invite` under the **hosted database environment**. It expires after seven days. The code is shown once; share it privately. A returning account does not need a new invitation.
2. Install the release APK. The client signs in with their real LinkedIn account and authorizes the existing developer app. They do not need a second LinkedIn account or developer/business setup.
3. Help the client create a Gemini-restricted key in their own Google AI Studio project. They enter it in the app, select the allowed text model, acknowledge the data/billing terms, and test it. That makes one small generation request on their project. The server encrypts it, binds it to their account and only returns the last four characters.
4. Set topics, voice, samples and schedule, generate a preview, and accept it. Gemini outages, missing keys or exhausted quotas stop generation for that account. There is no fallback to another client's or the operator's key. Key rotation does not reset the account's local allowance. Google's actual quotas apply per project, so clients should use separate projects.
5. Review the first draft before publishing. Settings provides key replacement/removal, account export and deletion. Removing the Gemini key does not revoke it at Google or cancel previously approved publishing. Pausing the schedule is a separate control.

ByLine cannot determine a project's billing status from its key and cannot guarantee zero Google charges for a client who enabled billing. Free quotas and model availability may change. Google's unpaid-service terms prohibit personal, sensitive or confidential inputs; do not include these in writing samples or instructions. The system omits the account name from the persona prompt, but does not automatically anonymize arbitrary text. Paid Services are required for users in the EEA, UK and Switzerland.

Sources checked 18 September 2026: [Render free service limits](https://render.com/docs/free), [Render Next.js deployment](https://render.com/docs/deploy-nextjs-app), [Gemini keys](https://ai.google.dev/gemini-api/docs/api-key), [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Gemini terms](https://ai.google.dev/gemini-api/terms), [LinkedIn sharing](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin).
