# ByLine: free local development and phone testing

The native ByLine client shares the existing publishing engine. The new local preview installs as `com.linkdin.byline_preview`, alongside the original application. It uses a separate PostgreSQL database and a backend on port 3100. The original `.env`, provider accounts, application ID and saved history are not replaced.

## Start the local system

For a connected Android phone on Windows, run `npm run local:phone`. This prepares
the isolated database, starts the backend in the background if needed, builds the
preview APK if missing, and installs and opens it over USB. Use
`npm run local:phone -- -Rebuild` after changing Flutter code. Server logs are in
`.byline-local/server.stdout.log` and `.byline-local/server.stderr.log`.

To run the backend in a visible terminal instead:

From the repository root:

```powershell
npm run local:setup
npm run local:dev
```

Keep the second terminal running. Setup uses PostgreSQL 18 already installed on this computer and creates `.byline-local/postgres` on localhost port 55440, plus ignored `.env.byline-local` secrets. It never reads or copies your Gemini, LinkedIn or Firebase credentials. Set `PG_BIN` to another PostgreSQL installation directory if needed.

The launcher binds the API to localhost and ticks the existing scheduler every 30 seconds. Sleeping or shutting down the computer stops it. Data survives restarts. This local database uses trust authentication on the loopback interface for development; do not expose its port to the network.

## Install on Android without a store

Enable USB debugging on your Android phone and connect the cable. Run:

```powershell
./scripts/build-local-android.ps1
./scripts/install-local-android.ps1
```

The installer forwards the phone's localhost:3100 to the computer over USB and opens ByLine. Re-run it, or `adb reverse tcp:3100 tcp:3100`, after reconnecting a phone if the app cannot reach the server. Keep the cable connected for this setup. No server address or API key is entered in normal onboarding.

On the welcome screen choose **Try local preview**, complete topics/voice/sample acceptance/time, then choose **Not now** for notifications. Use the preparation action on the home screen to create a demonstration draft for today's Timetable entry. Edit, skip, composer, archive and voice settings remain available. Each timetable entry produces at most one draft per local calendar day; repeated preparation does not replace an existing, skipped or published draft.

Local samples are explicitly labelled demonstrations. They exercise the app and database without calling Gemini. Local approvals move a post into the local archive and are labelled simulations; they never call LinkedIn. Notifications accurately report unavailable in this environment because the launcher clears Firebase credentials. Physical FCM delivery needs a separately configured integration run.

The local APK disables Google Services processing and uses a separate application ID; this is intentional. It does not impersonate the Firebase registration of your original app.

## Windows desktop

```powershell
cd mobile
flutter build windows --release --dart-define=BYLINE_API_URL=http://localhost:3100 --dart-define=BYLINE_LOCAL_TEST=true
```

Run `mobile/build/windows/x64/runner/Release/ByLine.exe` with the whole Release directory present. The first build downloads the Firebase C++ build dependency. The native Windows client uses the same account and API. Windows push delivery is not implemented by the Android Firebase Messaging plugin; the desktop application reports notifications unavailable. Review through the phone or open desktop app.

## Real integrations, when ready

The local launcher intentionally disables external credentials and publishing, even if the original `.env` contains them. To test real provider consent or real Gemini output, use a separately configured environment with test content appropriate for Gemini's free-service terms. Do not enable billing for local development.

- ByLine owns Google OAuth credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `GOOGLE_REDIRECT_URI`). The default callback is `/api/native-auth/callback` under `BYLINE_PUBLIC_URL`.
- LinkedIn uses the existing ByLine-owned developer app and `LINKEDIN_REDIRECT_URI`, normally `/api/linkedin/callback`. The callback supports both legacy connection and native sign-in. Customers need no company Page or developer app.
- Native sign-in uses the external system browser. A random verifier protects a single-use completion exchange; the app polls the authenticated flow and continues automatically. Cancelling or killing the app before completing sign-in may require restarting consent.
- Native session credentials are stored using the platform secure-storage plugin. Sessions have separate account identities and server-side revocation. Legacy password login remains under **Existing installation** for the original owner.
- Set the API URL at build time with `--dart-define=BYLINE_API_URL=https://your-backend`. A client web dashboard is not needed. An HTTPS callback and public privacy/support pages remain service infrastructure.
- Existing accounts are not silently assigned to a public signup. Moving existing history to a social-login account requires an explicit, verified owner migration; the old login continues to work meanwhile.

## Verification

```powershell
npm test
npx tsx scripts/byline-logic-test.ts
node scripts/byline-test.mjs
npm run test:local
npm run build:check
cd mobile
flutter analyze lib test
flutter test --no-pub
```

`test:local` requires the local launcher and runs the account/Timetable, catalogue API and native OAuth return suites. It creates isolated test accounts and checks ownership, activation, stale samples, asynchronous preparation, deduplication, simultaneous composer saves, simulated publishing and logout. It never uses the original database. The existing `test:db` suite must likewise run against a disposable/local database.

## Production boundary

Implemented capabilities include individual accounts, native OAuth completion, resumable saved onboarding, source-based Gemini previews, sample acceptance, separate daily review delivery, durable delivery retries and a notification outbox, application AI allowances, per-model shared pacing, token-usage records, source links, and local/desktop packaging.

This is a testable implementation, not a certification of public production readiness. Before admitting customers, validate actual provider grants and callback URLs, Gemini quota/data handling and measured costs, physical notification delivery, desktop notification strategy, release signing/update distribution, backup restoration, account export/deletion including optional external memory, and an explicit migration for existing history. Quiet days can still produce no post after retrying when no source clears the existing quality threshold. Exact push arrival time and automatic LinkedIn history import are not guaranteed.

Database changes are additive and recorded by schema hash in `byline_schema_versions`, under a transactional advisory lock. For a hosted deployment, first back up the selected database, configure that deployment's `DATABASE_URL`, and run `npm run migrate`. Set `BYLINE_REQUIRE_MIGRATIONS=true` in the serving environment so a release fails closed if its migration has not run. Existing installations keep automatic initialization by default for compatibility. The original hosted database has not been migrated as part of this local build.

No paid service is required or enabled by these local commands.
