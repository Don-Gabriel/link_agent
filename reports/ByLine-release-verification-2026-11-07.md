# ByLine documentation and APK verification - 7 November 2026

## Scope

Packaged the current working project, including the previously uncommitted cloud
backend and shared-core/mobile changes, for repository publication. Added the complete
PDF handbook, every-file purpose/source/dependency reference, machine-readable hash
inventory, phone installation guide and signed cloud APK. No production backend was
deployed, no phone was installed/uninstalled, no account was deleted and no LinkedIn
post was published during this task.

## Fresh application checks

- Root `npm test`: passed core self-tests and health readiness/redaction checks.
- `npm run test:catalogue`: passed; 1,112 unique subjects, 55 specialist groups.
- `npm run test:byline`: passed session, input validation, delivery and DST checks.
- `npm run build:check`: passed Next.js 15.5.28 production compilation and type checks.
- `npm run test:db`: all 92 checks passed against a new disposable PostgreSQL 18
  cluster on loopback port 55449. That test server was stopped afterwards. The
  original database and existing local preview data were not used.
- Cloud `npm run typecheck`: passed.
- Cloud `npm test`: all 30 tests passed on the complete rerun, including isolated
  Worker/D1 ownership, OAuth, jobs, notification budgets and publication idempotency.
  The initial run passed 29 and failed one OAuth test with a Miniflare internal
  assertion. The failing test then passed alone, and the complete suite passed
  without code changes. This is recorded as an intermittent test-runtime failure;
  its root cause was not established.
- `flutter analyze lib test`: no issues.
- `flutter test --no-pub`: all 169 tests passed.
- `git diff --check`: passed for the working application changes.
- Read-only deployed `/api/health?check=scheduler`: HTTP 200, database OK, scheduler
  healthy; observed heartbeat `2026-11-07T06:40:03.228Z`.

## APK

The existing cloud build preparation validated the approved HTTPS origin and matching
Firebase package, preserved the private release signing key, and built successfully.
The exact resulting APK was copied into `releases/android/byline-latest.apk`.

- Version 1.0.2, versionCode 3; package `com.linkdin.byline`.
- 56,892,335 bytes; universal APK with arm64-v8a, armeabi-v7a and x86_64.
- Minimum API 24 (Android 7.0); target/compile API 36.
- Backend `https://byline-api.byline-b79.workers.dev`.
- APK SHA-256 `8f0b84d52aaad072c4751128bfb3ba98c87766fd8a9b0385bf8654591769c831`.
- Signing certificate SHA-256 `fcfc5a0a6d34abe8ada3e525f1f5f758a4560b9fa58261f218a0fca3ac61773c`.
- Android SDK `apksigner verify --verbose --print-certs`: signature verifies with
  APK Signature Scheme v2, one RSA 3072-bit signer, CN=ByLine, O=ByLine.
- Android SDK `aapt dump badging`: package/version/SDK/ABI metadata confirmed.
- Flutter 3.44.1, Dart 3.12.1; Node 24.15.0 used for backend checks.

The fresh build is byte-identical to the 5 November recorded release. There was no
new mobile feature change requiring a version bump in this documentation task.
Flutter emitted a future-compatibility warning about flutter_timezone applying the
Kotlin Gradle Plugin. The current build succeeded; upgrading the plugin/toolchain
is future maintenance, not a failed release check.

## Documentation integrity

`scripts/build-handbook.py` builds the narrative and exhaustive generated appendices.
`docs/repository-inventory.json` records every publishable file and non-derived hash;
`docs/handbook-build.json` records final PDF page count, coverage and checksum.
Generated documentation is excluded from recursive source reproduction but included
in the catalogue. Binary assets are catalogued, all existing UI preview PNGs are
rendered, npm locks receive full resolved package inventories, and the Dart lock is
included in full. Secrets, SDKs, third-party dependency source, caches and live data
are outside this distributable documentation scope.

## Verification boundaries

This task did not repeat real social consent, real AI generation, physical push
delivery or publication. See the dated 5 November report for prior device/provider
evidence and its limitations. A successful health read is a point-in-time result.
The separate local API `test:local` suite was not rerun; root logic, real disposable
PostgreSQL, cloud runtime and Flutter suites above were run. This does not establish
all third-party behavior or production availability.

The GitHub connector provided read access but not write access. Repository publication
uses the workstation's already authenticated owner Git/CLI credentials. Private
server and signing credentials remain ignored and are not part of the release.

## Condensed reading edition

At the owner's request, the PDF was revised to a 100-120 page reading edition.
All file-purpose entries, architecture/stack explanations, phone setup, API/schema
and configuration references remain. Full application source and historical
reports remain in docs/generated-reference.md. The PDF shows one phone-width
preview per screen; wider variants remain in the repository. This is a documentation
revision; application code, the APK and the earlier test results are unchanged.
