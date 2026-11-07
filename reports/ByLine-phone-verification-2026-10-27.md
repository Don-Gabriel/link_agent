# ByLine phone verification — 27 October 2026

Device: OPPO CPH2705, Android 16. Installed package: com.linkdin.byline, release 1.0.0+1, signed with the dedicated ByLine release key.

The owner explicitly approved replacement of the old debug-signed app after Android rejected an in-place update. Its APK and local files were backed up under `.byline-local/phone-before-cloud-release`. The separate Preview app was preserved.

## Verified on the real device

- Release installation succeeded; the sign-in recovery update was installed at 17:15 IST without another uninstall.
- LinkedIn sign-in returned to ByLine. A transient background-network interruption exposed a polling recovery defect; the corrected release recovered the saved flow without another login.
- Onboarding completed using professional tone and subjects covering AI, software and startups.
- One device registered for Firebase notifications, with Android notification permission granted.
- A real AI sample appeared during onboarding.
- Full cloud preparation saved draft #1 at 17:29:13 IST, after one failed provider request and a diagnostic retry.
- The scheduled maintenance workflow delivered its draft-ready notification at 17:30:06 IST while the app was backgrounded.
- The notification was visible in Android's notification shade. Tapping it opened My posts with the saved draft.
- A separate test notification was received while ByLine was foregrounded.
- The daily slot is 09:00 Asia/Kolkata, every day, starting 28 October. Preparation begins 15 minutes beforehand. Auto-publishing is off.
- The cloud scheduler health check passed, and no adb localhost forwarding is active.

## Validation and remaining limits

Twenty relevant Flutter tests passed, including transient sign-in recovery, onboarding, notification routing and draft preparation. Targeted Flutter analysis passed. Eighteen backend tests and TypeScript checking passed.

The first full draft attempt received Gemini HTTP 400. Its original detailed cause was unavailable; a later attempt succeeded. Private provider-error diagnostics are now available for investigation if it recurs. This does not establish that provider failures are eliminated.

No LinkedIn post was published. Actual publishing, tomorrow's timed draft run, media uploads and long-duration device sleep were not tested in this session. The existing Vercel dashboard still uses the old backend. This verifies the installed mobile workflow, not readiness for an unrestricted paying-customer launch.

## Build identity

- API: https://byline-api.byline-b79.workers.dev
- Worker version: 8a63d7ff-5b4d-4430-8df2-32b05aa00747
- APK SHA-256: DB948F9AA2607C265E34781A5F42B20B76D46D0318C0EA17338B22A9B09E95C5
- Signing certificate SHA-256: fcfc5a0a6d34abe8ada3e525f1f5f758a4560b9fa58261f218a0fca3ac61773c
- Screenshot: `.byline-local/phone-cloud-draft-verified.png`

Signing material, credentials, phone backups and private diagnostics remain ignored by Git.
