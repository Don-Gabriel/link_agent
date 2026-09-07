# ByLine: product readiness and client onboarding report

Audit date: 6 September 2026. Repository snapshot: `42cd070`.

## 1. Recommendation

Build ByLine as native mobile and desktop applications backed by a hosted service, with no client web dashboard. The latest product preference supersedes the earlier optional-dashboard proposal. ByLine owns the AI, database, LinkedIn developer application, notification service, hosting, and scheduler. Each client owns their ByLine account, grants access to their personal LinkedIn profile, chooses topics and voice, and approves posts.

**Clients do not need Gemini keys, a LinkedIn company Page, their own LinkedIn developer application, a database account, Firebase access, or a server address.** The technical setup you performed was a combination of operating the service and using it. The product needs to separate those responsibilities.

Keep the current Next.js backend, Flutter client, PostgreSQL data, and editorial engine. Add account ownership, reliable provisioning, a resumable onboarding flow, and the simpler daily approval experience. Preserve the existing advanced features behind Settings and secondary actions.

This is more than replacing the login screen. The present application deliberately assumes one operator and one primary agent. Social login without changing that assumption would expose the same agent and content to everyone.

The highest-priority deliverable is: **a new client can install ByLine, sign in, connect LinkedIn, see a relevant sample, finish setup, and receive their first approval request without the operator editing a database or opening a provider console for that client.**

## 2. Scope and evidence

Reviewed the setup and deployment documents, environment-variable template, Next.js routes and middleware, PostgreSQL schema and access layer, LinkedIn API integration, generation and memory pipeline, scheduler and publishing logic, Flutter authentication/state/transport, all product screens, push integration, Android packaging, CI, backups, watchdog, and test scripts. The local development/cache folders are tooling state, not services clients should install.

Validation performed:

| Check | Result | What it establishes |
|---|---|---|
| Backend logic suite, `npm test` | Passed | Existing formatting, style, scoring, and scheduling assertions pass. |
| Production verification build, `npm run build:check` | Passed | Backend and web application compile and pass build-time type checks. Built into `.next-verify`, preserving the development build. |
| `flutter analyze lib test` | Passed, no issues | Static analysis of the mobile implementation and tests. |
| `flutter test --no-pub` | 104 tests passed | Existing mobile widget and transport behavior. |
| PostgreSQL integration suite | 91 checks passed | Existing database checks run against a newly created disposable local PostgreSQL 18 database. The live database was not used. |
| Feed reachability | 27 of 28 configured feed entries returned items | `arxiv-cs.AR` timed out in this run. This is a single observation, not proof of permanent failure. |
| Additional scheduling probes | Two problematic behaviors reproduced | Rescheduling before the posting time selects the same occurrence; a New York spring-DST example returns 10 AM for a requested 9 AM. |

No application code or provider configuration was changed. No LinkedIn post or notification was sent. The disposable database server was stopped after testing.

This is a source-and-local-validation audit. It does not certify your deployed provider permissions, billing/quota settings, production cron, backup execution, physical-phone push delivery, or store readiness. Those need the release checks below. The repo cannot establish exactly which database edits you made during earlier testing.

Local verification logs are in `reports/audit-*.log` and are ignored by the existing log rule. Passing current tests does not cover the missing new-user journey or the additional issues identified here.

## 3. The current workflow, end to end

### Service installation and operation

1. Create or associate a LinkedIn company Page with a developer application; verify the association where required. Configure the identity and sharing products, credentials, and exact OAuth callback URL.
2. Create a PostgreSQL database, currently documented as Neon, and supply `DATABASE_URL`.
3. Create a Gemini project/API key, select a primary model and fallbacks, and configure quota assumptions.
4. Generate token-encryption, session-signing, and cron secrets. Set the shared application password.
5. Run the Next.js server locally or deploy it. Configure environment variables on the host and a production callback on LinkedIn.
6. Configure an external cron to call `/api/cron/tick`. `vercel.json` sets function durations and region; it does not itself register that recurring tick.
7. Configure Firebase for the Android package and provide backend FCM service-account credentials for push delivery.
8. Configure the GitHub watchdog and encrypted database-backup workflows with their required repository secrets.
9. Build/install the Flutter application, currently configured for personal installation and debug-key signing even for release builds.

These are ByLine operator tasks in the final product. They are performed per environment and maintained centrally, not repeated per customer.

### First use today

1. The web dashboard authenticates using `APP_PASSWORD`.
2. Web setup asks for a name, category selection, timezone, and time, defaulting to 09:30.
3. `/api/init` inserts an agent and scheduler state. Background work expands the persona and immediately attempts a first draft.
4. Reading status can create the first recurring slot through a legacy migration helper.
5. LinkedIn is connected separately. The callback stores the encrypted token and redirects to the web dashboard.
6. Mobile asks for a server address and the same password. It does not have the complete first-user setup journey.
7. Notification permission is requested after sign-in. Voice samples, presets, and other controls are configured later in Settings.

The app therefore considers an agent “initialized” before a client has confirmed voice, liked a sample, configured reliable notification delivery, or completed a coherent onboarding process.

Evidence: [web setup](C:/WorkSpace/Private/LinkdIn/app/page.tsx:236), [initialization](C:/WorkSpace/Private/LinkdIn/app/api/init/route.ts), [mobile gate](C:/WorkSpace/Private/LinkdIn/mobile/lib/screens/gate_screen.dart), [mobile root](C:/WorkSpace/Private/LinkdIn/mobile/lib/main.dart).

### Daily operation today

The cron sends eligible scheduled posts and runs due generation slots. Discovery reads category-specific RSS/Atom feeds and Hacker News, deduplicates prior coverage, and sends candidates to a batched judge. A candidate must clear 6.5. The writer uses persona, voice samples, stored history, and editorial memory; formatting and bounded repair follow. A draft is saved and a push notification is attempted.

On mobile, the Desk shows deadlines, drafts, failures, and today's timeline. A scheduled draft can be cleared for its time, edited, sent immediately, rescheduled, or discarded. Custom composition, images, rewrites, and follow-ups use the same publishing engine. The Archive shows recent published posts and stories the judge passed over. Settings contains voice, topics, timetable, LinkedIn connection, and diagnostics.

Publishing uses a database claim to prevent the same stored post from being sent twice. Ambiguous responses retain that claim and require checking LinkedIn. Retain this distinction; automatic retry after an uncertain send can duplicate a public post.

## 4. What happens to the keys and provider setup

| Current requirement | Final owner | What the client experiences |
|---|---|---|
| Gemini project, API key, model selection and fallbacks | ByLine | Included generation; no key entry. |
| AI billing and provider quotas | ByLine | A usable service with fair-use limits expressed in product terms if needed. |
| LinkedIn Page associated with the developer app | ByLine | ByLine's name/logo on the consent screen. |
| LinkedIn developer application, products and client secret | ByLine | Tap Connect LinkedIn and grant personal-profile posting access. |
| LinkedIn OAuth callback URLs | ByLine | Browser consent returns to the correct mobile onboarding step. |
| Per-member LinkedIn token | Stored securely by ByLine after client consent | Connected as their name; reconnect when necessary. |
| PostgreSQL/Neon provisioning and schema migrations | ByLine | Their account and preferences appear automatically. |
| `APP_PASSWORD` | Replaced | Google/LinkedIn authentication and individual sessions. |
| Token-encryption and service secrets | ByLine | No exposure or user configuration. |
| Hosting, domain, TLS and backend URL | ByLine | One installable application with its backend configured. |
| Cron, queues, retries and watchdog | ByLine | Draft ready around the chosen local time. |
| Firebase project and FCM server credentials | ByLine | One contextual notification permission request. |
| Backups, restoration and retention | ByLine | Account recovery and durable history. |
| Breeth graph memory | ByLine, optional | Editorial continuity, with PostgreSQL fallback. |
| Sources, threshold and service safety caps | ByLine defaults | Industry/topics; optional advanced controls where useful. |

The existing server-side Gemini adapter already keeps the API key off the client. Keep that architecture. The missing part is service ownership, billing, account isolation and usage management—not inventing a way for every customer to obtain keys. Google's documentation recommends keeping production keys on the server. Gemini quotas are project-scoped, so generating more keys in the same project does not provide independent customer quotas. [Gemini key guidance](https://ai.google.dev/gemini-api/docs/api-key), [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

Use a ByLine-owned billing-enabled AI project for customer workloads. Google's paid-service terms distinguish the handling of prompts/responses from unpaid-service usage. Budget for customer drafts and voice samples accordingly and document the processing clearly. [Gemini terms](https://ai.google.dev/gemini-api/terms).

The Page you created establishes the developer application's publisher. It is not a requirement that every person who uses that application create a company. The current code posts as a personal member, not as a company Page. LinkedIn's sharing product authorizes posting on behalf of each consenting member. [App/Page association](https://www.linkedin.com/help/linkedin/answer/a553297), [app creation](https://www.linkedin.com/help/linkedin/answer/a1667239), [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin).

Verify actual enabled products and granted scopes on ByLine's production app before launch. Documentation describes self-service access; it does not establish the state of your particular app or guarantee an approval turnaround.

## 5. The client setup to build

Target under five minutes for the normal path using a preset, an existing provider session, and one sample. Treat this as a measured product goal, not a guarantee for someone retrieving old posts, recovering a provider password, or repeatedly regenerating.

| Step | Client interface | Backend work |
|---|---|---|
| 1. Welcome | ByLine; Continue with Google / Continue with LinkedIn | Authenticate; create or retrieve a user; resume saved onboarding progress. |
| 2. LinkedIn | Connect; consent; green tick and Connected as Name | Bind a one-time OAuth transaction to the correct user/device; exchange code server-side; validate identity and posting grant; store connection; return to mobile. |
| 3. Topics | Short industry list and 3–5 suggested, editable chips | Store industry/topics; map them to curated sources and editorial scope. No RSS URL field. |
| 4. Voice | Paste 2–3 posts or choose Professional / Conversational / Storyteller / Punchy | Store examples or a preset; derive tone from supplied evidence; keep voice separate from factual biography and opinions. |
| 5. Sample | Real topic-relevant sample with its source, Regenerate, Edit voice, I like this | Generate a preview using the same writing/formatting pipeline as daily drafts; save the accepted preview and its voice/topics version. Do not publish it. |
| 6. Time | Default 9 AM in detected timezone; one time control; Advanced | Save review-delivery preference and next local occurrence. Advanced opens existing slot/day/review-window controls. |
| 7. Notifications | Explain the morning approval request, then request permission | Register device, persist permission/registration status, activate the completed setup. |
| Done | First draft ready tomorrow at the selected time | Return the actual saved first-delivery date/time and activation state. |

For LinkedIn sign-in, reuse a successfully granted posting connection where the selected authentication integration allows it. Identity sign-in alone is not proof of publishing permission. Google sign-in still requires the LinkedIn connection step. Link additional login providers only after proving ownership; do not merge accounts based on matching names or unverified email addresses.

For the daily simple mode, interpret 9 AM as **delivery for approval**. Prepare content beforehand, make it available at the selected time, and publish when Approve is tapped. A noon approval must still work. Preserve publication-at-a-fixed-time as the existing advanced scheduling mode.

The OS can delay or suppress push notifications. Keep the draft accessible in the app independently. If notifications are denied, finish setup with accurate wording such as “Your first draft will be ready tomorrow at 9 AM. Open ByLine to review it.” Provide an Enable notifications option later. [Firebase permission and delivery behavior](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages).

### Resumable setup and reliable provisioning

Persist explicit progress: signed in, LinkedIn connected, topics saved, voice saved, preview accepted, schedule saved, notification preference saved, active.

Create the user/profile in a database transaction. Keep the agent inactive for recurring generation until onboarding completes. Background work must use persisted jobs with retryable status; a mobile spinner or one serverless callback is not the record of truth.

Completion must be idempotent: tapping Done twice, retrying after a timeout, reopening the app, or signing in on a second device must not create another agent or another morning job. Version topics and voice; changing either invalidates an old accepted sample and requests a fresh preview before completion.

There should be no customer-specific SQL insert, manual slot repair, hardcoded account identifier, operator password, or provider-console toggle in this journey.

## 6. Existing features: preserve them explicitly

| Existing capability | Final location/behavior |
|---|---|
| Discovery across all current music/technology categories | Retain all categories and sources; add broader industries without removing existing coverage. |
| 6.5 judging, individual scores and rejection reasoning | Keep engine and records; show reasoning under details/Archive, not onboarding. |
| Deduplication, rejection cooldown and category diversity | Keep behind the scenes. |
| Daily draft queue | Today's post first; additional drafts remain available. |
| Edit and immediate publishing | Keep in the daily loop; Approve performs one deliberate publish action in simple mode. |
| Clear/unclear for scheduled time | Keep in advanced scheduling with its current meaning. |
| Up to five recurring slots, weekdays, timezone, lead time and slot-specific categories | Keep in Settings → Advanced schedule. |
| Per-slot auto-publish plus master switch | Keep as explicit advanced opt-in, off for new clients. |
| Pause/resume and individual slot enable/disable | Keep easy to find in Settings. |
| Custom composer, save draft and custom scheduling | Keep the Write action; no onboarding requirement. |
| Image posts and multiple images | Retain current supported image types, resizing and upload path; improve ownership validation and preview. |
| AI polish and alternative rewrites | Keep in composer; preview alternatives before replacing text. |
| Follow-up from a published post | Keep in Archive and post actions. |
| Writing samples and learning from edits | Keep and repair the learning progress issue described below. |
| Existing Practitioner/Builder/Operator/Explainer presets | Retain as additional advanced presets; add the four simpler onboarding choices. |
| Structure, emoji, hook, closing, register, length and hashtags | Keep in Advanced voice. |
| Signature lines, banned phrases and custom rules | Keep, including existing users' saved preferences. New default presets should not inherit Marvel quotations. |
| Fold preview, word/character counts and assembled post preview | Retain; align the approval preview with the exact final text. |
| Archive, passed-over stories and editorial continuity | Keep; add pagination and direct source/published-post links. |
| Optional Breeth graph memory and PostgreSQL fallback | Keep as an operator-managed enhancement. |
| Duplicate-send protection and ambiguous-send resolution | Keep; bring resolution into mobile. |
| Push, reconnection reminders, feed health, watchdog and backups | Keep infrastructure; route operational incidents to ByLine, actionable account issues to the client. |
| Web dashboard capabilities | Move all useful capabilities into the native desktop/mobile applications. The final product has no client web dashboard; retire the old UI only after feature parity is verified. |

**One post/day should be the new-account default, not an irreversible removal of the existing multi-slot and custom-post features.** Recommended interpretation: simple mode generates one approval request per local day; advanced users can choose additional slots within service limits; manual composition remains available. If the intended rule is instead one total published post across every mode, that conflicts with retaining the existing publishing flexibility and needs an explicit product decision.

Existing accounts should retain their current schedules, voice, samples, history, signatures and advanced choices. Apply new defaults only to newly onboarded clients.

## 7. Concrete gaps and defects to address

### A. Required before onboarding a second client

**A1. There is no real user-account ownership model.**

The session contains an expiry/signature, not a user identity. `getPrimaryAgent()` chooses the oldest active agent globally. Most interactive routes and the watchdog use it. `persona_hash` is globally unique, so identical persona inputs can retrieve the same agent. Most content tables have `agent_id`, which is a useful foundation, but there is no authenticated owner relationship.

Add users, provider identities, sessions and agent ownership. Resolve the current agent from the authenticated user on every interactive request. Enforce ownership through queries and constraints, including secondary references. Separate operator endpoints from client endpoints. Change the watchdog to check each eligible account instead of only the first one.

Evidence: [auth](C:/WorkSpace/Private/LinkdIn/lib/auth.ts), [agent selection](C:/WorkSpace/Private/LinkdIn/lib/agents.ts:249), [schema](C:/WorkSpace/Private/LinkdIn/lib/schema.ts), [watchdog](C:/WorkSpace/Private/LinkdIn/app/api/watchdog/route.ts).

**A2. Mobile OAuth depends on a separate browser session.**

Flutter obtains the consent URL using its stored cookie, then opens the system browser. Middleware still requires a valid dashboard cookie on the OAuth callback. The browser does not inherit Flutter's cookie. A fresh browser can therefore redirect to a session-expired dashboard even after the member grants LinkedIn access. The successful callback also returns to `/`, not mobile; the app tells users to come back and pull to refresh.

Use a user-bound, expiring, one-time authorization transaction and a secure mobile return/handoff. Keep provider tokens on the backend. Add verified mobile links and automatic status refresh. Do not fix this by simply removing callback authentication/state validation or putting a long-lived session token in a URL.

Evidence: [middleware](C:/WorkSpace/Private/LinkdIn/middleware.ts:28), [connect](C:/WorkSpace/Private/LinkdIn/app/api/linkedin/connect/route.ts), [callback](C:/WorkSpace/Private/LinkdIn/app/api/linkedin/callback/route.ts), [mobile connection screen](C:/WorkSpace/Private/LinkdIn/mobile/lib/screens/settings_screen.dart:324).

**A3. Initialization is incomplete and not a resumable provisioning process.**

Agent insertion, scheduler insertion, persona expansion and first generation are separate operations. A duplicate `/api/init` request only starts expansion when `created` is true. If the initial background expansion never finishes, ordinary retries can leave an existing agent without an identity. Merely reading status can create a slot, and concurrent first reads have no unique one-default-slot guard.

Build transactional provisioning, persistent onboarding/job state, a repairable persona job, and an idempotent completion operation. Create the default schedule during completion, not as a side effect of reading the dashboard.

Evidence: [initialization](C:/WorkSpace/Private/LinkdIn/app/api/init/route.ts), [ensureAgent](C:/WorkSpace/Private/LinkdIn/lib/agents.ts:61), [slot migration](C:/WorkSpace/Private/LinkdIn/lib/slots.ts:326).

**A4. Secondary data access needs ownership checks too.**

`loadImages()` loads media IDs without `agent_id`. Post creation/edit accepts media IDs without checking ownership at that boundary. Device removal deletes by token alone. These become cross-account problems once real accounts are introduced.

Bind media, device, OAuth and memory operations to the authenticated owner. A guessed or copied ID must never attach another user's asset or alter their device. Add two-user integration tests before exposing signup.

Evidence: [media loading](C:/WorkSpace/Private/LinkdIn/lib/distribute.ts:117), [post creation](C:/WorkSpace/Private/LinkdIn/app/api/posts/route.ts), [device endpoint](C:/WorkSpace/Private/LinkdIn/app/api/devices/route.ts).

### B. Required for the promised first and second morning

**B1. Completed generation can leave a slot stuck on the same occurrence.**

`rescheduleSlot()` calculates the next occurrence from the current time. Generation normally finishes before the posting time, so a run completed at 08:45 for 09:00 calculates 09:00 on the same day. Once that run is terminal, the next `claimSlotRun()` fails and `runSlotCycle()` returns before reaching its rescheduling `finally`. The slot can retain the old date and repeatedly return `already_ran_today` rather than advancing.

The same-occurrence calculation was reproduced locally. The stalled lifecycle follows from the claim/early-return path; it was not exercised against the deployed scheduler. Advance completed occurrences relative to the occurrence that was processed. Keep transient retry eligibility separate, and recover stale pending jobs after worker interruption.

Evidence: [rescheduling](C:/WorkSpace/Private/LinkdIn/lib/slots.ts:198), [claim/early return](C:/WorkSpace/Private/LinkdIn/lib/cycle.ts:503), [finally](C:/WorkSpace/Private/LinkdIn/lib/cycle.ts:551), [next occurrence](C:/WorkSpace/Private/LinkdIn/lib/schedule.ts:168).

**B2. Timezone calculations do not preserve local time across all DST transitions.**

The next-slot function advances by elapsed 24-hour periods. A Sunday-only 09:00 New York slot calculated from 7 March 2026 at 12:00 UTC returned 10:00 local on 8 March, when daylight saving begins. Use calendar-date/timezone conversion and explicit ambiguous/nonexistent-time handling; add spring/fall tests.

**B3. The legacy daily-time setting does not update the slot scheduler.**

`PATCH /api/settings` updates `post_time_local` and the old `scheduler_state`. Slot rescheduling happens for timezone changes, not for a changed daily time. After migration, the real scheduler reads `post_slots`. A dashboard time change can therefore report success without moving the actual posting time.

Choose one authoritative schedule model and adapt the native mobile and desktop time controls to it. Retain legacy data for migration, not as a second active setting. [Settings route](C:/WorkSpace/Private/LinkdIn/app/api/settings/route.ts).

**B4. A daily post is not guaranteed by the present content policy.**

No candidates or nothing above 6.5 means no draft. This is intentional behavior. Preserve the threshold; add a curated evergreen source fallback or use accurate quiet-day messaging. An onboarding sample should have a prepared source-backed fallback so a quiet news day does not make setup impossible. A fallback must not invent breaking news or the user's personal experiences.

**B5. Client approval time and publication time are currently different from the proposed flow.**

Existing slots represent publication times, with early generation and notification. Scheduled sending treats posts more than 45 minutes late as missed. A morning notification reviewed at lunchtime may therefore need a manual override today. Add simple review-delivery mode while retaining advanced fixed-publication schedules. Do not merely relabel the current slot time “morning notification.”

Evidence: [generation pipeline](C:/WorkSpace/Private/LinkdIn/lib/cycle.ts), [send pass](C:/WorkSpace/Private/LinkdIn/lib/distribute.ts).

### C. Required for a trustworthy daily interaction

**C1. Mobile does not render source links on draft cards.** The API and model carry `sources`, but the draft widget does not use them. Add a source title/domain/link and preserve it while editing. Show the same source evidence for preview and daily posts. The source line currently appended at publish time is not a substitute for a reviewable source link before approval.

**C2. Push does not identify the post.** `draft_ready` has a sequence in its event, but the transmitted data contains only kind and tab. Include a stable post reference; resolve it after authentication and open that exact draft. Handle already-approved, skipped, or unavailable posts.

**C3. Notification readiness is not persisted meaningfully.** Registration returns whether server FCM is configured, but the mobile caller ignores that result. Permission failure and token registration failure are only debug messages. Signing out does not unregister the device, and the token-refresh listener is not cancelled with the session. Add a device/session lifecycle, permission status, retry, logout cleanup and safe account switching.

**C4. Editing a cleared post does not clear its old approval.** The edit endpoint resets status to draft but leaves `cleared_at`; the scheduled send query accepts a draft with `cleared_at`. Associate approval with a specific content revision, invalidate it when content changes in approval-required mode, and coordinate edits/publishing atomically. The existing edit hold is time-limited and is not renewed while the composer stays open.

**C5. Daily actions currently require extra decisions.** Retain advanced Clear/Send now/Reschedule semantics, but provide Approve/Edit/Skip for the simple morning card. Skip should dismiss that day's suggestion with undo and remain visible in history. Currently discarded drafts become rejected posts, while the Archive's Passed-over shelf shows judge-rejected source stories; these are different records.

**C6. Ambiguous-send recovery still requires the dashboard.** The API already supports resolution; expose it on mobile. Keep the duplicate-send claim until the user confirms whether publication occurred. After a successful send, provide the saved LinkedIn permalink.

Evidence: [draft widget](C:/WorkSpace/Private/LinkdIn/mobile/lib/widgets/draft_card.dart), [push payload](C:/WorkSpace/Private/LinkdIn/lib/push.ts:376), [device lifecycle](C:/WorkSpace/Private/LinkdIn/mobile/lib/state/app_state.dart:162), [post actions](C:/WorkSpace/Private/LinkdIn/app/api/posts/[seq]/route.ts), [mobile commands](C:/WorkSpace/Private/LinkdIn/mobile/lib/screens/draft_commands.dart).

### D. Voice, content and retained-feature quality

**D1. The new-user default is still personalized to the original operator.** `DEFAULT_STYLE` includes a Marvel-film signature and practitioner framing. Keep these for existing users, but use neutral defaults for new ByLine accounts. Add the requested presets without deleting the existing four.

**D2. Persona generation invents opinions from a name and categories.** The persona prompt asks for opinions the person “actually” holds without receiving evidence of them. Build voice from examples/preset, and treat topic interests as preferences, not personal biography or beliefs. A Storyteller preset must not manufacture lived experience.

**D3. The current preview is not the proposed topic-based sample.** It rewrites the latest stored post or a fixed engineering anecdote and uses a fixed technology hashtag list. Generate from a relevant source using the current onboarding settings. Save preview acceptance separately from publication approval; do not let previews consume daily delivery slots or permanently suppress source stories through production deduplication.

**D4. Edit learning stops after its bounded sample reaches its tracking limit.** `refreshEditNotes()` reads at most 12 pairs and compares `pairs.length` with `edit_notes_from + 3`. Once the recorded count reaches 12, that condition cannot become true again. Track the newest processed edit or a cumulative count independently of the bounded analysis window. Also move the unawaited post-publication learning call into a durable background job.

**D5. Source summaries are short.** Discovery supplies titles and summaries clipped to 400 characters, rather than full article bodies. Ground claims in available evidence; for new industries, use a vetted source excerpt or reliable article extraction when necessary. Keep the source link and avoid filling missing facts with invented detail. Treat feed text as evidence, not instructions.

**D6. Archive and preview completeness need work.** Status only returns 20 published posts, 20 queued/problem posts and 15 recent judge rejections; no paginated history endpoint exists. Images are stored as LinkedIn URNs, not a complete retained client preview asset library. Add pagination and authenticated image previews as needed to make “retain history and image composition” work over time.

Evidence: [style defaults](C:/WorkSpace/Private/LinkdIn/lib/style.ts), [persona](C:/WorkSpace/Private/LinkdIn/lib/persona.ts), [preview](C:/WorkSpace/Private/LinkdIn/app/api/style/preview/route.ts), [learning](C:/WorkSpace/Private/LinkdIn/lib/voice.ts:209), [history limits](C:/WorkSpace/Private/LinkdIn/app/api/status/route.ts:143), [discovery](C:/WorkSpace/Private/LinkdIn/lib/discovery.ts).

### E. Operation with multiple customers

**E1. AI pacing is per process, not service-wide.** The promise chain in `lib/llm.ts` serializes one server instance. Multiple instances can still exceed shared project quotas. Counters track successful calls by model/day, not customer cost or reserved work. Add shared rate limiting, bounded regeneration, per-user usage accounting and a queue with separate priority for onboarding previews and scheduled generation.

**E2. One cron invocation attempts an unbounded serial batch.** `runDueSlots()` processes all due slots in sequence inside a function configured for 300 seconds. At even 30–60 seconds per generation, a group of customers selecting 9 AM can exceed that execution budget. Persist individual jobs, claim bounded batches, recover worker leases, and stagger generation while preserving delivery time.

**E3. The same account can have concurrent jobs.** Slot locks and manual-cycle locks use different keys; simultaneous slots can both allocate `MAX(seq)+1` or choose the same source. Custom composition uses the same sequence pattern outside those locks. Use atomic allocation and per-account coordination. Reserve daily publishing allowance atomically so simultaneous different posts cannot both pass a read-then-send cap check.

**E4. Notification delivery is best effort after draft persistence.** A process interruption between saving a post and sending push can leave a valid draft with no notification. Use a persisted notification outbox with deduplication and bounded retries. Do not wait for optional graph-memory writes before making the draft available or scheduling its delivery.

**E5. Operational issues are exposed to the customer.** Messages currently mention `LINKEDIN_API_VERSION`, cron and model quotas. Keep the diagnostics capability, but route service incidents to operator alerts and logs. A custom web dashboard is not required. Clients should see a plain status and actions they can perform, such as reconnecting LinkedIn.

**E6. Documentation and operational assumptions have drifted.** `.env.example` includes `DAILY_POST_CAP`, which the runtime does not consume; code uses `MANUAL_DAILY_CAP` and per-agent caps derived from slots. Documents disagree on cron cadence, and `/api/health` always reports HTTP success while embedding database errors. Refresh the operator runbook and add a real readiness check. Verify actual hosted endpoint quotas; do not treat one hardcoded LinkedIn request count as a universal budget for all endpoints. [LinkedIn rate-limit guidance](https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits).

## 8. LinkedIn and mobile platform boundaries

Personal-profile publishing is supported through the current scope set and API integration. Company-Page publishing, analytics, and reading arbitrary personal history are not current features and are not needed to retain the existing app.

Automatic past-post import cannot be a normal launch dependency. LinkedIn's member-social reading permission is closed to new access requests. Use pasted samples and posts created through ByLine. [LinkedIn member-read restriction](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview?view=li-lms-2025-07).

Normal access tokens expire, and refresh tokens are available only to eligible approved applications. The code already supports refresh when a grant includes it, but eligibility cannot be assumed. Preserve reconnection and revoked-access handling. Calculate usable/expired status from the actual expiry instant; the current UI floors remaining days and can call a token expired during its last valid day. [LinkedIn refresh tokens](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens).

The mobile project has Android and web target folders, but no iOS project. Android release configuration currently signs with debug keys. Before distribution, configure production signing, ByLine branding/icon, stable application identity, production backend, OAuth app links and release Firebase registration. Renaming the display label need not force an application-ID change; changing the ID would affect installs and provider registration.

An iPhone release requires an iOS target, signing, APNs/FCM configuration and real-device verification. Apple's social-login rule generally requires an equivalent privacy-preserving option, subject to listed exceptions; evaluate the final login design and add Sign in with Apple where applicable. This is a platform-specific release item, not a reason to complicate the Android onboarding. [Apple login rules](https://developer.apple.com/app-store/review/guidelines/#login-services).

Client account deletion, connection revocation, and session revocation are missing. Build these as product capabilities and document what is removed from active storage and how backups expire. Keep provider secrets in service configuration and use secure mobile credential storage rather than the current plain shared-preferences session cookie.

## 9. Recommended architecture and migration

```text
Native ByLine mobile app + native ByLine desktop app (shared Flutter code)
  → authenticated ByLine API
  → user-owned agent, onboarding progress and content in PostgreSQL
  → persistent generation, publishing, notification and learning jobs
  → ByLine-managed Gemini, LinkedIn, FCM and optional Breeth
```

Keep PostgreSQL as the product database. There is no need to move from Neon to another database solely to add social login. Choose a maintained authentication integration that supports the required providers and mobile sessions; Firebase core/messaging in this repository does not mean Firebase Authentication is already implemented.

Keep Next.js for the backend API if convenient; using it does not require shipping a web dashboard. Public HTTPS OAuth callbacks and small privacy/support pages can remain infrastructure. The native applications must return from browser consent into their own authenticated sessions. Scheduling and generation stay on the server so closing the desktop application or sleeping the laptop does not stop tomorrow's post.

The repository currently contains Android and web platform folders, with no Windows, macOS, Linux or iOS targets. Desktop support therefore requires actual platform setup, adaptive layouts, secure credential storage, OAuth return handling, notification integration, packaging and update testing. Flutter supports native desktop builds, but plugin support must be checked separately. Windows plus Android is the recommended initial pair given the existing Windows environment and Android implementation; it is a recommendation, not an assumption that other operating systems were excluded. [Flutter desktop support](https://docs.flutter.dev/platform-integration/desktop), [platform build environments](https://docs.flutter.dev/platform-integration).

Suggested additions are user/provider identity records, an explicit agent owner, onboarding progress and accepted-preview version, industry/topics and source mappings, review-delivery preferences, durable jobs/outbox, per-user usage and device/session records. Keep the existing post, slot, voice and distribution history. Use versioned deployment migrations instead of running the entire evolving DDL script on the first customer request in every new process.

For the existing personal account, run a tested owner-assignment migration that attaches the current agent and all related history to the verified owner. Do not infer ownership from persona name or silently attach the first agent to the first public signup. Preserve identifiers where possible so distribution claims and historical references stay valid.

Keep new-account defaults versioned. Existing users should not suddenly acquire a 9 AM delivery schedule, lose extra slots, lose a signature, or have auto-publish changed without a deliberate migration choice.

## 10. Implementation sequence

| Stage | Work | Completion evidence |
|---|---|---|
| 1. Hosted account foundation | ByLine-owned provider configuration; social auth; user ownership; API/media/device isolation; legacy-owner migration; secure native sessions and OAuth return | Two clients can sign in/connect independently, cannot access each other's records, and require no provider accounts beyond Google/LinkedIn. |
| 2. Complete native onboarding | Mobile-first shared Flutter flow plus desktop target/layout: resumable state, industry/topics, samples and four presets, real sample with acceptance, delivery time, contextual notifications, atomic activation | A clean installation on each launch platform finishes setup independently, without a web dashboard or database edits. |
| 3. First-week reliability and feature preservation | Fix recurrence/DST/time settings, job/outbox delivery, approval revisions, source links, one-tap daily actions, mobile recovery, retain advanced schedule/composer/voice/archive | Seven simulated local days plus real-device trials cover timely, late, edited, skipped, failed and reconnected cases. Existing-feature regression suite passes. |
| 4. Client release | Native mobile and desktop packaging/signing, platform notification checks, operator alerts/readiness, quotas and cost accounting, deletion/revocation, backup restore drill, onboarding funnel measurement | A small external beta completes setup and operates without operator intervention; failures are observable and recoverable on both native clients. |

Stages 1–3 are the immediate product work. Stage 4 makes the result supportable for clients. A broader redesign, analytics product or new content platform is not necessary for this goal.

Do not delete the old features while implementing the simple path. Use the retention table as a release checklist and test existing users separately from fresh accounts.

## 11. Acceptance criteria

### Fresh-client onboarding

- A client starts with no ByLine data, developer credentials or database access.
- Google and LinkedIn authentication each create the correct individual account; repeated sign-in retrieves it.
- A client does not create a LinkedIn Page, developer app, Gemini key or Firebase project.
- LinkedIn consent works with a fresh system browser that has never signed into the ByLine dashboard.
- Cancelled/expired consent returns to a retryable mobile step without losing topics or voice.
- Connected as Name appears only after the backend stores and verifies the connection and required grant.
- Closing/reopening the app resumes setup; duplicate requests do not create duplicate agents, previews or jobs.
- Every exposed industry has useful source coverage and realistic sample output.
- The accepted sample reflects current topics/voice, has a source and never publishes automatically.
- An AI failure preserves progress and offers retry; it never falsely records a generated sample as accepted.
- Notification permission is contextual; permission denial and registration failure have different, accurate states.
- Completion shows the actual saved first-delivery date, time and timezone.

### Daily use and retained features

- A notification opens the correct post; the source is accessible before approval.
- Approve requires one tap on the ordinary post screen and gives accurate pending/success/failure feedback.
- Late approval works in simple mode; fixed publication schedules retain their advanced behavior.
- Skip does not publish and can be undone; skipped suggestions remain distinguishable from rejected articles.
- Edits survive ordinary navigation; approval is bound to the reviewed content revision.
- Repeated taps, overlapping workers and reconnects cannot duplicate a stored post's publication.
- An ambiguous send is recoverable on mobile without blind retry.
- The second and subsequent mornings work; success, silence, failure and worker interruption all advance or retry correctly.
- DST, timezone changes, midnight setup, disabled days and multiple slots have explicit tests.
- Existing composer, images, hashtags, rewrites, follow-ups, voice samples, signatures, archive and auto-publish controls still work.
- Signing out/account switching prevents the previous user's draft notifications reaching the wrong session.
- Two simultaneous users cannot exhaust each other's entire allowance or see each other's content.

### Operator readiness

- Provider grants, current model availability, actual quotas and release callback URLs are checked in the production accounts.
- A failed provider or missing configuration produces an operator alert rather than customer instructions to edit environment variables.
- Queue age, failed jobs, notification attempts and first-delivery success are measurable independently of cron heartbeat.
- Backups are restored into an isolated database and verified; encrypted token/key recovery has a documented procedure.
- Customer onboarding never requires a production SQL edit.

Measure install-to-sign-in, connect completion, sample latency, sample acceptance/regeneration count, onboarding duration, activation failure, first-draft readiness, notification open and first approval. Measure timestamps and outcomes rather than collecting raw private post text for funnel analytics.

## 12. Decisions and limits

Recommended defaults are mobile-first onboarding available independently on desktop too, no client web dashboard, one daily approval delivery at 9 AM local, approval-required publishing, neutral new-account voice presets, optional pasted samples, hidden source assignment, and retained advanced features.

The remaining product choices are the quiet-day policy, whether the one-post cap applies only to simple automatic generation or to every publishing mode, and whether iOS is part of the first release. This report recommends a vetted evergreen fallback, a simple-mode default that preserves advanced capacity, and validating Android first because it is the native target already present.

Under-five-minute setup is achievable for the normal path. Automatic LinkedIn history import, exact-to-the-second push delivery, uninterrupted third-party access forever, and zero human intervention after an ambiguous send should not be promised.

The practical next milestone is a complete new-client journey backed by individual accounts and reliable provisioning, followed by a first-week reliability trial. The existing engine and advanced workflows can be retained throughout.

## 13. Zero-spend development, Gemini production, and native distribution

Updated for the desktop-and-mobile preference on 6 September 2026. The proposed software can be developed using free frameworks and local tooling, assuming existing hardware and development tools. A limited prototype can potentially run without incremental service spending. A dependable commercial product with unlimited use and public distribution across all platforms cannot be promised at zero cost. Free quotas, available regions, account eligibility and distribution channels constrain that claim.

### What can be free, and where charges arise

| Item | Practical cost boundary |
|---|---|
| Flutter client and backend development | No framework licence purchase is needed for the proposed work. Hardware, electricity, developer time and any existing paid tools are separate. Apple builds need a macOS build environment. |
| Local Windows/Android testing | Can use existing equipment and direct development installs without purchasing store membership. This does not establish a polished public distribution channel. |
| Gemini prototype | Selected models offer a free tier with limited capacity. Use public or synthetic test content that is appropriate for the applicable data terms. Free quotas do not establish the capacity for a particular number of clients. |
| Gemini production | Recommended: a ByLine-owned billing-enabled project with measured usage and application-enforced limits. Current paid onboarding may require at least US$5 prepaid credit; account-specific rollout can offer postpay. This is usage credit, not a fixed monthly subscription. |
| Hosting, database and job processing | Free tiers may fit a small pilot, subject to their terms and operational limits. The current stack still needs hosted API execution, persistence and recurring jobs. No zero-cost production capacity has been validated in this audit. |
| Vercel deployment | Hobby is restricted to personal/noncommercial use. It is not the free commercial hosting plan for ByLine. Keeping Vercel would require an appropriate plan; changing hosts is a separate compatibility/deployment task. |
| Push transport | Firebase Cloud Messaging itself is no-cost. Backend execution, media storage and other Firebase products have separate pricing. Desktop delivery requires platform-specific implementation; the current Android integration is not proof of Windows support. |
| Google Play release | US$25 one-time developer registration fee. Direct test installs avoid Play registration, but broad distribution must account for Android's verification rollout; the free limited-distribution account is limited to 20 explicitly authorized devices. |
| Apple App Store release | Apple Developer Program normally costs US$99 annually or local equivalent, with limited fee-waiver eligibility. A free developer account is not ordinary public App Store distribution. |

Sources: [Gemini billing](https://ai.google.dev/gemini-api/docs/billing), [Vercel Hobby restrictions](https://vercel.com/docs/plans/hobby), [Firebase pricing](https://firebase.google.com/pricing), [Play Console registration](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en), [Android developer verification](https://developer.android.com/developer-verification), [Apple enrollment](https://developer.apple.com/programs/enroll/).

### Keep Gemini; make ByLine responsible for it

The existing server-side adapter is the correct starting point. A customer signs into ByLine; the backend authorizes their account, checks their allowance, generates through ByLine's Gemini project, saves the result and notifies their devices. Neither the desktop binary nor the mobile package contains the Gemini key or LinkedIn client secret. Customers do not create Google AI projects, supply keys or manage model quotas. [Google's API-key guidance](https://ai.google.dev/gemini-api/docs/api-key).

For real client posts and voice samples, use billing-enabled Gemini with its paid-service data handling. Under the general unpaid terms, content can be used to improve Google products and may be reviewed by humans; the terms prohibit submitting sensitive, confidential or personal information to unpaid services. Regional exceptions affect data handling, and applications made available to EEA, Swiss or UK users must use paid services. Paid-service prompts and responses are not used to improve Google's products. This makes free-tier production a material limitation for ByLine's personalized drafts, not merely a speed tradeoff. [Gemini terms](https://ai.google.dev/gemini-api/terms).

Before enabling a paid client beta: validate the chosen production model and project quotas; add per-user input/output token accounting, service-wide rate limiting, bounded retries and regeneration limits; protect generation endpoints against abuse; persist work and notification retries; and implement a budget policy that rejects or queues work before exceeding the application's allowance. A provider budget alert alone is not an application spending cap. Prepay reduces exposure but Google's billing documentation notes reporting lag and possible overages.

Do not estimate costs as one model call per published post. The current engine performs scoring, drafting, checking and optional revisions; onboarding, skipped drafts and regenerations also consume AI capacity. Measure cost per completed onboarding and per active user-day, then calculate monthly cost from expected usage plus hosting, storage and distribution. The current successful-call counters are insufficient for a defensible monthly estimate.

### Recommended release path

1. Build and test the shared Windows/Android experience locally, preserving the current advanced features in native screens. Keep Apple platforms as additional targets if required.
2. Validate account isolation, native OAuth and the first seven mornings with a capped test group using appropriate test data. A strict zero-spend prototype must tolerate quota pauses and limited distribution; it is not a promise of commercial availability.
3. Measure actual Gemini consumption and backend load before choosing the smallest suitable paid configuration. Enable billing only as a deliberate owner action.
4. Release native clients with the managed backend and bounded user allowances. Retire the client web dashboard once desktop/mobile feature parity is confirmed.

The client experience can be free of technical setup while ByLine still incurs operating costs. Those costs can eventually be covered by subscriptions or another business model; requiring each customer to bring a Gemini key would undo the requested onboarding design.
