# ByLine with real services and a zero budget

This development environment uses the existing Gemini and LinkedIn application credentials on your computer. Google’s billing API was checked before generation: billing was disabled for the Gemini project and Firebase project. Nothing enables billing, buys credits, or provisions a paid host.

## Start

```powershell
npm run local:setup
npm run live:setup
npm run live:dev
```

The live launcher serves localhost:3000 and runs the scheduler every 30 seconds. It uses a separate local database, `byline_live`. The original `.env`, hosted database and original phone application are preserved. The demo remains on port 3100 with database `byline_local`.

The Firebase CLI must already be signed into the project. The launcher refreshes a short-lived operator access token for FCM; no service-account private key is required for local testing. That token stays in an ignored local file. This operator login is a development credential source, not a credential to distribute to customers or embed in an APK.

The launcher periodically checks the Gemini project’s billing status. AI requests require a recent successful verification tied to the configured API key; expired, missing or mismatched verification blocks generation. Free-tier quota exhaustion is handled as an unavailable writer, not a paid upgrade. Never turn on billing for this environment.

## Android

```powershell
./scripts/build-live-android.ps1
./scripts/install-live-android.ps1
```

Open **ByLine Live** (`com.linkdin.byline`), choose **Continue with LinkedIn**, complete your own sign-in and consent, then use **Return to ByLine**. Complete topics, voice, sample acceptance, delivery time and notifications. There is no client API-key form or company/developer-app setup.

After setup, **Prepare today’s post** runs the real source-discovery, scoring and writing pipeline immediately. It reuses the current day’s suggestion if one already exists. Read the post and source first. **Approve publishes to your connected LinkedIn profile for real.** Edit and Skip remain available. Nothing in the smoke tests presses Approve or publishes a test post.

Use **Settings → Daily delivery → Send a test notification** to verify FCM on the handset. Test with the app in the background too. Keep the USB cable connected; the installer forwards localhost:3000 from the phone to the computer. After reconnecting, run `adb reverse tcp:3000 tcp:3000` again. The server and computer must remain awake for generation and delivery.

Google sign-in is implemented but its service-owned OAuth client is not configured in the current installation. LinkedIn is the configured sign-in route. Signing in through a different provider currently creates a separate account; provider linking remains release work.

### LinkedIn callback registration (app owner only)

For this USB-connected development build, the existing LinkedIn developer application must include `http://localhost:3000/api/linkedin/callback` under **Auth → OAuth 2.0 settings → Authorized redirect URLs**. Add this alongside existing URLs so the original installation keeps working. This must belong to the application whose client ID is configured in `.env.byline-live`; changing a different LinkedIn application will not fix sign-in.

The live server sends that exact callback, and the Android installer forwards port 3000 over USB. A LinkedIn error saying the redirect URL does not match the registered value requires correcting the registration before authorization can finish. After saving, cancel the pending sign-in in ByLine Live and start a new attempt. No APK rebuild is needed for the portal change. This is a one-time owner configuration, never a customer onboarding step.

## Windows

```powershell
cd mobile
flutter build windows --release --dart-define=BYLINE_API_URL=http://localhost:3000 --dart-define=BYLINE_APP_VARIANT=live
```

Run `mobile/build/windows/x64/runner/Release/ByLine.exe`, keeping the whole Release directory together. Sign in with the same LinkedIn account to use the same data as your phone. Native Windows notifications check for new drafts while ByLine is open or minimized; closing the application stops desktop checks. Android FCM is the background delivery route when the desktop application is closed.

## Light interface and flexible preferences

The Android and Windows clients now use a light slate-and-blue interface with dark readable text, softer surfaces, and responsive navigation. Desktop uses a navigation rail and bounded reading columns; phones retain labelled bottom navigation.

- **Voice:** type your own writing instructions and paste previous posts first. Presets are optional. Expand **Fine-tune your writing** for structure, opening/closing, audience, length, hashtags, signature and banned phrases. Save and Preview remain available.
- **Topics:** add/remove personal interests in your own words, then **Save interests**. Up to 12 interests are supported after onboarding. Source coverage remains independently selectable below, so changing interests preserves feed choices and writing style.
- **Daily delivery:** choose an exact time, including individual minutes, and edit the timezone. Quick choices are shortcuts. Advanced publishing slots and daily approval delivery are described separately.
- **Daily use:** read the draft and source, then Approve, Edit or Skip. Advanced draft controls, composer, attachments, rewrites, archive, connection and diagnostics remain available.

The research and implementation plan is in `reports/ByLine-UX-redesign-plan.md`. Widget-rendered previews using synthetic data are in `reports/ui-preview`; these are not screenshots of your private account.

Updated local artifacts: `.byline-local/byline-live.apk` (Android debug build for direct testing) and `.byline-local/ByLine-Windows.zip` (extract the entire archive before running `ByLine.exe`). Both still target localhost:3000. Updating Android with the install script preserves the existing ByLine Live session and data.

## Backup

```powershell
npm run live:backup
```

Backups are private PostgreSQL archives under `.byline-local/backups`. Keep the matching `.env.byline-live` encryption key with your private backup process; encrypted LinkedIn credentials cannot be recovered without it. Restore into a new database first and validate the result before replacing any working database.

## Verification and remaining handoffs

Real Gemini generation and the full discovery → scoring → writing pipeline were exercised successfully. No LinkedIn post was published by the automated pipeline tests. On 2026-09-06, the owner reported successful phone onboarding, voice setup, draft preparation and publishing to their LinkedIn profile. A separate background FCM test was then sent with the owner's confirmation: Google accepted delivery to one registered device, Android recorded the ByLine test notification, and a phone screenshot confirmed it in the notification shade. The Android foreground notification path was subsequently updated so messages also appear in the notification shade while ByLine is open. The rebuilt APK was installed, and the in-app test button was exercised on the handset: Android recorded the test notification and the shade showed it. The original banner remains a fallback when system notifications are disabled. Scheduled daily delivery still needs end-to-end handset verification.

This setup is functional local infrastructure, not free always-on hosting: it stops when the computer sleeps or the server stops. Public distribution still needs HTTPS hosting/callback configuration, release signing/update distribution, privacy/support material, account export/deletion, provider linking and any requested migration of original history. LinkedIn recent-post import is not implemented; pasted voice examples work without restricted history access.
