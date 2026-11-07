# ByLine 1.0.6: scheduling, generation recovery and identity

Released 7 November 2026. Android version **1.0.6+7**, package
`com.linkdin.byline`. The signed APK is linked at the top of the repository README.
The existing PDF handbook is unchanged.

## Findings and fixes

The reported preparation had completed discovery and article review, then failed
the final writing-preference gate. It had not failed because too few topics were
selected. The old pipeline discarded the generated work after two unsuccessful
style repairs, and the Home screen could promise another attempt even after that
posting occurrence had expired.

- The second repair can now request just a missing evidence-based paragraph,
  preserving the existing argument instead of repeatedly rewriting it shorter.
- A repair-service outage preserves the best text already produced.
- Remaining style mismatches become explicit review notes on a saved draft or
  first-run sample. They do not silently change the author's preferences. Such
  drafts cannot publish automatically without explicit approval.
- Source selection, relevance and duplication checks remain in place. No template
  filler, fabricated source or lowered relevance threshold was added.
- Home distinguishes an actual scheduled retry from an expired occurrence needing
  attention. Exhausted attempts no longer offer a button the backend cannot honor.

The timezone review found that future slots were recalculated but prepared posts
could retain their previous UTC send time. Individual post scheduling and labels
also used the device clock, even when another zone was selected in ByLine.

- Upcoming timetable drafts move with the selected timezone. Pending review alerts
  move in the same guarded database transaction; existing approvals are cleared.
- Published, in-flight and individually rescheduled posts retain their instants.
  A moved occurrence that is already past due becomes an unscheduled review draft.
- Single-post time selection, confirmations and countdown labels use the selected
  IANA zone. Client/server policies agree: DST gaps move forward, repeated times run
  once at their first occurrence, and fractional UTC offsets are supported.
- Today's timetable calculates the exact local calendar date, including date-line
  zones, rather than searching an approximate 36-hour interval.
- Consumed future occurrences advance beyond themselves, preventing them from
  repeatedly occupying the scheduler's bounded batch.
- Cron checks every minute. Automatic draft alerts become eligible when the review
  window opens; user-requested drafts notify immediately after completion.

The broader pass also fixed:

- Undoing approval, editing or rescheduling sets a per-post review guard. A slot's
  automatic-publishing setting cannot override that decision.
- A multi-device notification is complete only when all registered target devices
  have accepted it or have been removed as invalid. Retries skip successful devices,
  retain a concurrency lease, and retry outstanding devices after one minute.
- Already published/discarded drafts do not emit a delayed ready notification.
- Delayed settings responses and stale Home authentication errors cannot overwrite
  or sign out another account after an account switch. Sign-out clears loading state.

## Logo and assets

The new [ByLine mark](../mobile/assets/branding/README.md) combines a lowercase b,
pen nib and editorial underline. It is bundled into the app header, Android legacy
and adaptive launcher icons, Windows ICO and web icon assets. The master PNG and a
repeatable platform-size packaging script are committed. No network asset is
required to render the brand.

## Verification

| Check | Result |
| --- | --- |
| Flutter static analysis | No issues |
| Flutter suite | 204 tests passed |
| Android OAuth browser tests | 8 tests passed on API 24/35 models |
| Cloud typecheck and Miniflare suite | 49 tests passed |
| Root logic/readiness and ByLine schedule checks | Passed |
| Next.js production verification build | Passed |
| Isolated PostgreSQL integration suite | 92 checks passed; temporary server stopped |
| Real cloud generation with one subject | 224 body words; job completed and fixture removed |
| APK metadata and signature | 1.0.6+7, Android 7+, existing release certificate |
| Live database | Additive migration 0003 applied |
| Worker deployment | `05440402-ba03-4488-9ed2-f8d66088091a` |

Tests cover DST gaps/folds, half-hour and quarter-hour offsets, local dates,
prepared-post migration, notification-window migration, sends before their due
time, approval/Undo guards, partial push failures, duplicate sends, account
isolation, retained short drafts, first-run samples, provider repair outages,
expired preparation messages and small-screen layouts. Existing login recovery,
navigation, popup expiry, editing and setup tests also pass.

Live verification used the dedicated ByLine Worker and D1 account only. Synthetic
authors had no LinkedIn grant or automatic publishing and were deleted after the
test. Publishing tests use mocked provider responses; no LinkedIn post was sent
for release verification. The APK was not installed on a user's phone.

Notification timestamps prove server/FCM acceptance, not display on a physical
phone. Android connectivity, notification permission and OS delivery can still
delay an alert. Cron and network operations are minute-level, not exact-second
timers. Provider outages, quota exhaustion or no relevant sources still produce
actionable failures; the app does not invent content to disguise those conditions.

The APK checksum and byte count are recorded in
[release.json](../releases/android/release.json) and
[SHA256SUMS](../releases/android/SHA256SUMS).

## Requested-draft recovery

After deployment, the author's original failed preparation was retried with the
current settings. It completed with **212 body words and 15 hashtags**, no remaining
style-review notes, and Home's occurrence reached `ready`. It remains an unscheduled
draft because the original posting time had already passed. Firebase accepted the
ready notification on its first attempt. Automatic publishing stayed off; no
LinkedIn post was sent. No other author records or preferences were changed.
