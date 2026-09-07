# ByLine implementation and verification — 6 September 2026

## Live integration follow-up

The follow-up build now uses real services in a separate local environment; see [BYLINE-LIVE.md](../BYLINE-LIVE.md). Google billing was verified disabled for both the existing Gemini project and Firebase project. Four real Gemini requests succeeded: one onboarding sample and a complete source-discovery/scoring/writing run including a repair. The latter scored 34 candidates and saved an unscheduled draft above the existing quality threshold. No LinkedIn send was attempted.

Registered the separate Android package `com.linkdin.byline` in the existing Firebase project and installed it as **ByLine Live**. Firebase resources are included for background initialization. The FCM API is enabled and the local server can refresh operator access tokens without storing a new service-account private key. Added an in-app notification test, real immediate daily preparation with deduplication, recovery for interrupted sign-in, a native callback return link, reviewed-content checks on daily approval, and native Windows notifications while the desktop client is open/minimized. Added a private local database-backup command and created an archive.

Verification: the existing 108 Flutter tests passed, plus the new sign-in recovery test; 32 HTTP integration checks, four zero-budget failure checks, backend self-tests, TypeScript validation, and the backend production build passed. Android and Windows native builds succeeded. At the latest integration check, the user's LinkedIn sign-in had started but had not returned consent: there were no real signed-in accounts or registered phone tokens in this environment. Physical notification delivery and real publishing therefore remain unverified until the user completes that handoff. Google OAuth client configuration and the public-release items below are still outstanding.

The original preview findings below describe the first build and its deliberately disabled external integrations.

The Android local preview and Windows desktop client now use the existing backend and publishing engine. Customers can complete the new guided setup entirely in the native app. The existing web interface remains in the repository for compatibility with the original installation; it is not required for the new onboarding or daily loop.

## Implemented

| Area | Result |
| --- | --- |
| Account setup | Google and LinkedIn browser consent flows, verifier-protected completion exchange, individual account provisioning and revocable sessions in platform secure storage. Provider buttons appear when the service is configured. |
| LinkedIn connection | Server-owned credentials, automatic connection polling, account-name confirmation and expiry handling. Native customers never create their own developer app or enter API keys. |
| Interests | Six industries, 3–5 editable topics and automatic source selection. Added populated feeds for marketing, HR, finance, healthcare and business. |
| Voice and sample | Four presets or up to three writing examples; saved progress; sample generation, regeneration and revision-bound acceptance before activation. Real mode uses Gemini and source material. Local mode visibly uses demonstrations. |
| Daily delivery | Default 09:00 in the device timezone, adjustable time, next-day activation, durable daily records, retries, deduplication and notification outbox. Delivery time can be changed in Settings. |
| Daily interaction | Source link, hashtags, Approve/Edit/Skip and the existing composer. Scheduled advanced posts retain their scheduled approval behavior. |
| Existing features | Advanced slots, pause, publishing controls, custom writing styles, categories, manual composition, media, archive, rewrites, follow-ups, diagnostics and legacy owner login remain available. |
| Service controls | Account-scoped API access, media ownership checks, atomic post numbering, shared AI pacing and daily allowances, token-usage recording, additive migration ledger and deployment migration gate. |
| Free local testing | Separate local PostgreSQL cluster and server, fixtures without Gemini calls, simulated approval without LinkedIn sends, separate Android package alongside the original app. |

## Checks performed

- Backend self-tests and additional session, setup-validation and daylight-saving checks passed.
- 91 database checks passed against the isolated local database.
- 29 HTTP integration checks passed, including account isolation, acceptance, activation, daily deduplication, concurrent composer saves, local approval, delivery changes and session revocation.
- 108 Flutter tests passed, including a regression test covering setup completion without restarting the app.
- Flutter analysis reported no issues; TypeScript and the Next.js production build passed.
- Android debug APK and Windows release executable built successfully.
- Installed the preview on the connected Android phone. Exercised guided setup, session restoration, draft delivery, source display, editing and the settings entry. A phone-discovered setup transition bug was reproduced in a test and fixed.
- New feed URLs returned populated RSS. Replaced the initially selected broken business feed with Entrepreneur.

The tests made no Gemini calls and no LinkedIn sends. Original credentials, the original application's phone data, and the original hosted database were not replaced. The local preview server must remain running and the phone must retain its USB connection/ADB forwarding.

## Remaining work before customers

This build is a local preview, not a completed public production rollout. Real Google/LinkedIn consent and account reconnect need integration testing with the service-owned provider registrations and approved callback URLs. Gemini output quality, quota behavior and free-service data terms need validation with appropriate test content. Physical FCM delivery is not tested in the credential-free preview; native Windows notifications still need an implementation. LinkedIn recent-post import is not implemented because ordinary sign-in grants do not establish access to member post history; pasted examples work instead.

Release signing and update delivery, operational backup/restore validation, public privacy/support material, account export/deletion, provider linking across Google and LinkedIn identities, and verified migration of the original owner's history remain release work. Signing in through a different provider currently creates a separate account. Source failures or the existing quality threshold can still result in a quiet day after retries; the service cannot guarantee one suitable post or an exact push arrival time every day.

No billing or paid services were enabled. Local commands and integration boundaries are documented in [BYLINE-LOCAL.md](../BYLINE-LOCAL.md).
