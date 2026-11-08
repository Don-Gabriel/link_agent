# ByLine 1.0.8: replaceable AI service

Release date: 9 November 2026 (Asia/Kolkata). Android version **1.0.8+9**,
package `com.linkdin.byline`, using the dedicated Cloudflare API.

The mobile backend now uses Cloudflare Workers AI with GLM-4.7-Flash. Gemini is an
explicit rollback option, not an automatic fallback. The inference boundary also
supports an authenticated compatible service for future self-hosting. No paid
Cloudflare upgrade was enabled.

The release adds persisted concurrency/usage controls, bounded retries and
timeouts, encrypted successful-response replay, recovery of interrupted job
dispatch, structured response contracts, and an idle-scheduler optimization.
New-model drafts require factual review. Tests found unsupported model claims and
writing-preference misses; this release does not certify unattended publishing
or unlimited free user capacity. Customer billing/licensing is separate future work.

The APK uses the existing release signing key and a higher Android version code.
The Android UI is unchanged; this build packages the current client for the AI
backend rollout. No phone installation, notification or LinkedIn publication is
performed as part of this release.

## Verification

- Cloudflare TypeScript check and 68 isolated cloud tests passed.
- Root logic/readiness tests and the Next.js production verification build passed.
- Real live preview and background generation passed using only GLM-4.7-Flash.
  Both had factual-review notes. Seven inference calls reported 283.9506 neurons
  across the two jobs. The disposable author was deleted afterward.
- Live health and naturally advancing scheduler checks passed; unauthenticated
  usage requests were rejected.
- Android build/signature verification and checksum are recorded in
  [release.json](../releases/android/release.json) and
  [SHA256SUMS](../releases/android/SHA256SUMS).
- Flutter analysis found no issues and all 206 Flutter tests passed. The signed
  universal APK reports version 1.0.8, build 9, Android 7.0 minimum and the same
  release certificate as 1.0.7. Its SHA-256 is
  `6449c8391744f6d8b0a998cb7a8d1c6c9105eef532029a596773c81d8d9eb7fe`.
  A matching copy was placed in the owner's Downloads folder.

Detailed evidence, failed model experiments, migration and rollback information:
[AI validation](../docs/ai-validation.md), [research](../docs/ai-service-research.md),
[operations](../cloud/AI.md). The historical PDF/source inventory remains dated
7 November 2026; it is not the source-hash manifest for this release.
