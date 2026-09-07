# ByLine functional gap audit — 6 September 2026

This was a code and workflow audit of the Android and Windows app, its API contracts, stored post states, and background jobs. It was not a hands-on acceptance test. No test suites, AI generations, test notifications, or LinkedIn publications were run during this audit. No account, draft, published post, credentials, or user preferences were reset.

## Changes made

| Area | Gap found | Change |
|---|---|---|
| Write → rewrite | Editing a saved draft then rewriting sent the old database text to the writer. | Rewriting always uses the current composer text. |
| Rewrite → voice | A result could be labelled as matching settings changed after generation started. | The suggestion retains the voice fingerprint from its request. |
| Rewrite → hashtags | Old tags survived rewrites and the suggestion hid the new tags. | The previous fix is retained: preview and accept the rewritten text and tags together. |
| Voice → existing posts | Lowering the voice hashtag count silently trimmed already reviewed posts during save/publication. | Generation uses the selected count; explicitly reviewed existing tags are preserved, within the overall 15-tag limit. |
| Zero hashtags | Changing the voice to zero hid existing tags and their removal controls. | Existing tags stay visible and removable until a rewrite or the author removes them. |
| Final preview | A source link was appended only during publishing. | Text-only source-backed posts now show that link in the final preview; edit length validation includes it. |
| Polish | AI could alter text after the final preview. | Polish produces a suggestion before save/publish. The API also rejects an unreviewed combined polish-and-publish request. |
| Failed publication | A saved draft could lose its identity when a subsequent send failed, making retry create another post. | Save and send are separate steps. The composer retains the saved post identity after failure. |
| Interrupted save | Retrying after losing the server response could create a duplicate draft. | The composer supplies a stable request ID. An additive unique database index reuses the earlier save; conflicting newer content is reported for review. |
| Images | A failed later upload or save discarded knowledge of earlier successful uploads. | Successful uploads remain attached across retries; closing during image selection is handled. |
| Composer navigation | Closing an edited post left it selected when starting a new post. | Closing the composer clears its editing target. |
| Save controls | Repeated taps could open multiple final confirmation sheets. | Save is busy while the final preview is open. |
| Approve / Send now | Reviewed-state validation rejected approved or failed posts even when their contents were unchanged. | Eligible draft, approved, failed and missed posts can be reviewed and retried. Unknown and published states remain protected. |
| My Posts | Only the nearest approved scheduled post was visible. | Other approved scheduled posts remain in the list. |
| Badge | Scheduled drafts could cause unscheduled drafts to be omitted from the count. | The badge counts all pending draft decisions. |
| Status labels | Retained clearance could hide a failed or unconfirmed result behind a green “cleared” label. | Actual failed, missed and unknown states take precedence. “Approved” alone no longer claims a publishing failure. |
| Rescheduling | Past times were accepted; moving a missed post retained a non-runnable status. | A new time must be in the future and returns the post to a draft requiring clearance. Removing a missed/approved schedule returns it to Drafts. |
| Unconfirmed publication | Recovery directed the user to the old web dashboard. | My Posts includes confirmation controls after the user checks LinkedIn. A confirmed non-publication returns an unscheduled draft and does not automatically resend. Resolution is transactional and limited to unknown posts. |
| Background send | A scheduler pass could act on a previously selected post after its schedule or hold changed. | The publish path re-reads eligibility; marking a missed post also checks its current schedule, hold and status. See concurrency limitation below. |
| Voice preview | Hardcoded music tags were displayed for every industry. | The preview uses the writer's returned tags. |
| Settings in flight | A late preview or save response could replace newer voice edits. | Stale previews are discarded; edits made during a save remain staged. |
| Unsaved settings | Back navigation silently lost staged voice, interests and delivery edits. | These pages now ask before discarding unsaved changes. |
| Writing samples | The UI permitted samples beyond the backend's limits, then silently dropped/truncated them. | The editor and API enforce 10 samples, each 80–2400 characters. |
| Timezone | The general settings endpoint stored an invalid timezone before later scheduling failed. | It validates the timezone before updating settings. |
| Optional slots | A native user could add an advanced slot but could not remove the final one. | Users with completed daily-delivery setup can remove all optional advanced slots. |
| Refresh / session | Old refresh responses could overwrite newer state or repopulate state after sign-out. | Refresh revisions reject stale responses; sign-out and expired sessions clear review/composer state and stop notification listeners. |
| Mutation errors | A failed send left the screen showing the pre-send draft state. | Error handling refreshes the saved status before showing the failure. |
| Network failures | Malformed JSON escaped normal error handling; logout and streamed upload reads could wait indefinitely. | These paths now return structured errors or use timeouts. |
| Notification startup | Setup could load before account status, causing registration to be skipped for the whole launch. | The signed-in shell waits for notification preferences and reacts when they arrive or change. |
| Notification test | Any registered device receiving the message made the current device's test look successful. | Android tests target the current registered device token. Windows alerts exclude already-cleared drafts. |
| Archive | Published history stopped at the most recent 20 posts. | Load older posts is available with an authenticated cursor endpoint. Passed-over source articles are clickable. |

## Areas traced without changing their core behavior

- Sign-in, native callback polling, the Windows loopback return, LinkedIn connection and disconnect behavior, and session ownership.
- Onboarding topics, presets, samples, revision-checked generation, sample acceptance, completion, and notification permission. Repeated completion taps are now blocked during permission handling.
- Daily preparation, same-day reuse, source discovery, scoring, writer output, generation leases, retry limits, delivery timing and the notification outbox.
- Scheduled generation, approval versus immediate publication, send claims, definite versus ambiguous failures, pause controls and daily caps.
- Account-owned media, source links, post serialization, mobile/desktop navigation and archives.
- Local launcher and the existing zero-budget billing guard. No billing, provider, deployment or credential configuration was changed.

## Remaining limitations and release work

1. **Acceptance testing remains with you.** Compilation establishes that the code builds; it does not establish that every interaction or platform notification works. Windows/browser return, Android permissions/background delivery, concurrent device edits, image uploads and actual publishing need your device verification.
2. **Concurrency is not fully serialized.** Duplicate send claims are protected and eligibility is rechecked, but post edits/cancellation and claiming a scheduled send are not yet one shared atomic operation. A very narrow edit-versus-send race still requires a dedicated concurrency change and verification before a multi-client production launch.
3. **An interrupted save is deduplicated while its composer remains open.** The new request ID is not a persistent offline draft store across app termination. Check My Posts after a crash before re-creating a post.
4. **Recovery covers recorded unknown results.** A worker that crashes leaving an aged `in_flight` ledger row without changing the post to `unknown` still needs operator recovery; the current app exposes the recorded unknown state.
5. **Google configuration and provider linking remain release work.** Google sign-in exists in code but is not configured in this installation. Google and LinkedIn identities are currently separate accounts; changing sign-in provider does not merge accounts.
6. **Localhost remains the backend.** The computer and server must remain running. Android USB testing still needs ADB reverse after reconnection. Windows notifications require ByLine to remain open or minimized. This audit does not deploy an always-on service.
7. **Some asynchronous failures still need better durable feedback.** An advanced “write one now” cycle can finish without a draft, and exhausted daily preparation retries do not yet have a dedicated user-facing result history. The source rejection history remains a recent window.
8. **Existing image review is limited.** Saved attachments are represented mainly by attachment counts, not a full persistent thumbnail gallery. Upload/retry handling was improved; an image browsing service was not added.

## Suggested acceptance sequence

- Edit a saved draft, rewrite, and verify the edited text is used. Change 7 tags → 2 → 0 and inspect suggestion, composer, saved draft and final preview.
- Enable polish and confirm it shows a suggestion before anything is saved or sent.
- Cancel editing a post, then choose Start a post; it should open a new composer.
- Prepare several scheduled drafts; clear them, change/remove a time, and confirm every post remains visible in the correct state.
- Check a known failed send can be retried. For an actual unknown result, check LinkedIn before using the new confirmation controls.
- Change voice, interests and delivery settings, then press Back without saving. Also try changing voice while a preview is in progress.
- Try a failed upload/save and confirm successful attachments remain. After reconnecting, check My Posts before re-creating work.
- Send a notification test on this phone and check the notification shade. Check Windows while open/minimized and complete browser sign-in.
- With sufficient history, load older published posts and open a passed-over source link.

## Build record

Backend TypeScript compilation, the Android debug APK build, and the Windows release build succeeded. The final Android APK was installed on the connected phone with data preserved and port 3000 forwarded. The latest Windows ZIP replaced ByLine-Windows.zip in Downloads; extract that ZIP to use the new desktop build. Neither app was opened. No test suites or live workflow tests were run.

The new draft request-ID column and unique index are additive schema changes. The existing local schema mechanism applies them when the backend next accesses the database; no manual account onboarding or database reset is needed.
