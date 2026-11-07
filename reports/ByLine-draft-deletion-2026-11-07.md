# ByLine 1.0.7: consistent draft deletion

Deleting a draft from Home or My posts now immediately removes its card across both screens. Home no longer displays a deleted occurrence as a planned post with four completed preparation stages. The My posts activity rail excludes deleted drafts instead of saying “Drafted, waiting on you.”

The API derives visibility from the saved rejected post status, so previously deleted drafts are covered without a migration. The consumed occurrence remains recorded to prevent automatic regeneration; recurring future posting times remain intact. Mobile remembers successful deletions per account for the session and filters cached responses, including after a failed status refresh. Unsuccessful deletion requests do not create this suppression.

## Verification

- Cloud TypeScript check passed; all 49 backend tests passed.
- Flutter analysis passed; all 206 Flutter tests passed.
- API regression covers scheduled and manual deletion, repeated reloads, timeline removal, and another author's unchanged draft.
- Widget regressions cover both scheduled and manual cards surviving in stale polling responses after deletion, with a failed status refresh. Both remain hidden.
- Android release build completed: 1.0.7, build 8, package com.linkdin.byline.
- APK signature verified with the existing release certificate; SHA-256 is in releases/android/SHA256SUMS.
- Dedicated ByLine Worker deployed as f390a20c-c77c-4d83-b3d1-dcdf6d996332; live database and scheduler health returned healthy.
- No phone installation or physical-device test was performed. Existing PDF unchanged.
