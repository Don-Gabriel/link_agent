# Unified timetable

- One timetable, maximum five recurring times. Onboarding creates its first
  entry at the selected time, every day, waiting for the user to schedule or
  publish. Existing timetable entries are preserved; the old independent daily
  time is migrated only when there are no entries. A one-time marker prevents
  deleted timetables being recreated.
- Home lists every enabled occurrence for today's local calendar, with a draft
  or progress/prepare state for each time. Past and future draft actions remain
  available in My posts. Preparing a slot early cannot publish it.
- Use the same slot generation path for manual preparation and scheduled work.
  Retain per-slot deduplication, quality filtering, progress, bounded retries,
  review windows, and explicit automatic publishing opt-in.
- Publish now means immediate publishing; Schedule for [time] means authorize
  publishing later. Skip and Edit retain their meanings. Internal API action
  names remain compatible with older builds.
- Add confirmed account deletion scoped to the authenticated user, with active
  work protection. Delete operational data and stored connection credentials;
  clarify that published LinkedIn posts and operator backups are separate.
- Compile Windows/Android and deliver ZIP/APK without opening the apps or running
  acceptance tests, per the user's standing preference.

## Implemented

The scheduler now drives native users through timetable slots only. The legacy
daily-delivery endpoint redirects schedule edits to Timetable. Notifications
remain accessible in Me. Home uses an authenticated per-day timetable response,
shows every enabled occurrence with its draft/progress, and prepares missing
occurrences sequentially. Manually preparing a past time creates an unscheduled
draft, so it cannot publish late automatically.

The number selector changes actual slots (1–5), preserving existing first entries
and adding suggested editable times. Decreasing it removes the last recurring
entries; saved drafts and individually scheduled posts remain. The separate auto
send ceiling is retained under Advanced publishing limits, explicitly labelled
as a limit rather than a draft count. Day masks and disabled entries still apply.

Onboarding creates one daily timetable entry at the chosen time. Migration keeps
existing slots if present; otherwise creates one from the saved daily time. It
links old daily posts to the first slot without changing publish permissions.
The migrated marker prevents recreating slots after intentional removal. Database
uniqueness on agent/slot/date plus slot and agent locks protect against duplicate
drafts across retries and overlapping workers.

The new account-delete page requires typing DELETE. Its server transaction removes
the user's active operational records, provider credentials, device registrations,
AI usage records, agents and sessions. It refuses deletion during active generation
or unresolved publishing; rollback removes nothing on failure. It does not delete
LinkedIn posts, LinkedIn-hosted images, externally retained provider data or operator
backup archives. Users can also revoke the app via LinkedIn Settings & Privacy →
Data privacy → Permitted services. Official guidance:
https://www.linkedin.com/help/linkedin/answer/a522690/log-in-with-linkedin-credentials

No account deletion, post generation, notification or publishing was triggered for
verification. No test suite or app UI was opened. Compiler/build checks are recorded
in the final delivery response; runtime acceptance remains the user's responsibility.
