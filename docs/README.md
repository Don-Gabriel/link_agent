# Complete ByLine documentation

- [Download the complete PDF](../output/pdf/ByLine-Complete-Project-Handbook.pdf)
- [Readable handbook source](handbook.md)
- [Every file, dependency and source listing](generated-reference.md)
- [Machine-readable file inventory and SHA-256 hashes](repository-inventory.json)
- [PDF coverage and checksum](handbook-build.json)
- [Download and install the Android app](../releases/android/README.md)
- [Current verification evidence](../reports/ByLine-release-verification-2026-11-07.md)

The PDF includes the architecture, technology usage, accounts, onboarding, discovery,
AI, scheduling, publication, notifications, data model, API, configuration,
developer setup, operations, troubleshooting, every repository file's purpose,
resolved npm dependencies, test titles and selected phone UI previews. The PDF is a
100-120 page reading edition. Complete project text source and historical documents
remain in the linked generated reference rather than filling hundreds of PDF pages.

Rebuild from the repository root with Python 3 and `reportlab`/`pypdf` installed:

```powershell
python -m pip install reportlab pypdf
python scripts/build-handbook.py
```

The generator enumerates Git-tracked and non-ignored files. It fails on files with
no defined purpose so additions must be documented. It never reads ignored private
environments, build caches or databases. Derived document artifacts are catalogued
without recursive self-hashes. The signed APK must be prepared and its release
metadata updated before building the handbook.

Inventory `sha256` values identify the captured workstation bytes. Text entries also
include `lf_sha256` with CRLF normalized to LF so Git's cross-platform newline
conversion can be verified without treating it as a content change. Binary hashes
(including the APK) are exact on every platform.

The PDF's source lines use escaped non-ASCII characters/normalized punctuation for
portable rendering. Repository files and their recorded hashes remain byte-exact.
Historical reports and comments describe their original snapshot; use the current
implementation and fresh verification report for current behavior.
