# Install ByLine on Android

[Download the latest APK](https://github.com/Don-Gabriel/link_agent/raw/refs/heads/main/releases/android/byline-latest.apk)

The APK is the signed **ByLine cloud release**, connected to
`https://byline-api.byline-b79.workers.dev`. It does not require your computer to run.
GitHub repository access is required if the repository is private.

1. Download the APK on your Android phone. In GitHub's file view, select **Download raw file**.
2. Open it from Downloads/Files. If prompted, allow that browser or file manager to
   **install unknown apps**, then tap **Install** and **Open**. Device policies and
   Android verification requirements may add prompts or restrictions.
3. Sign in with an available provider in a web browser. If asked, choose Chrome,
   Firefox or another browser. Finish LinkedIn login and approve ByLine's consent;
   select **Return to ByLine** on the completion page if it remains open.
4. If you signed in with Google, connect LinkedIn first. Choose subjects and optional
   voice preferences, generate and accept a sample, then choose your posting time and timezone.
5. Allow notifications if wanted. Review drafts in **Home** and **My posts**.
   Automatic publishing starts off; the first recurring slot is tomorrow in your timezone.

Customers do not enter Gemini keys or database credentials. This is an Android APK;
there is no iPhone IPA/TestFlight build in this repository.

Version **1.0.5 (build 6)** replaces timezone typing with a searchable list of
597 IANA timezones in initial setup and **Me → Timetable → Timezone**. Search by
city, region or UTC offset, or choose **Use device timezone**. Tap **Apply** to
save the selection. New setups default to the phone's timezone; saved choices
are preserved. The list and current UTC offsets work offline and account for
daylight saving. [Timezone verification](../../reports/ByLine-timezone-picker-2026-11-07.md).

This release includes the **1.0.4** changes that dismiss action popups after six seconds and reset
Home, My posts and Me to the top whenever selected, including tapping the current
tab. Both the drafts and archive lists reset when entering My posts. The cloud
backend also rotates qualifying categories, expands source searches and avoids
previously used stories. [Verification report](../../reports/ByLine-navigation-discovery-2026-11-07.md).

This release includes the **1.0.3** fix for Android sending the initial LinkedIn OAuth link to
the LinkedIn app before consent. Sign-in and reconnection explicitly select a browser.
Returning to setup refreshes connection status immediately. If no browser is enabled,
ByLine shows a retryable error. Installing this APK over the previous signed cloud
release preserves app data. If an old sign-in is still waiting, tap **Cancel** and
start **Continue with LinkedIn** again after updating.

See [release.json](release.json) for the exact version, SDK/architecture requirements,
signing certificate and SHA-256. [SHA256SUMS](SHA256SUMS) verifies the download:

```powershell
Get-FileHash -Algorithm SHA256 .\byline-latest.apk
```

An existing release signed with the same key can update in place. If Android reports
a signature conflict, do not uninstall without preserving account access and planning
the migration. A previous debug/live build may use the same package ID with a different
certificate. ByLine Preview uses a separate package and can coexist.

## Rebuild

Restore the owner's private signing key/configuration and matching Firebase client
configuration into the ignored locations described in [cloud/README.md](../../cloud/README.md).
Then run from the repository root:

```powershell
node scripts/prepare-cloud-android.mjs https://byline-api.byline-b79.workers.dev
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-cloud-android.ps1
```

Verify the APK with Android SDK `apksigner` and `aapt`, copy the exact build to
`releases/android/byline-latest.apk`, and regenerate its checksum/metadata. Never
commit private keys, key.properties, server API keys or service-account credentials.
Neither of the above build commands installs anything on a phone.

[Complete project handbook](../../output/pdf/ByLine-Complete-Project-Handbook.pdf)

Platform references: [Android distribution](https://developer.android.com/distribute/marketing-tools/alternative-distribution),
[APK signature verification](https://developer.android.com/tools/apksigner).
