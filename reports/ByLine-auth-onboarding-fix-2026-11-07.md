# ByLine 1.0.3 (4): Android authentication and first-run setup

Date: 7 November 2026. Supersedes the APK portion of the earlier same-day release
report; the original backend/database validation remains historical evidence.

## Reported failure and change

On a new Android phone, LinkedIn opened before the user reached ByLine's consent
screen. The previous `externalApplication` launch left Android free to resolve the
provider's HTTPS URL to the LinkedIn app. The shared `openAuthBrowser` helper now
routes Android OAuth through `byline/auth_browser` and `AuthBrowser.kt`.

The native bridge discovers general HTTP/HTTPS browser activities using public
resolved intent filters, rejects host-restricted app handlers and disabled or
unexported activities, and explicitly sets the browser package on the OAuth intent.
It prefers the user's eligible default browser; otherwise every chooser entry is
explicitly scoped to a browser. The URL, state and HTTPS callback are preserved.
No WebView, credential interception or unrestricted resolver fallback is used.
The same path serves welcome sign-in, setup connection and settings reconnection.
Other platforms retain external-browser authentication.

No enabled browser produces a retryable error and clears an unlaunchable welcome
flow. Existing verifier-protected, securely stored pending-flow recovery remains.
Disposed/cancelled welcome attempts cannot apply a late response to a newer attempt.
Setup refreshes LinkedIn status on foreground return, checks at three-second
intervals for up to ten minutes, prevents overlapping connection requests, and
updates only account status so delayed responses cannot revert saved setup revisions.

## Verification

- `flutter analyze --no-pub lib test`: no issues.
- `flutter test --no-pub --reporter expanded`: 177 tests passed.
- Cloud `npm run typecheck`: passed; `npm test`: 30 tests passed, including D1
  identity/session ownership, OAuth state/verifier/callback and onboarding guards.
- `:app:testDebugUnitTest` with the local-preview define: 8 native tests passed
  across Android API 24 and 35. Checks cover a provider app claiming web links,
  explicit browser-only choices, disabled/missing browsers and unsafe URLs.
- Signed release build: passed. `aapt` confirms `com.linkdin.byline`, version
  1.0.3/build 4, minimum API 24, target/compile API 36 and all three universal ABIs.
  `apksigner verify --verbose --print-certs` verifies APK v2 signing and the same
  certificate SHA-256 as the previous release. The merged manifest contains browser
  visibility queries and the ByLine return link. All three compiled Dart libraries
  contain the expected cloud API origin.

New Flutter coverage checks the intact OAuth URL reaching the native bridge, unsafe
URL rejection, browser unavailable/platform failure without a provider-app fallback,
fresh sign-in exchanging the original verifier and storing its session, and failed
launch clearing the pending flow and enabling retry. Existing tests cover secure
pending-flow restoration after network/server interruption and completed setup
opening the daily screen.

New 360-pixel-wide setup journeys cover subjects and adding a topic, default or
custom voice, saving a new revision, sample generation failure and retry, sample
acceptance, posting time/timezone payloads, skipping notifications or unavailable
Firebase, and opening ByLine. Connection coverage verifies transient GET failures,
foreground recovery, no overlapping requests and polling stopping after success.
These are automated tests with mocked provider/network boundaries; they do not
claim a live LinkedIn account consent or physical FCM delivery was performed.

## Reproduction and phone checks

1. Install the repository's 1.0.3 build 4 APK over the previous same-key cloud app.
2. On a fresh installation with LinkedIn installed, tap Continue with LinkedIn.
   A web browser (or a chooser containing only browsers) must open.
3. Complete LinkedIn login and ByLine consent. On the completion page select Return
   to ByLine if needed. The app must recover the flow and load the account's setup.
4. For a Google signup, connect LinkedIn from setup and return. Verify the connected
   profile is shown; repeat reconnection from Me after setup when appropriate.
5. Choose subjects, optional voice, generate/retry and accept the sample, choose time
   and timezone, and either enable or skip notifications. Open ByLine, close/reopen
   it and verify setup stays completed. Notification denial must not block entry.

The owner's phone was not installed, reset or changed during this work. A real
new-phone login through LinkedIn remains a device validation step. No production
backend deployment, account mutation, real publication or paid AI generation was
needed for this client-side fix. The release uses the existing cloud origin and
private release signing identity; no secret files are included in Git.

## Repeat the checks

From `mobile`, run the Flutter analyzer and test commands above. For native tests,
prepare the Flutter Android toolchain (`flutter pub get` and a local preview build
if Gradle wrapper/local.properties have not yet been generated), then from
`mobile/android` run:

```powershell
.\gradlew.bat :app:testDebugUnitTest -Pdart-defines=QllMSU5FX0xPQ0FMX1RFU1Q9dHJ1ZQ==
```

The encoded define is `BYLINE_LOCAL_TEST=true`; it prevents Firebase production
configuration being required for the isolated native tests. JUnit/Robolectric are
test-only dependencies. Native tests use Android API 24 and 35 models.
Robolectric's SDK cache is kept in ignored build output to avoid its Windows
native-loader issue with spaces in the user-home Maven cache. The first run hit
that tooling issue; after relocating the cache, all eight checks passed.

Release instructions and the exact APK SHA-256/certificate are in
`releases/android/README.md`, `release.json` and `SHA256SUMS`.

Technical references: [LinkedIn authorization code flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow),
[AppAuth Android browser discovery](https://github.com/openid/AppAuth-Android/blob/master/library/java/net/openid/appauth/browser/BrowserSelector.java),
[Robolectric setup](https://robolectric.org/getting-started/).
