# ByLine: complete project handbook

## 1. What this project is

ByLine is a LinkedIn writing workspace. It finds source material matching an author's interests, evaluates the material, writes a draft using that author's preferences, and lets the author review, edit, schedule, publish or discard it. It also supports writing posts manually, attaching images and keeping an archive of published posts. Its core promise is assisted writing with a distinct publication decision, rather than indiscriminate automatic posting.

The repository is named link_agent. The root npm package is still named linkedin-creator. The Flutter package is still named linkdin_mobile and several classes retain LinkdIn in their names. These are historical internal names for the same ByLine project, not separate applications. The cloud Android application ID is com.linkdin.byline.

This handbook describes the source snapshot packaged with this document on 7 November 2026. The file catalogue records the included files and their purposes; the machine-readable inventory records their SHA-256 hashes. This condensed PDF retains the explanations and navigation indexes; full project-owned implementation, configuration, tests and historical notes are preserved separately in docs/generated-reference.md. Dependency lockfiles are represented by complete resolved package inventories; their original files remain in Git. Binary assets are identified with sizes and hashes, and one phone-width preview per screen is shown in the gallery, with the other screenshots retained in the repository. Private credentials, customer database rows, SDK installations, downloaded third-party implementation and build caches are deliberately outside the distributable source snapshot.

The implementation is the primary evidence. Older comments and reports are preserved as historical evidence and can describe earlier behavior. In particular, comments that say the mobile app only uses Next.js or only uses a cookie are obsolete for the cloud release. The current mobile transport supports native bearer sessions and the current release points to Cloudflare. Historical claims of successful phone tests are attributed to their dated reports; they are not presented as fresh tests of this release.

Inventory sha256 values describe the captured workstation bytes. Text files also have lf_sha256 values with CRLF normalized to LF, because Git can convert line endings between Windows and other platforms. Binary checksums, including the APK, are byte-exact across platforms.

## 2. Reading paths and basic vocabulary

A new phone user should read the installation chapter, the onboarding chapter and the daily-use chapter. A developer should then read the architecture, stack, lifecycle, API, persistence, configuration and verification chapters. An operator should also read deployment, recovery and release management. Search the PDF for an exact repository path, endpoint, table or function name to reach its catalogue entry, then open that path in the companion source reference.

An API is the server's request interface. The mobile app sends HTTPS requests and receives JSON. A backend is the service that owns account data and performs privileged work. A database persists records beyond a process restart. OAuth lets the user grant LinkedIn or Google access through the provider's own browser page. A bearer session identifies a signed-in ByLine user; it is distinct from the LinkedIn access token used by the server to publish. A migration is a versioned database structure change. A cron trigger is a recurring timer. A Workflow is durable server-side work whose completed steps can survive retries. An APK is the Android installation package, not a server or an iPhone application.

An agent is the author's server-side writing configuration and workspace. A slot is a recurring posting-time definition. A slot run is one occurrence of that definition on a particular local date. A draft is saved content that has not yet been successfully published. A distribution is the record of a publication attempt. An outbox is a persistent queue of work to deliver after a database change. An idempotency key identifies one intended operation so repeated submissions do not create additional effects. A revision records which version of settings a background job was prepared against.

## 3. The three runtime arrangements

### Cloud Android release

The downloadable APK connects to https://byline-api.byline-b79.workers.dev. Flutter renders the interface. Cloudflare Workers handles API requests. D1 stores data. Cron Triggers starts the maintenance Workflow every five minutes. Content Workflows discover, judge, write and save drafts. Gemini supplies language-model completions. Firebase Cloud Messaging delivers Android alerts. LinkedIn's official API provides identity and publishing. The computer used to build the APK can be shut down after installation; the phone still needs internet and the backend/provider services must be available.

The cloud runtime imports shared pure TypeScript modules from the root lib directory. Its database adapters, authentication, scheduler and HTTP router live in cloud/src. It does not run the Next.js app and does not use the original Neon database. cloud/wrangler.jsonc identifies the dedicated ByLine account, D1 binding and Workflow classes. Account and database identifiers are operational identifiers, not authentication secrets.

### Original web and PostgreSQL service

The root application uses Next.js App Router, React and PostgreSQL. app/page.tsx implements the operator dashboard; app/api contains HTTP handlers. lib contains the PostgreSQL adapters and shared business logic. Vercel configuration and GitHub workflows support the original hosted arrangement. Its native endpoints can also serve the Flutter app when that app is built with its origin. The older website and its data were not migrated into D1 merely by adding cloud/.

### Isolated local preview

The Windows scripts create a separate PostgreSQL instance under .byline-local and a Next.js server on localhost:3100. The preview APK uses com.linkdin.byline_preview, demonstration content and simulated publication. USB adb reverse maps the phone's port 3100 to the computer. This arrangement needs the computer/server and USB connection. Local fixture mode is not the downloadable cloud release and does not prove Gemini, LinkedIn or physical notification delivery.

## 4. Technology stack and where each technology is used

TypeScript is the language of the two backends, shared business rules and most backend tests. JavaScript ES modules implement setup, smoke-test and operational scripts. Dart is the Flutter application's language. SQL defines PostgreSQL and SQLite/D1 schemas and queries. Kotlin and Gradle Kotlin DSL configure and host Android. C++ and CMake provide the Windows Flutter runner. CSS styles the Next.js dashboard. JSON, JSONC, YAML and XML describe packages, deployments, workflows, manifests and platform resources. PowerShell coordinates Windows builds and local phone workflows. Python with ReportLab and pypdf generates and validates this handbook; it is documentation tooling, not an application runtime dependency.

Next.js 15 is the root HTTP and web-rendering framework. React 19 and react-dom render app/page.tsx and app/layout.tsx. The pg package supplies the PostgreSQL connection pool in lib/db.ts. @google/genai supplies the original server's Gemini SDK in lib/llm.ts. The cloud AI adapter instead uses fetch against the Gemini REST API, keeping the Worker runtime separate from the Node SDK. TypeScript, tsx and the @types packages support compilation and tests. The package manifests and resolved dependency appendix give the exact ranges and installed lockfile versions; a semver range in package.json is not the same as a resolved version.

Cloudflare Workers provides Request/Response/fetch and Web Crypto. D1 provides a SQLite-compatible database through the DB binding. Workflows bindings CONTENT and MAINTENANCE refer to ContentWorkflow and MaintenanceWorkflow. Wrangler builds, generates binding types, migrates and deploys the cloud service. Miniflare runs isolated Worker/D1 tests locally. The cloud package has no separate production npm dependencies: its code uses platform APIs and shared local modules. Wrangler and Miniflare are development tools.

Flutter supplies widgets, rendering, Material UI, platform channels and compilation to Android, Windows and the checked-in web scaffold. provider exposes AppState through ChangeNotifier. http sends JSON and multipart requests; http_parser supplies upload MIME types. flutter_secure_storage stores native bearer sessions and pending OAuth flow material. shared_preferences stores lightweight settings and legacy cookie information. image_picker selects images. url_launcher opens provider consent and external links in the system browser. firebase_core initializes Firebase and firebase_messaging receives Android FCM messages. flutter_timezone reads the device timezone. flutter_local_notifications_windows participates in desktop notification support; its presence does not establish full cloud push delivery on Windows. cupertino_icons supplies icon assets. flutter_test and flutter_lints support automated checks.

The bundled Barlow Condensed, IBM Plex Sans and IBM Plex Mono fonts define headings, prose and technical/status text. They ship with the client instead of depending on a font CDN. mobile/lib/theme.dart defines the color and typography system; app/globals.css provides the separate web style. The repository's existing UI images are design evidence, not generated screenshots of the current release.

Git records source history. GitHub stores the repository, downloadable APK and documentation. GitHub Actions checks the original backend and mobile client and contains legacy watchdog/backup schedules. Android SDK build tools inspect and verify the signed APK. Java 17 compatibility is configured for Android source and bytecode. The installed Flutter SDK supplies the actual Android compile, target and minimum SDK defaults; release.json records what the built APK declares.

## 5. Repository architecture and dependency direction

The high-level request path is: Flutter screen -> AppState -> ApiClient -> HTTPS route -> authenticated owner -> domain operation -> database/provider -> JSON view model -> AppState -> widgets. The cloud scheduler follows a separate server path and does not depend on the phone being awake.

cloud/src/index.ts is the cloud route dispatcher and scheduled entry point. It exposes health and native-auth callbacks before authentication, then resolves an Owner for protected requests. Most handlers receive that owner and scope database reads/writes to owner.agentId or owner.userId. cloud/src/models.ts translates stored fields into the same client-facing shapes used by the app.

The split into lib/discovery-core.ts, lib/judge-core.ts, lib/writer-core.ts, lib/persona-prompt.ts, lib/voice-prompt.ts, lib/setup-config.ts and lib/llm-contract.ts lets both backends share editorial behavior without importing PostgreSQL into the cloud runtime. Files such as lib/discovery.ts, lib/judge.ts and lib/writer.ts are original-backend adapters. Dependency injection through the Completion contract allows the cloud adapter to enforce its own AI quotas while reusing the writer.

The generated import index records where declared packages and local modules are used. It is a source-level dependency guide, not a whole-program call graph: runtime dispatch, platform registration and SQL relationships are also significant. The companion source reference in docs/generated-reference.md contains the exact implementation of each conditional branch.

## 6. Installing the included APK on an Android phone

1. Open the repository on the phone: https://github.com/Don-Gabriel/link_agent. If it is private, sign in to a GitHub account with access. Download access is not granted merely by sharing the URL.
2. Open releases/android/byline-latest.apk and use Download raw file. The stable direct download is https://github.com/Don-Gabriel/link_agent/raw/refs/heads/main/releases/android/byline-latest.apk. Download the APK itself, not the repository ZIP or the GitHub HTML page. The release manifest alongside it identifies version, package ID, file size and SHA-256.
3. Open the downloaded .apk using Downloads or Files. When Android asks, allow that browser or file manager to install unknown apps. Menu names vary by device; on recent Android versions this is a permission for the individual installing app.
4. Tap Install, then Open. Review Android's actual prompts; managed devices or regional verification requirements can impose additional restrictions. Do not assume every Android device permits sideloading. You can turn off that install-source permission again afterwards.
5. Open ByLine and choose an available social sign-in option. Finish consent in the system browser and return to the app. No Gemini API key, database password or server address is required for the prepared cloud APK.
6. Complete subject selection, optional voice customization, a generated sample and acceptance, then choose a posting time/timezone and notification preference. The cloud finish operation requires a current LinkedIn connection. If you sign in through Google, connect LinkedIn as part of setup before finishing.
7. Allow notifications if you want ready/failure alerts. Check Home and My posts to confirm your account loads. The first recurring delivery is scheduled for tomorrow in your selected timezone; a manual prepare action can be used when eligible.

An existing release signed with the same key can normally be updated in place. If Android reports a conflicting package/signature, do not uninstall blindly: an older debug/live build can have the same package ID but a different certificate. Preserve access to the account and confirm the old build's signing identity before planning a replacement. Uninstalling removes local app data. ByLine Preview has a separate package ID and can coexist with the release.

This APK cannot be installed on an iPhone. There is no iOS project, signed IPA or TestFlight distribution in this repository. The checked-in Windows and Flutter web scaffolds do not create iOS support.

For a manual checksum check on Windows, run Get-FileHash -Algorithm SHA256 .\byline-latest.apk and compare the result with releases/android/SHA256SUMS. Developers can run apksigner verify --verbose --print-certs on the APK. Android's official sideloading guidance is at https://developer.android.com/distribute/marketing-tools/alternative-distribution and signature-tool documentation is at https://developer.android.com/tools/apksigner. These references describe the platform installation mechanism; the actual APK manifest and release verification record describe this build.

## 7. Account creation, authentication and session lifecycle

The cloud GET /api/native-auth response advertises configured Google and LinkedIn providers and reports localTest false. The app generates a cryptographically random verifier, starts an authentication flow and saves pending flow material in secure storage. The backend stores its SHA-256 digest and a short-lived flow record. The browser visits the provider, which redirects to the backend callback. The callback claims the flow once, exchanges the authorization code, obtains the verified provider subject, provisions or finds the ByLine identity and associates any LinkedIn grant.

The app polls with the flow ID and original verifier. The cloud implementation consumes a completed flow and creates one server-side session atomically. Native flows live for ten minutes; cloud bearer sessions expire after thirty days. Cloud requests must use Authorization: Bearer; cookie authentication is deliberately not accepted there. The signed token alone is insufficient: sessionOwner also checks the persisted session, revocation, expiry and account/agent relationship. Logout revokes the server session and the app clears its local state.

Provider identity is keyed by provider and subject. Signing in with Google and signing in with LinkedIn are not automatically an account-merging mechanism. The application does not silently transfer the legacy owner's history to a new social identity. The original Next.js service additionally supports the legacy APP_PASSWORD/cookie flow through lib/auth.ts and middleware.ts. The mobile Existing installation screen exists for that compatibility path; it is not the standard cloud signup route.

Cloud login starts are limited to ten per fifteen-minute window for a keyed hash of the connecting IP. Return addresses are validated by shared native-return logic; callback pages are generated centrally. Provider secrets and encrypted LinkedIn grants stay on the server. Native sessions and unfinished sign-in material use Flutter secure storage. A session expiration returns 401 and is translated into a sign-in message by the client.

## 8. Onboarding, subjects and writing preferences

Setup persists independently of screen navigation. The state includes industry, topic strings, selected category IDs, tone, optional voice notes/style, up to three writing samples, timezone, time and notification preference. The catalogue contains 1,112 selectable subjects and 55 specialist groups, in addition to the foundational industry choices. lib/category-catalogue.ts stores the specialist vocabulary; lib/categories.ts exposes normalized category records and validation.

parseSetup requires one to twelve distinct topics, each two to eighty characters, and one to twelve distinct valid category IDs when explicitly supplied. Voice notes allow up to 1,200 characters. Up to three samples are accepted, each eighty to 2,400 characters. Timezones must be valid IANA timezone names and times normalize to HH:MM. Ten named tones are available: professional, conversational, storyteller, punchy, analytical, educational, reflective, warm, witty and inspirational.

The cloud setup API uses a revision number. Saving changes increments the revision and clears old preview/acceptance markers. Preview uses a three-minute generation lease and a ten-per-day attempt limit. Acceptance is only valid for a successfully generated sample matching the current revision. Finish requires that acceptance and an unexpired LinkedIn connection, then atomically activates the configuration and creates a daily slot. A stale sample cannot authorize changed voice settings.

New native accounts use no signature by default. Legacy DEFAULT_STYLE retains the original signature configuration for compatibility. Settings cover structure (prose, bullets, short lines, mixed), emoji policy, hook intensity, closing/CTA policy, word range, hashtag count, register, custom rules, banned phrases and optional signature rationing. The nominal word range is subordinate to the final post's character budget. Choosing a long word range does not increase LinkedIn's supported commentary length.

## 9. Daily app experience and screen responsibilities

The main mobile navigation has Home, My posts and Me. Home uses TodayScreen for native accounts, showing today's timetable entries, preparation progress and other posts. My posts collects drafts/desk actions, writing and the published archive. Me hosts account, connection, scheduling, voice, notification and related settings. Composer is a route above the tab shell, so a card or notification can request it through AppState.

WelcomeScreen loads provider capabilities and resumes a saved pending sign-in when possible. GateScreen implements legacy installation login. OnboardingScreen handles saved setup, subjects, voice, sample review and delivery choices. TimetableScreen edits recurring slots. VoiceScreen edits writing preferences and previews. ComposerScreen creates or edits text, hashtags and images. DeskScreen shows actionable drafts and send outcomes. ArchiveScreen paginates published posts and supports follow-up writing. DeleteAccountScreen requires the destructive confirmation flow.

AppState is the shared observable state and owns status refresh, authentication phase, preparation status, composition requests and navigation requests. ApiClient centralizes transport, timeouts, authentication, persistence and error translation. Ordinary requests have a thirty-second ceiling; writer-facing operations use a longer 135-second timeout. Connection recovery retries bounded GET reads, not publishing mutations. Home refreshes on app resume and periodically retries when an error, missing status or active preparation warrants it. A timeout is not proof that a server-side mutation did not happen.

The app supports unsaved-change guards, draft-specific actions, responsive reading widths and a common editorial widget system. Theme and widget files are separately catalogued. Historical screenshots at widths 390, 900 and 1280 illustrate the responsive design work. Automated widget tests are evidence of specific tested behavior, not proof of universal device accessibility or performance.

## 10. Discovery, judging and draft generation

Discovery reads RSS/news sources associated with selected subjects. The shared discovery core normalizes source material, decodes entities, filters and deduplicates candidates, and balances selection so one source does not monopolize the batch. Feed health is recorded for diagnosis. Specialist subjects use targeted sources/search routes, so an entry in the catalogue does not guarantee a qualifying story on every day.

Judging is a batched LLM request. Each candidate is scored from zero to ten for persona fit, category fit, novelty, timeliness and non-duplication. Their mean is rounded to two decimals. A candidate must reach 6.5 overall, category fit at least seven and persona fit at least six, and its assigned category must be valid and selected. Invalid score entries are excluded. Category coverage and prior fingerprints help avoid repetitive output without forcing a low-quality story to pass.

The writer receives the selected story, persona, voice/style rules, prior openings, selected writing samples, optional edit notes and continuity context. It produces structured draft data including text, rationale, hashtags, fingerprint and continuity information. Repair attempts address failed constraints. Critique enforces deterministic checks on the generated result. The shared formatting layer assembles the body, exact source link and normalized hashtags in code rather than trusting a model to reproduce URLs accurately.

MAX_BODY_CHARS is 2,400; MAX_COMMENTARY is 3,000 in the LinkedIn client. The implementation checks escaped final text, including appended source and hashtags. The hook/fold marker uses 210 characters as a UI heuristic. Up to fifteen hashtags are permitted by application validation. Model-generated content is not a factual guarantee: the author must inspect source relevance, claims and voice before publishing.

Cloud generation persists stages discovering, judging, writing and saving. It loads the author and slot revisions, runs source/AI steps through Workflows, validates the result, saves one draft using the job identity and settles the job. The source step results can be reused during durable retries. If no source qualifies or providers fail, the job records a failure or waits for a later eligible attempt; it does not manufacture a successful draft status.

The cloud memory context currently has no external facts and source none. The original backend can use optional Breeth graph memory with PostgreSQL fingerprints as fallback. Those are different deployments' capabilities; configuring the cloud backend does not enable the legacy external memory path.

## 11. Scheduling, durable jobs and duplicate prevention

Cloud cron runs every five minutes, creating a maintenance Workflow keyed to the scheduled interval. Maintenance publishes eligible due posts, scans the timetable, reconciles interrupted jobs, dispatches queued jobs, drains notifications and performs periodic cleanup. The source order is intentional and is visible in cloud/src/scheduler.ts. A cloud scheduler heartbeat older than sixteen minutes makes the scheduler-aware health endpoint return 503.

Each cloud author can have up to five slots. Days are a seven-bit mask, with bits following the weekday mapping in lib/schedule.ts; 127 means every day. Lead time ranges from ten to 720 minutes and defaults to fifteen. Time calculations use the author's timezone. firstDelivery deliberately chooses tomorrow in that timezone. A posting occurrence over forty-five minutes late is treated as missed rather than sent at an arbitrary later time.

Slot runs are unique per slot and local date. Jobs capture author and slot revisions. A changed configuration, disabled slot, paused author or consumed occurrence prevents obsolete work from creating a new eligible draft. A discarded draft remains a consumed occurrence; it is removed from ready/other-post displays without silently generating a replacement for the same slot/date.

generation_jobs persists queued work before dispatch. If creating a Workflow fails, the next tick can retry dispatch with the same identity. Reconciliation inspects stale working jobs, recovers an already-saved draft when possible, or records a real failure. Slot retries are bounded; source code records attempt counts, retry timestamps and maximum attempts. Manual preparation is separately constrained so repeated taps cannot create unlimited jobs.

The original backend instead uses PostgreSQL advisory locking and its own tick orchestration in lib/cycle.ts, lib/slots.ts and lib/reviews.ts. It depends on an external tick request to /api/cron/tick. The isolated local launcher sends that tick every thirty seconds. These mechanisms should not be confused with the cloud Cron Trigger.

## 12. Editing, approval, publishing and uncertain outcomes

Saving a draft is separate from sending it to LinkedIn. POST /api/posts accepts manual content and an optional clientRequestId so retries can recover the same save. Polish combined with immediate publishing is refused because changed AI text must be reviewed. Scheduled manual posts receive a send time and appropriate clearance. Edits clear prior approval. Reviewed text/hashtags/media can be supplied with a publish or clear action to catch changes between review and execution.

The cloud post action vocabulary is publish, resolve, rewrite, followup, edit, clear, unclear, hold, release, reschedule and discard. Hold lasts fifteen minutes. Rewrite produces alternative content for review; followup applies to a published post. Discard changes the record to rejected and removes the scheduled timestamp. Archive GET returns published posts in pages of twenty with a cursor and hasMore flag.

Publishing first checks LINKEDIN_LIVE, author/post ownership, a usable LinkedIn token, image ownership and final escaped length. An atomic distribution claim uses the key linkedin:{agentId}:{seq}. A send in flight, already sent or unknown blocks a competing send and blocks unsafe editing. Cloud manual sends have a forty-attempt daily cap; automatic sends are capped by the author's configured allowance bounded from one to five. These application limits are not statements of provider quotas.

Automatic publication requires an active, unpaused author, an eligible scheduled time and either explicit clearance or the author and slot automatic-publishing flags. A held, missed or unresolved post is not blindly sent. New accounts and new slots start with automatic publication disabled. The global deployment switch is an additional gate, not a replacement for user approval settings.

A successful LinkedIn response stores the external post URN, marks the distribution sent and the post published. A definite HTTP 4xx rejection records a failed attempt. Timeouts, connection failures and ambiguous server responses are treated as unknown. The application cannot safely assume whether the provider created the post, so it does not automatically replay the mutation. The author checks LinkedIn and resolves the outcome. A sufficiently stale in-flight send can also be resolved. This protects against duplicate public posts at the cost of sometimes requiring manual reconciliation.

## 13. Images and media ownership

The mobile image picker selects images and the transport sends a multipart upload. The backend checks the request and LinkedIn image requirements, initializes upload, transfers bytes and stores an owned media_assets record. Posts refer to media IDs, not arbitrary untrusted LinkedIn image URNs. The cloud publisher accepts at most twenty distinct IDs and requires all referenced assets to be uploaded and owned by the same agent.

The LinkedIn client centralizes escaping, image and post APIs, OAuth scopes and permalink construction. Do not implement a second sending path that bypasses its text conversion or the distribution claim. For image posts the cloud assembly omits the separate source line in the branch specified by publish.ts; the saved source metadata remains available for editorial context. Full upload validation and byte limits are in the media source files and companion reference.

## 14. Notifications and background behavior

Android Firebase initialization happens before messaging access, but initialization failure does not prevent the app from opening. Notification permission/registration is tied to the signed-in account and saved preference. Device tokens are registered server-side for that owner. Logout unregisters while still authenticated, and the backend checks ownership so an old account cannot remove a token now associated with another account on the same phone.

The cloud server uses an FCM service account to mint a short-lived OAuth credential and sends through FCM HTTP v1. Notices include draft ready, generation failure, publication outcome, connection expiry and a test notice. Android channels separate routine updates and alerts; MainActivity creates channels and the manifest defines the default channel/icon. A notification carries a target tab and, when applicable, a post sequence. Tapping it opens the relevant app workspace.

Notifications are placed in a durable outbox with dedupe keys. A claim sets a future retry timestamp, and delivery attempts are bounded. The cloud dispatcher processes at most three outbox rows per maintenance batch; a notice targets at most ten devices. The immediate generation step targets the outcome for its own job. The current implementation marks an outbox row delivered if at least one device send succeeds, so it does not prove delivery to every device; provider acceptance also does not prove display on a physical phone.

Battery management, denied permissions, unregistered device tokens, provider outages and network state can delay or prevent visible alerts. The server retains the draft/status regardless of whether a notification appears. Windows support does not provide the Android FCM background path, and local preview deliberately clears server Firebase credentials. Open the app to inspect current state when notification delivery is uncertain.

## 15. Persistence and data ownership

The primary relationships are: byline_users owns an agent; byline_sessions belongs to a user; onboarding belongs to a user; posts, post_slots, linkedin_accounts, media_assets, distributions and notification records belong to an agent; slot_runs belongs to a recurring slot and date. generation_jobs adds durable cloud job state. post_counters allocates author-scoped post sequences. Identity/session records must not be inferred from client-supplied agent IDs.

AI accounting uses ai_user_days, ai_provider_days, ai_usage and cloud ai_reservations. feed_health and system_status describe operational state. oauth_states and native_auth hold transient consent state. login_attempts limits sign-in starts. review_deliveries, rejections, llm_calls and push_log support existing orchestration/audit paths, with usage differing between the two adapters. A table existing in the cloud migration does not imply every legacy feature actively writes it there.

PostgreSQL uses UUIDs, JSON fields, timestamps, foreign keys, unique indexes and advisory locks. lib/schema.ts is an additive migration body; lib/db.ts records its hash in byline_schema_versions under a transaction lock. BYLINE_REQUIRE_MIGRATIONS can make serving fail closed until an operator has applied the migration. The pool is shared through globalThis to survive Next.js development reloads; it uses up to ten connections and a twenty-second connection timeout.

D1 uses its own two checked-in SQL migrations. JSON-shaped data is stored in text columns and translated by model helpers. Atomic D1 batches and SQL conditions implement concurrency controls; do not copy PostgreSQL BEGIN/COMMIT or advisory-lock assumptions into the Worker adapter. Unique indexes prevent duplicate owner agents, client request saves and slot/day posts. The schema appendix reproduces all columns, defaults, indexes and triggers, and the table-purpose index explains the records they protect.

Cloud deletion requires confirmation exactly DELETE. It refuses while a distribution is in flight and deletes the account's related records in one batch. Deleting application data does not delete already-published LinkedIn posts. Historical backups and any legacy external memory require their own retention handling. Operator recovery must preserve encryption keys as well as database contents: encrypted grants cannot be recovered from a database alone if the key is lost.

## 16. AI limits, errors and provider boundaries

The current cloud constants are forty AI reservations per author/day, one hundred per model/day shared across authors, and twelve actual AI attempts per completion wrapper invocation. Budget days use America/Los_Angeles in the cloud AI adapter. Reservations and pacing are enforced before transport, and usage stores success plus available token counts. These are application safeguards, not a claim that Google will supply that capacity.

The cloud primary model string is gemini-3.5-flash-lite and fallback is gemini-3.1-flash-lite. The fallback is attempted for selected temporary network/5xx failures after a bounded wait. Quota failures are not treated as transient transport errors. Durable Workflow steps can retry temporary exceptions without repeating successful source steps. The original Node adapter has its own configured primary/fallback/last-resort policy and defaults from .env.example. Read the deployment-specific adapter when diagnosing a model selection.

Cloud discovery is capped at twenty-four fetches including redirects and twelve selected feeds. Provider responses and HTTP request bodies have explicit byte ceilings. Completion responses must contain usable text and the expected finished status; partial/blocked results are not treated as successful drafts. Raw provider details stay in operator logs, while generation-errors translates failures into actionable client messages.

Existing reports describe free-tier verification and model availability on 5 November 2026. That history is not a perpetual price, quota or availability guarantee. Check the actual provider account and current official limits before deploying or increasing capacity. No paid fallback is configured in the current cloud adapter. The application can be unavailable when its free quota or external provider capacity is exhausted.

## 17. API contract guide

The cloud and Next.js route navigation index follows this narrative; complete handler implementations are in the companion reference. Read cloud/src/index.ts for method dispatch, each cloud handler for request validation and mobile/lib/api/models.dart for the client-side response shapes. The shared URL shape does not mean the two deployments support identical operator endpoints.

Public cloud routes are GET /api/health, GET/POST /api/native-auth and GET OAuth callbacks. All remaining dispatched cloud routes require a native bearer session. JSON body parsing requires an object and limits the body to 64 KiB. Responses disable caching and set nosniff/referrer-policy headers. Unexpected failures produce a generic 500 without returning raw diagnostics.

GET /api/status aggregates account/settings/queue and preparation information. GET/POST /api/onboarding reads or executes save, preview, accept and finish. GET/POST /api/interests reads or changes interests. PATCH /api/settings changes account writing/scheduling controls. GET/POST /api/slots lists/creates slots; PATCH/DELETE /api/slots/{id} edits/deletes one. GET/POST /api/review-delivery reads today's timetable, requests generation or saves notification preference. POST /api/cycle/run requests a manual background draft and returns 202 when accepted.

GET /api/posts reads the published archive; POST creates a manual draft or a reviewed direct publication request. PATCH /api/posts/{seq} executes a named post action. POST /api/compose/rewrite and POST /api/style/preview request AI revisions/previews without silently publishing them. POST /api/media uploads an owned image. POST/DELETE /api/devices registers, tests or unregisters notifications. GET /api/linkedin/connect starts account connection; POST /api/linkedin/disconnect removes the grant and disables automatic publication. DELETE /api/auth revokes the session. POST /api/account/delete executes confirmed deletion.

Typical errors are 400 invalid input, 401 unauthenticated/expired session, 404 unknown owned resource, 409 stale revision/state conflict, 429 allowance/rate limit, 503 temporary service/generation unavailability and 500 unexpected backend failure. Check the actual handler for exact response status and body. Never replay a publish merely because the client did not receive a response. Refresh and inspect its persisted state first.

The original Next.js router additionally exposes operator initialization, password authentication, authenticated cron and watchdog routes. Its middleware and request-agent helper determine legacy/native access. Those operator capabilities are not automatically exposed by the cloud router.

## 18. Configuration, secrets and build variants

The generated configuration-use index lists variable names with source locations. Root .env.example is a template, not a populated credential file. DATABASE_URL chooses the original PostgreSQL database. APP_SECRET signs sessions; TOKEN_ENCRYPTION_KEY protects stored LinkedIn grants. APP_PASSWORD gates the legacy dashboard. CRON_SECRET authenticates original tick/watchdog work. LINKEDIN_CLIENT_ID/SECRET and redirect URI configure the service-owned LinkedIn app. GOOGLE_CLIENT_ID/SECRET and redirect URI optionally configure Google identity.

GEMINI_API_KEY and the LLM/model/budget settings configure the original AI adapter. BYLINE_PUBLIC_URL supplies public callback context. BYLINE_REQUIRE_MIGRATIONS controls migration enforcement. BYLINE_TEST_MODE together with BYLINE_LOCAL_ONLY enables isolated fixtures; these must not be mistaken for real publishing. The original FCM adapter uses project ID, client email and private key fields; the cloud adapter receives FCM_SERVICE_ACCOUNT_JSON. BREETH_API_KEY is optional legacy memory integration.

Cloud secrets are declared by cloud/src/env.ts and prepared into ignored .byline-local/cloud-secrets.json. Wrangler configuration stores resource bindings, not secret values. Build-time Dart defines include BYLINE_API_URL, BYLINE_APP_VARIANT and public Firebase client configuration. Firebase's Android client configuration identifies the project/app; it is not the server service-account private key. Server OAuth client secrets, Gemini keys, token-encryption keys and signing passwords must never be embedded in Dart defines or committed.

The cloud variant uses BYLINE_APP_VARIANT=cloud, com.linkdin.byline and a private release signing configuration. The live development variant uses the same package ID with its existing development signing behavior and a distinct label. The preview variant uses BYLINE_LOCAL_TEST=true and com.linkdin.byline_preview, disables Google Services processing and uses the local backend. A default build retains com.linkdin.linkdin_mobile and defaults to the Android-emulator backend address, so a plain flutter build apk is not a substitute for the prepared cloud release command.

mobile/android/key.properties and .byline-local/byline-release.p12 remain private. The prepare-cloud script preserves an existing key pair and refuses incomplete signing state. Back up the key and its passwords securely: a different certificate cannot provide an ordinary in-place update to existing installs. The repo contains the signed public APK and certificate fingerprint, not the private signing material.

## 19. Setting up a developer workstation

Clone the repository and install Node.js/npm, Flutter with the Dart SDK version required by mobile/pubspec.yaml, Android SDK/build tools and a compatible Java installation. CI currently selects Node 24. Use npm ci in the root and cloud directories to honor lockfiles, and flutter pub get in mobile. cloud worker types are generated, ignored files: run npm run types from cloud before typechecking a fresh clone.

For cloud development: change directory to cloud, run npm ci, npm run types, npm run typecheck and npm test. The pretest builds the Worker bundle with wrangler deploy --dry-run, then tests execute against an isolated Miniflare database. This does not deploy the Worker. For an interactive local D1 backend, run npm run db:local and use Wrangler's local development mode with local-only test credentials as required. Do not run remote migration commands against a guessed account.

For the original backend: run npm ci, create a local environment from .env.example and configure a disposable PostgreSQL database. npm run dev starts the web/API service. npm run migrate explicitly applies the schema to the database selected by DATABASE_URL. npm run build:check uses a separate .next-verify directory so verification does not overwrite a running server build. Missing DATABASE_URL can support limited stub views but is not a functioning persistent installation.

For the prepared Windows preview on this workstation: npm run local:setup creates the isolated database; npm run local:dev runs the API and scheduler. scripts/build-local-android.ps1 builds the preview. scripts/install-local-android.ps1 installs through USB and configures adb reverse. npm run local:phone combines these steps and can rebuild when requested. These installer commands modify a connected device; building the release APK and writing this document do not require running them.

To develop the mobile client against a chosen server, use flutter run with --dart-define=BYLINE_API_URL=https://your-server and the correct variant/Firebase defines. Android emulator 10.0.2.2 reaches the host machine; a real phone does not. Cloud release users should use the packaged APK, whose server origin is already configured.

## 20. Rebuilding and distributing the Android release

Restore the private signing key and ignored key.properties from the owner's secure backup before rebuilding an update. The cloud preparation script also requires .byline-local/firebase-live-google-services.json matching project linkdin-43813 and package com.linkdin.byline. These inputs are intentionally not reconstructed from public repository data.

From the repository root run node scripts/prepare-cloud-android.mjs https://byline-api.byline-b79.workers.dev, then powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-cloud-android.ps1. The latter builds a release using .byline-local/cloud-dart-defines.json and copies the result to .byline-local/byline-cloud-release.apk. Neither command installs the APK on a phone.

Inspect the output with Android SDK aapt/apkanalyzer and apksigner. Confirm package ID, version, min/target SDK, architectures, release signing and backend origin configuration. Compute SHA-256 after copying the exact artifact to releases/android/byline-latest.apk. Update release.json and SHA256SUMS from that file, then commit the binary with the documentation. Increment mobile/pubspec.yaml for an actual versioned application update; a documentation-only rebuild of identical application source can retain its declared version, but the new file hash must still be recorded.

The versioned build metadata and stable latest filename make the phone download path easy to find. Git preserves earlier committed APKs, but large binaries increase repository size. This release is stored directly in Git so clone and Download raw file work without Git LFS setup. Future releases can additionally use GitHub Releases for distribution while retaining a clear latest download link. No app-store publication or automatic OTA updater is implemented by this step.

## 21. Deployment and operations

The repository already identifies a dedicated ByLine Cloudflare account and database. Preserve that boundary. Build/test changes locally, verify the selected Wrangler account, back up data and encryption/signing material, apply the checked-in D1 migrations to the intended database, then deploy with the prepared secrets file. cloud/README.md contains the exact commands and ownership constraints. This documentation/repository task does not require deploying a new backend or changing existing users' settings.

Verify basic health and unauthenticated rejection after deployment. /api/health confirms DB access; /api/health?check=scheduler additionally checks recent timer activity. A manually invoked task is not evidence that cron fired naturally. An independent monitor is needed to detect a total provider outage, since a failed provider cannot reliably alert through its own scheduler. The existing GitHub watchdog and backup jobs target the original service configuration; they are not a verified cloud backup/restore solution.

The cloud smoke scripts can create disposable authors and some scripts can consume real AI requests. Read their conditions and use the intended origin. Provider consent, physical push delivery and actual publication require separate end-to-end exercises; isolated tests do not prove external service configuration. The dated release report records earlier evidence and its limits.

For the original Vercel/PostgreSQL deployment, configure the correct environment variables and matching provider callbacks, migrate the selected database and arrange the authenticated cron request. Keep the original and cloud databases conceptually separate. A change to the cloud Worker does not repair, migrate or restart the old Vercel website.

## 22. Troubleshooting and recovery

Cannot install APK: confirm the file is an APK rather than HTML, download it again, verify its hash, check available storage, Android version and device policy, and compare signing identity if another ByLine package is installed. The APK's actual SDK and ABI values are in release.json. Do not erase an existing installation as the first diagnostic step.

Cannot reach ByLine: check internet access and the prepared origin, then the basic health endpoint. On local preview check the running server and adb reverse. A cloud outage cannot be solved by leaving the development computer awake. A 401 requires sign-in; repeated GET recovery does not fix a revoked session.

OAuth does not finish: confirm the exact registered callback URI, provider credentials and the selected provider's capability response. Return to the app while the ten-minute flow is valid. Cancel and restart expired consent. Treat Google and LinkedIn provider identities as distinct unless an explicit migration/linking workflow is implemented.

Sample or draft fails: inspect the saved job stage/error, selected subjects, source availability and AI allowance. Tighten impossible writing preferences, especially word ranges that exceed the final character budget. A no-source outcome is valid. A provider quota failure is not fixed by repeatedly tapping prepare; retries consume the same bounded allowances.

Draft missing after discard: discarded posts are intentionally excluded from the current ready list, while their slot occurrence remains consumed. Check the correct account and date before assuming data loss. If a save timed out, refresh or retry using the same request identity rather than inventing a new one.

No notification: check system permission, the account's saved preference, device registration and Firebase configuration. Inspect the outbox and provider status, then open the app for the authoritative state. An FCM accepted send is weaker evidence than observing the alert on the actual device.

Post not sent: verify global live switch, LinkedIn token expiry, account/slot automatic settings, explicit clearance, hold state, eligible send window, daily allowance and final text length. If the outcome is unknown, inspect the LinkedIn profile and resolve it through the app. Never reset the distribution claim merely to force a retry.

Recovering after data loss: restore a tested backup into an isolated target, restore the matching token-encryption key, validate schema and ownership, and inspect pending jobs/distributions before enabling scheduling. Keep publishing disabled during recovery until uncertain sends have been reconciled. Cloud-to-PostgreSQL and PostgreSQL-to-cloud migrations require an explicit data transformation; copying SQL files does not transfer history.

## 23. Testing and what the evidence means

Root npm test checks core formatting, escaping, scheduling, judge handling and health behavior. test:catalogue validates subject uniqueness/discovery/relevance and voice persistence behavior. test:byline checks account/session/setup and timezone/DST logic. test:db exercises real SQL against a disposable PostgreSQL database. test:local orchestrates local API/catalogue/native-return integration scripts. build:check compiles the Next.js production build separately from a serving build.

cloud npm test builds the Worker bundle and runs writer, discovery-budget, database and API suites using Miniflare. Tests cover concurrent identities, session revocation, ownership separation, draft and schedule isolation, notification device ownership, deduplication, publish claims, account deletion and provider failure paths. The companion source reference supplies the exact fixtures and assertions. A mocked provider response does not demonstrate a real LinkedIn grant or FCM arrival.

Flutter analysis checks lib and test. Flutter tests cover model/transport contracts, auth return, notifications, catalogue/voice behavior, onboarding, preparation, reconnect recovery, screen rendering and widgets. The final release verification document records fresh results, command exit status and any limitations. Historical reports are separately dated; they are useful regression context but not replacements for this run.

The PDF is checked for readable page rendering, extracted text, file-catalogue coverage and final artifacts. APK verification checks structure and signing and the hash of the copied file. Git verification checks committed content and that the remote branch has the pushed commit. None of those alone proves every user journey on every phone, so the report distinguishes current automated checks, current read-only live checks and earlier device evidence.

## 24. Security and privacy model

Principal security boundaries are the phone/server boundary, unauthenticated/authenticated API boundary, user/agent ownership boundary, server/provider credential boundary and draft/publication boundary. Bearer-session verification, persisted revocation, owner-scoped SQL, one-use OAuth flows, parameterized queries, encrypted grants and atomic send claims support these boundaries. Request and provider-response byte caps prevent unbounded body reads in the relevant helpers.

Writing samples, draft text, voice preferences and selected source material can be sent to the configured AI provider when generation is requested. LinkedIn receives posts/images when publication is authorized. Firebase receives device tokens and notification payloads. The database contains identities, preferences and writing history. The app's deployment-specific privacy policy must explain actual providers and retention; source code alone is not a complete privacy notice.

The repo excludes populated .env files, local database storage, private signing material, service-account private keys and live backups. Existing Firebase client configuration is a public app identifier/configuration asset; it must not be confused with administrative credentials. A code repository backup is not a customer-data backup. Preserve operational secrets separately and never print them in CI logs or support screenshots.

## 25. Known boundaries and maintenance guide

This repository contains a usable Android client and two backend implementations, not a claim of unlimited free hosting or a fully certified multi-tenant commercial service. The cloud API and old web service remain separate. There is no checked-in iOS release project. Full background cloud push on Windows is not established. Provider availability, free quotas, callback registration, permission grants and token expiry can interrupt the experience.

The 5 November release report records an in-place phone update, real notification observations and earlier publication evidence, but explicitly notes no second real person's OAuth sign-in and a manually shortened draft after a provider failure. Those limitations remain relevant context. Public customer launch still needs independent monitoring, tested off-provider restoration, a distribution/update policy and deployment-specific privacy/support operations.

When adding a subject, update catalogue definitions and validate discovery/relevance tests. When changing writing behavior, update shared core logic and exercise both adapters. When changing persisted fields, add database migrations for each affected backend and update view models/mobile parsing. When changing an API, update client transport/model tests. When changing publication behavior, preserve idempotency and ambiguous-outcome handling. When updating the mobile app, preserve its signing key and record the version/build hash.

The PDF reference chapters retain every file and its role, npm dependency resolutions, imports and environment uses, API navigation, D1 table definitions, test titles and selected phone previews. The separate docs/generated-reference.md preserves the full project-owned source, Dart lockfile and historical documents. Use that companion when a question needs an exact branch or assertion. This keeps the PDF within 100-120 pages without discarding the exhaustive repository reference.
