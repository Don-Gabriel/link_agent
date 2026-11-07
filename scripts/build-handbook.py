"""Build the 100-120 page ByLine handbook and exhaustive repository reference.

Requires reportlab and pypdf. Run from any directory: python scripts/build-handbook.py
No secrets, ignored caches, live databases or third-party source are read.
"""
from pathlib import Path
import collections
import hashlib
import html
import json
import re
import subprocess
import textwrap

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, PageBreak,
    Preformatted, Image, KeepTogether,
)
from reportlab.platypus.tableofcontents import TableOfContents
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/ByLine-Complete-Project-Handbook.pdf'
INVENTORY = ROOT / 'docs/repository-inventory.json'
REFERENCE = ROOT / 'docs/generated-reference.md'
DERIVED = {'docs/repository-inventory.json', 'docs/generated-reference.md',
           'docs/handbook-build.json', 'output/pdf/ByLine-Complete-Project-Handbook.pdf'}
BINARY = {'.png', '.ttf', '.ico', '.apk', '.pdf', '.jpg', '.jpeg', '.zip'}
DATE = '7 November 2026'

LIB = {
    'accounts': 'Loads, encrypts and persists LinkedIn account grants; reports connection and expiry status.',
    'agents': 'Creates and updates PostgreSQL author workspaces, settings, persona and voice references.',
    'ai-usage': 'Reserves and records original-backend per-author/provider AI usage and pacing.',
    'auth': 'Signs and validates the legacy password-dashboard session cookie.',
    'breeth': 'Optional external Breeth graph-memory transport and fact operations.',
    'categories': 'Normalizes legacy and specialist subjects; exposes IDs, labels, hashtags and selection validation.',
    'category-catalogue': 'Complete specialist subject vocabulary and stable subject-ID construction.',
    'critique': 'Deterministic draft-quality checks, including voice constraints and final character budget.',
    'crypto': 'Original backend AES-GCM encryption/decryption for provider tokens at rest.',
    'cycle': 'PostgreSQL-backed discovery/judging/writing orchestration and scheduled cycle coordination.',
    'db': 'Shared PostgreSQL pool, query handling, schema hash ledger and migration locking.',
    'discovery': 'PostgreSQL feed-health adapter around shared source discovery.',
    'discovery-core': 'Feed definitions, fetch budgets, redirect handling, parsing, deduplication and balanced source selection.',
    'distribute': 'Original backend publication claims, daily limits, idempotency and ambiguous-outcome resolution.',
    'entities': 'HTML/XML entity decoding used when normalizing feed text.',
    'feedhealth': 'Persists feed success/failure history and identifies repeated source failures.',
    'format': 'Assembles exact source/hashtag text, computes escaped LinkedIn length and extracts the hook.',
    'http-body': 'Reads HTTP streams with explicit byte limits, cancelling oversized bodies.',
    'judge': 'Original backend completion adapter for the shared editorial judge.',
    'judge-core': 'Batched candidate scoring, relevance thresholds, validation and coverage-aware selection.',
    'linkedin': 'Official LinkedIn OAuth, profile, image and post HTTP client; little-text escaping and permalink rules.',
    'llm': 'Original Node/Gemini SDK adapter with configured models, accounting and response handling.',
    'llm-contract': 'Shared completion request/result types and structured JSON parsing helpers.',
    'media-ownership': 'Validates that referenced original-backend media assets belong to the requesting author.',
    'memory': 'Original editorial memory abstraction with optional Breeth and database fallback.',
    'native-auth': 'PostgreSQL native identities, verifier-protected OAuth flows, bearer sessions and revocation.',
    'native-callback': 'Browser completion page and Android/desktop return signal without putting credentials in app links.',
    'native-return': 'Strict validation of random-path loopback desktop OAuth return URLs.',
    'onboarding': 'PostgreSQL saved setup, sample generation/acceptance, activation and review-delivery coordination.',
    'persona': 'Original persona generation/persistence adapter and shared persona exports.',
    'persona-prompt': 'Runtime-neutral persona types and prompt text construction.',
    'post-view': 'Converts persisted original-backend posts into client-facing display/status fields.',
    'push': 'Original Firebase push transport, device registration, reminder eligibility and logging.',
    'ratelimit': 'Original dashboard login-failure rate limiting and reset helpers.',
    'request-agent': 'Resolves the authenticated request to its authorized agent for original API handlers.',
    'retention': 'Bounded original-backend cleanup policies for operational records.',
    'review-feedback': 'Maps preparation/review outcomes to meaningful user-facing feedback.',
    'review-progress': 'Preparation stage/progress contracts and UI-facing state helpers.',
    'reviews': 'PostgreSQL review-delivery generation, retries, leases and notification outbox orchestration.',
    'schedule': 'Timezone-aware clock, local date/time validation and next-run calculations.',
    'schema': 'Complete additive PostgreSQL schema SQL, ownership relationships, indexes and migration-compatible changes.',
    'setup-config': 'Shared onboarding catalogue, tones, validation and conversion to persona/style/schedule.',
    'slots': 'Original recurring posting slots, occurrence claims, scheduler heartbeat and timeline.',
    'style': 'Writing style types, defaults, presets, normalization and prompt constraints.',
    'timetable-home': 'Derives home preparation/ready state from the unified timetable.',
    'unified-timetable': 'Combines slot runs and saved drafts into a single day-oriented timetable model.',
    'voice': 'Original database-backed selection of writing samples and feedback for voice conditioning.',
    'voice-prompt': 'Shared writing-sample selection and voice-reference prompt construction.',
    'writer': 'Original completion adapter for shared generation, rewriting, follow-up and polishing.',
    'writer-core': 'Shared writer prompts, output validation, repair budgets and draft/rewrite/follow-up operations.',
}
CLOUD = {
    'index': 'Cloud Worker HTTP method/path router, authenticated-owner boundary and five-minute scheduled dispatch.',
    'env': 'Types for secret bindings combined with generated Wrangler resource bindings.',
    'ai': 'Gemini REST transport, atomic quota reservations, pacing, bounded transient fallback and usage records.',
    'auth': 'Cloud OAuth capability/start/poll/callback, session authentication, login limits and LinkedIn connection.',
    'crypto': 'Web Crypto session MAC signing/verification, digest helpers and authenticated token encryption.',
    'delete-account': 'Atomic author-data deletion with exact confirmation and in-flight-publication guard.',
    'drafts': 'Idempotent draft save, per-author sequence allocation and settings/slot revision enforcement.',
    'generation-errors': 'Converts internal generation failures into bounded client-safe explanations.',
    'generation': 'Cloud sample and durable job generation using the shared discover/judge/write pipeline.',
    'http': 'No-store JSON responses, typed HTTP errors and bounded body/provider JSON parsing.',
    'identities': 'Atomic provider identity provisioning and server-side session-to-author ownership resolution.',
    'jobs': 'Persistent manual/slot job enqueue, Workflow dispatch, failure/outbox settlement and stale-job reconciliation.',
    'media': 'Bounded multipart image validation, official LinkedIn upload and owned asset persistence.',
    'models': 'Cloud database row types and conversions to the mobile settings/account/post contracts.',
    'notifications': 'FCM credentials and send transport, owned device registration and bounded durable outbox dispatch.',
    'onboarding': 'Cloud saved setup revision, preview lease, acceptance and atomic first-slot activation.',
    'posts': 'Cloud archive, composer saves, rewrite/preview and guarded post actions.',
    'publish': 'Cloud publication eligibility, atomic claims, image ownership, result settlement and manual resolution.',
    'scheduler': 'Cloud maintenance Workflow, due-slot scanning/publication, cleanup and manual preparation routes.',
    'settings': 'Cloud author settings/interests validation and persistence.',
    'slots': 'Cloud slot CRUD, limits, timezone schedule views and discarded-aware daily timetable.',
    'status': 'Owner-scoped aggregate status document consumed by the mobile client.',
    'workflow': 'Content Workflow entry point, durable step retry configuration and outcome notification dispatch.',
}
SCREENS = {
    'welcome_screen': 'Social sign-in, provider capabilities, secure pending-flow resume and browser return.',
    'gate_screen': 'Legacy server/password installation sign-in and connection settings.',
    'onboarding_screen': 'Resumable first-run subject, voice, sample acceptance and delivery setup.',
    'home_screen': 'Home/My posts/Me navigation shell, lifecycle reconnect and composition/notification routing.',
    'today_screen': 'Native account daily timetable and preparation progress/ready-post presentation.',
    'desk_screen': 'Actionable draft workspace, preparation feedback and publication outcome controls.',
    'draft_commands': 'Shared UI commands for draft review, editing, scheduling and publication actions.',
    'archive_screen': 'Published-post history pagination and follow-up entry points.',
    'composer_screen': 'Manual/edit/follow-up composer with tags, images, rewriting, preview and save/send controls.',
    'delete_account_screen': 'Account deletion explanation and explicit confirmation interface.',
    'delivery_settings_screen': 'Delivery-time and notification-preference interface.',
    'settings_screen': 'Account/settings navigation, connection health, pause and operational controls.',
    'timetable_screen': 'Recurring posting-slot editor with days, lead time and automatic-publication controls.',
    'voice_screen': 'Writing preferences, samples, voice preview and persistence interface.',
}
WIDGETS = {
    'day_rail': 'Day/timetable visual rail and occurrence selection presentation.',
    'draft_card': 'Reusable draft summary, source/status and associated actions.',
    'editorial': 'Brand/editorial artwork and visual components.',
    'experience': 'Shared page/reading-width and experience layout components.',
    'form_select': 'Reusable accessible-to-Flutter selection/form controls.',
    'personal_topics': 'Subject catalogue browsing/search and personalized topic selection.',
    'preparation_progress': 'Visible multi-stage draft preparation and failure feedback.',
    'primitives': 'Basic reusable typography, spacing, status and interaction widgets.',
    'profile_card': 'Profile/account summary visual component.',
    'unsaved_changes_guard': 'Prevents silently leaving a screen with unsaved edits.',
    'writing_preferences': 'Shared controls for structure, tone, word range, hashtags and voice constraints.',
}
SCRIPTS = {
    'backup-live': 'Creates a backup of the configured live PostgreSQL installation.',
    'bench-api': 'Measures API response timings for diagnostic comparison.',
    'bench-db': 'Measures database/query latency for original-backend diagnostics.',
    'build-check': 'Runs a production Next.js verification build in .next-verify.',
    'build-cloud-android': 'Builds the privately signed cloud APK from prepared Dart defines; installs nothing.',
    'build-live-android': 'Builds the integration/live Android variant from local configuration.',
    'build-local-android': 'Builds the isolated demonstration Android preview variant.',
    'install-live-android': 'Installs/launches the live integration APK on a connected Android device.',
    'install-local-android': 'Installs/launches the preview APK and configures USB port reversal.',
    'prepare-cloud-android': 'Validates the cloud origin/Firebase app and prepares preserved private signing and Dart defines.',
    'byline-test': 'Local API integration coverage for account, setup, timetable and author-owned data.',
    'byline-logic-test': 'Pure native-session, setup validation, first-delivery and DST assertions.',
    'catalogue-api-test': 'Local API subject catalogue and settings persistence integration checks.',
    'catalogue-test': 'Subject uniqueness, source routing, relevance and voice consistency assertions.',
    'check-feeds': 'Probes configured source feeds and reports reachability.',
    'check-live-services': 'Checks configured live provider/service readiness.',
    'dbtest': 'Integration assertions against a disposable real PostgreSQL database.',
    'google-operator': 'Operator helper for Google/Firebase configuration tasks; inspect its flags before use.',
    'health-test': 'Health endpoint tests for readiness, missing configuration and safe error responses.',
    'live-cycle-smoke': 'Integration smoke exercise of a configured live content cycle.',
    'live-dev': 'Starts the original integration backend with its dedicated live environment.',
    'live-env': 'Loads/validates the dedicated live integration environment.',
    'live-setup': 'Prepares the original live integration environment and database configuration.',
    'live-smoke': 'Configured integration smoke checks; provider effects depend on the script/environment.',
    'local-dev': 'Starts isolated Next.js preview and its local scheduler tick.',
    'local-env': 'Loads validated loopback-only PostgreSQL fixture configuration and clears external credentials.',
    'local-phone': 'Coordinates isolated server, preview build, USB installation and app launch.',
    'local-setup': 'Creates the isolated local PostgreSQL data directory and preview environment.',
    'migrate': 'Applies the additive PostgreSQL schema to the explicitly configured database.',
    'native-return-test': 'Local API and browser-return contract checks for native sign-in.',
    'selftest': 'Core deterministic formatting, escaping, style, source, judge and scheduling regression checks.',
    'zero-budget-test': 'Verifies zero-budget/local behavior and provider-call safeguards.',
    'build-handbook': 'Rebuilds PDF, exhaustive file/source/dependency reference and hash inventory from publishable Git files.',
    'prepare-secrets': 'Builds ignored cloud secret configuration from private operator inputs without committing secrets.',
    'setup-push': 'Operator setup helper for dedicated Firebase cloud push service credentials.',
    'remote-smoke': 'Remote cloud integration smoke exercise using disposable data and configured live AI.',
}
TABLES = {
    'agents': 'Author workspace, persona, preferences, active/paused state and configuration revision.',
    'posts': 'Owned draft/publication content, sources, score metadata, schedule, clearance and status.',
    'byline_users': 'Verified social-provider identities, keyed by provider and subject.',
    'byline_sessions': 'Expiring, revocable native sessions owned by users.',
    'native_auth': 'Short-lived verifier-protected native OAuth handoff state.',
    'oauth_states': 'One-use LinkedIn connection consent state and safe return destination.',
    'onboarding': 'Saved setup, optimistic revisions, preview/acceptance leases and activation state.',
    'linkedin_accounts': 'Encrypted provider grants, member identity and connection expiry.',
    'post_slots': 'Recurring timezone-local posting times, selected days, lead interval and automation flags.',
    'slot_runs': 'One slot/date occurrence, preparation attempt/progress and associated post.',
    'distributions': 'Atomic publication claims, idempotency, provider outcome and manual resolution.',
    'media_assets': 'Owned LinkedIn image upload metadata and upload status.',
    'notification_outbox': 'Durable, deduplicated notification work and delivery retry state.',
    'device_tokens': 'Current device-to-author FCM ownership.',
    'push_log': 'Original push-send/reminder bookkeeping.',
    'generation_jobs': 'Cloud durable job payload, revision snapshot, queue/working/completed/failed state.',
    'ai_reservations': 'Cloud atomic AI-attempt reservations that trigger quota accounting.',
    'ai_user_days': 'Per-owner daily AI request counts.',
    'ai_provider_days': 'Per-model shared daily attempts and next permitted request time.',
    'ai_usage': 'Attempt success and reported input/output token usage.',
    'feed_health': 'Source reachability, recent success/failure and failure streak.',
    'system_status': 'Operational heartbeat and named system status values.',
    'scheduler_state': 'Per-author cycle count and last-run timestamp.',
    'review_deliveries': 'Original review-delivery occurrence, generation and retry state.',
    'post_counters': 'Atomic per-author post-sequence allocation.',
    'rejections': 'Editorially rejected candidate evidence.',
    'llm_calls': 'Original model call quota bookkeeping.',
    'login_attempts': 'Time-windowed sign-in throttling records.',
    'byline_schema_versions': 'Original PostgreSQL applied additive-schema hash ledger.',
}


def clean(value):
    return (str(value).replace('\u2019', "'").replace('\u2018', "'")
            .replace('\u201c', '"').replace('\u201d', '"').replace('\u2013', '-')
            .replace('\u2014', ' - ').replace('\u00a0', ' ').replace('\u2026', '...')
            .encode('ascii', 'backslashreplace').decode())


def git_files():
    raw = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT)
    return sorted({p.decode('utf-8') for p in raw.split(b'\0') if p and (ROOT / p.decode('utf-8')).is_file()})


def purpose(path):
    p = Path(path); stem = p.stem
    if path in DERIVED:
        return {'docs/repository-inventory.json': 'Generated machine-readable file, hash, purpose, symbol and import inventory.',
                'docs/generated-reference.md': 'Generated searchable complete file/reference/source appendix in Markdown.',
                'docs/handbook-build.json': 'Generated PDF page/coverage statistics and PDF SHA-256.',
                'output/pdf/ByLine-Complete-Project-Handbook.pdf': 'Condensed human-readable handbook with every-file catalogue and linked exhaustive source reference.'}[path]
    exact = {
        'docs/handbook.md': 'Authored architecture, user/developer/operator manual and implementation explanations for the PDF.',
        'docs/README.md': 'Documentation entry point and reproducible PDF generation instructions.',
        'releases/android/README.md': 'Phone download/install/update instructions and release provenance.',
        'releases/android/release.json': 'Verified downloadable APK version, identity, SDK, ABI, signing and checksum metadata.',
        'releases/android/SHA256SUMS': 'SHA-256 verification line for the exact downloadable APK.',
        'releases/android/byline-latest.apk': 'Signed universal Android cloud release ready for phone download and installation.',
        'README.md': 'Repository overview, current download/documentation links and original setup reference.',
        'BYLINE-LIVE.md': 'Original integration/live workstation operating instructions.',
        'BYLINE-LOCAL.md': 'Isolated demonstration backend/phone setup, verification and boundaries.',
        'DEPLOY.md': 'Original hosted deployment procedure and infrastructure notes.',
        'DESIGN.md': 'Design language, typography, layout and interaction rationale.',
        '.env.example': 'Blank original-backend environment variable template with operator comments.',
        '.gitattributes': 'Preserves PDF/APK binary bytes across Git checkouts and exempts embedded source whitespace in the generated reference.',
        'app/page.tsx': 'Original React operator gate, setup and dashboard UI.',
        'app/layout.tsx': 'Root Next.js HTML/layout and metadata wrapper.',
        'app/globals.css': 'Original web dashboard global styling.',
        'middleware.ts': 'Original Next.js request authentication/gating middleware.',
        'next.config.ts': 'Next.js build/runtime configuration and output directory settings.',
        'next-env.d.ts': 'Next.js generated TypeScript framework declarations reference.',
        'vercel.json': 'Original Vercel deployment/runtime configuration.',
        'cloud/wrangler.jsonc': 'Dedicated Worker account, D1 and Workflow bindings, timer and observability configuration.',
        'cloud/README.md': 'Dedicated cloud ownership, deployment, free-budget limits and recovery guidance.',
        'mobile/lib/main.dart': 'Flutter startup, Firebase/session bootstrap, provider and authenticated/onboarding root routing.',
        'mobile/lib/main_preview.dart': 'Deterministic mock-data visual-preview entry point for UI scenarios.',
        'mobile/lib/api/client.dart': 'Authenticated JSON/multipart transport, secure session/pending flow storage, timeout and reconnect handling.',
        'mobile/lib/api/models.dart': 'Dart JSON response models used by app state and screens.',
        'mobile/lib/state/app_state.dart': 'Observable account/status state, refresh, preparation and cross-screen navigation commands.',
        'mobile/lib/auth_return.dart': 'Desktop loopback sign-in return listener and cancellation.',
        'mobile/lib/auth_browser.dart': 'Shared OAuth launcher: HTTPS validation, browser-only Android bridge and external-browser fallback on other platforms.',
        'mobile/android/app/src/main/kotlin/com/linkdin/linkdin_mobile/AuthBrowser.kt': 'Finds general HTTP/HTTPS browsers using public intent filters and explicitly targets OAuth to a browser, excluding provider app links.',
        'mobile/android/app/src/test/kotlin/com/linkdin/linkdin_mobile/AuthBrowserTest.kt': 'Robolectric Android API 24/35 regression tests: provider-app interception, browser choices, missing browsers and invalid links.',
        'mobile/lib/android_notifications.dart': 'Android notification platform-channel helpers and payload handling.',
        'mobile/lib/desktop_notifications.dart': 'Desktop notification capability/handling abstraction.',
        'mobile/lib/push.dart': 'Firebase token registration, permission, foreground/background and notification-tap integration.',
        'mobile/lib/theme.dart': 'ByLine Flutter colors, typography, layout tokens and system chrome style.',
        'mobile/android/app/google-services.json': 'Firebase Android client project/app identifiers; not a service-account private key.',
        'mobile/android/app/build.gradle.kts': 'Android package variants, Dart-define routing, Firebase input, SDK defaults and release signing.',
        'mobile/android/app/src/main/kotlin/com/linkdin/linkdin_mobile/MainActivity.kt': 'Android Flutter host, native browser-only OAuth bridge and notification channel/platform integration.',
        'mobile/android/app/src/main/AndroidManifest.xml': 'Android permissions, application/activity identity, OAuth intent and notification metadata.',
    }
    if path in exact: return exact[path]
    if path.startswith('app/api/'):
        endpoint=path.removeprefix('app').removesuffix('/route.ts')
        if p.name=='redirect-uri.ts': return 'Resolves and validates the original LinkedIn callback URI for OAuth requests.'
        return 'Next.js App Router HTTP handler for '+endpoint+'. Validates request/authentication, delegates domain operations and returns the endpoint contract.'
    if path.startswith('lib/') and stem in LIB: return LIB[stem]
    if path.startswith('cloud/src/') and stem in CLOUD: return CLOUD[stem]
    if path.startswith('mobile/lib/screens/') and stem in SCREENS: return SCREENS[stem]
    if path.startswith('mobile/lib/widgets/') and stem in WIDGETS: return WIDGETS[stem]
    if '/scripts/' in '/' + path and stem in SCRIPTS: return SCRIPTS[stem]
    if path.startswith('reports/ui-preview/'):
        return f'Historical UI preview of {stem.rsplit("-", 1)[0]} at viewport width {stem.rsplit("-", 1)[-1]} pixels.'
    if path.startswith('reports/'):
        return 'Dated project evidence, plan or verification record: ' + stem.replace('ByLine-', '').replace('-', ' ') + '. Historical claims retain their original date.'
    if path.startswith('cloud/migrations/'):
        return 'D1 schema migration: ' + ('initial complete SQLite tables, ownership keys and indexes.' if '0001' in stem else 'durable jobs, AI reservation triggers and operational indexes.')
    if path.startswith('cloud/test/') or path.startswith('mobile/test/'):
        return ('Cloud Worker/D1 regression suite: ' if path.startswith('cloud/') else 'Flutter widget/transport regression suite: ') + stem.replace('.test', '').replace('_test', '').replace('_', ' ') + '. Exact test titles and assertions appear below.'
    if p.name == 'package.json': return 'npm package identity, direct dependency version ranges and executable task commands for ' + ('the cloud backend.' if path.startswith('cloud/') else 'the original backend.')
    if p.name == 'package-lock.json': return 'Exact npm dependency resolution tree, integrity hashes and platform packages for reproducible installation.'
    if p.name == 'pubspec.yaml': return 'Flutter package metadata, version, Dart constraint, direct plugins, font and asset declarations.'
    if p.name == 'pubspec.lock': return 'Exact resolved Dart/Flutter dependency versions and source checksums.'
    if p.name == 'tsconfig.json': return 'TypeScript compiler settings and included/excluded source scope for this package.'
    if p.name == '.gitignore': return 'Git exclusion rules for generated, private or local-only files in this directory scope.'
    if path.startswith('.github/workflows/'):
        return {'ci.yml': 'GitHub Actions root logic/type/build checks and disposable PostgreSQL integration tests.',
                'ci-mobile.yml': 'Path-filtered GitHub Actions Flutter analysis and tests.',
                'backup.yml': 'Scheduled original PostgreSQL encrypted backup artifact workflow.',
                'watchdog.yml': 'External scheduled original-backend health/reminder watchdog workflow.'}.get(p.name, 'Repository automation workflow.')
    if p.suffix == '.ttf': return 'Bundled ' + stem + ' font asset used by Flutter typography; see pubspec.yaml and theme.dart.'
    if p.name == 'OFL.txt': return 'Bundled font license terms.'
    if 'generated_plugin' in p.name: return 'Flutter-generated Windows native plugin registration/build linkage; regenerated from plugin dependencies.'
    if path.startswith('mobile/windows/'):
        return 'Windows Flutter host ' + {
            '.cpp':'implementation', '.h':'header', '.rc':'resource definition', '.ico':'application icon',
            '.manifest':'executable compatibility manifest', '.txt':'CMake build definition',
        }.get(p.suffix.lower(), 'configuration') + ' for ' + stem.replace('_', ' ') + '.'
    if 'ic_launcher' in p.name: return 'Android launcher icon at the resource density specified by its parent directory.'
    if 'ic_notification' in p.name: return 'Android monochrome notification status-bar icon vector.'
    if 'launch_background' in p.name: return 'Android launch/splash background drawable for this resource variant.'
    if p.name == 'styles.xml': return 'Android startup/normal activity theme for ' + ('dark mode.' if 'night' in path else 'default mode.')
    if p.name == 'AndroidManifest.xml': return 'Android ' + p.parent.name + ' build manifest overlay and permissions.'
    if path.startswith('mobile/android/'):
        return 'Android build/toolchain configuration: ' + p.name + '; controls ' + ('Gradle distribution bootstrap.' if 'wrapper' in path else 'project build and plugin setup.')
    if path.startswith('mobile/web/'):
        return 'Flutter web scaffold ' + ('icon/branding asset.' if p.suffix == '.png' else 'bootstrap document and application metadata.')
    if p.name == '.metadata': return 'Flutter project/platform creation metadata used by migration tooling.'
    if p.name == 'analysis_options.yaml': return 'Dart analyzer and Flutter lint configuration.'
    if p.name == 'README.md': return 'Directory-specific usage, asset provenance or platform instructions.'
    raise ValueError('Add a meaningful purpose for uncatalogued file: ' + path)


def parse_symbols(source):
    names = re.findall(r'^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|mixin|typedef)\s+([\w$]+)', source, re.M)
    names += re.findall(r'^export\s+(?:const|let)\s+(\w+)', source, re.M)
    return list(dict.fromkeys(names))


def parse_imports(source):
    return sorted(set(re.findall(r'''(?:from\s*|import\s*[(']|require\s*\()\s*['"]([^'"\n]+)['"]''', source)
                      + re.findall(r'''^\s*(?:import|export)\s+['"]([^'"\n]+)['"]''', source, re.M)))


def tests_in(source):
    return re.findall(r'''\b(?:test|testWidgets|group|describe)\s*\(\s*['"]([^'"\n]+)['"]''', source)


def records():
    paths = sorted(set(git_files()) | DERIVED)
    result = []
    for path in paths:
        entry = {'path': path, 'purpose': purpose(path), 'derived': path in DERIVED}
        file = ROOT / path
        if path not in DERIVED and file.exists():
            raw = file.read_bytes()
            entry.update(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
            if file.suffix.lower() not in BINARY:
                source = raw.decode('utf-8-sig')
                entry.update(lines=len(source.splitlines()), lf_sha256=hashlib.sha256(raw.replace(b'\r\n',b'\n')).hexdigest(), symbols=parse_symbols(source), imports=parse_imports(source), tests=tests_in(source))
        result.append(entry)
    return result


styles = getSampleStyleSheet()
styles.add(ParagraphStyle('BodyText2', fontName='Helvetica', fontSize=9.5, leading=14, spaceAfter=8, splitLongWords=True))
styles.add(ParagraphStyle('Small2', fontName='Helvetica', fontSize=8, leading=11, spaceAfter=5, splitLongWords=True))
styles.add(ParagraphStyle('Code2', fontName='Courier', fontSize=7, leading=9))
styles.add(ParagraphStyle('FileHead', fontName='Helvetica-Bold', fontSize=11, leading=15, textColor=colors.HexColor('#145a65'), spaceBefore=13, spaceAfter=7, keepWithNext=True, splitLongWords=True))
styles['Heading1'].fontName = 'Helvetica-Bold'; styles['Heading1'].fontSize=19; styles['Heading1'].leading=24
styles['Heading1'].textColor=colors.HexColor('#123e46'); styles['Heading1'].spaceAfter=15
styles['Heading2'].fontSize=12; styles['Heading2'].leading=17
STORY=[]; MD=[]; ANCHORS=0


def para(text, small=False):
    STORY.append(Paragraph(html.escape(clean(text)), styles['Small2' if small else 'BodyText2']))


def heading(text, level=1, breakpage=False, toc=True):
    global ANCHORS
    if breakpage: STORY.append(PageBreak())
    ANCHORS += 1
    item=Paragraph(html.escape(clean(text)), styles['Heading1' if level==1 else 'FileHead'])
    item._anchor='section-'+str(ANCHORS); item._title=clean(text); item._level=level; item._toc=toc
    STORY.append(item)


def code(source, numbered=True):
    lines=[]
    for num,line in enumerate(source.splitlines(),1):
        # Display every character, using ASCII escapes for non-ASCII codepoints.
        # Never truncate long source lines; continuation lines retain their association.
        prefix=f'{num:5} | ' if numbered else ''
        text=clean(line.expandtabs(4))
        chunks=textwrap.wrap(text,width=108-len(prefix),replace_whitespace=False,drop_whitespace=False,break_on_hyphens=False) or ['']
        lines.append(prefix+chunks[0])
        lines.extend(('      > ' if numbered else '  ')+chunk for chunk in chunks[1:])
    # Small splittable blocks avoid huge layout objects for long application files.
    for i in range(0,len(lines),70): STORY.append(Preformatted('\n'.join(lines[i:i+70]),styles['Code2']))


def markdown(source):
    buffer=[]; in_code=False; code_lines=[]
    def flush():
        if buffer: para(' '.join(buffer)); buffer.clear()
    for line in source.splitlines():
        if line.startswith('```'):
            flush()
            if in_code: code('\n'.join(code_lines),False); code_lines=[]
            in_code=not in_code; continue
        if in_code: code_lines.append(line); continue
        if line.startswith('# '): continue
        if line.startswith('## '): flush(); heading(line[3:],1,True); continue
        if line.startswith('### '): flush(); heading(line[4:],2,toc=False); continue
        if not line.strip(): flush(); continue
        if re.match(r'^(\d+\.|[-*]) ',line): flush(); para(line); continue
        buffer.append(line.strip())
    flush()


class Handbook(BaseDocTemplate):
    def __init__(self,path):
        super().__init__(str(path),pagesize=A4,rightMargin=47,leftMargin=47,topMargin=49,bottomMargin=43,
                         title='ByLine - Complete Project Handbook',author='ByLine project',pageCompression=1)
        self.addPageTemplates(PageTemplate(id='main',frames=[Frame(self.leftMargin,self.bottomMargin,self.width,self.height,id='body',leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)],onPage=self.page))
    def page(self,c,doc):
        c.saveState(); c.setStrokeColor(colors.HexColor('#c9d9d9')); c.line(47, A4[1]-34, A4[0]-47,A4[1]-34)
        c.setFont('Helvetica',8); c.setFillColor(colors.HexColor('#53666a'))
        c.drawString(47,A4[1]-27,'BYLINE / COMPLETE PROJECT HANDBOOK')
        c.drawString(47,26,'Source snapshot: '+DATE); c.drawRightString(A4[0]-47,26,str(doc.page)); c.restoreState()
    def afterFlowable(self,flow):
        if hasattr(flow,'_anchor'):
            self.canv.bookmarkPage(flow._anchor)
            self.canv.addOutlineEntry(flow._title,flow._anchor,level=flow._level-1,closed=True)
            if flow._toc and flow._level==1: self.notify('TOCEntry',(0,flow._title,self.page,flow._anchor))


def npm_reference(path):
    lock=json.loads((ROOT/path).read_text('utf-8'))
    for name,item in sorted(lock.get('packages',{}).items()):
        if not name: continue
        deps=item.get('dependencies',{})
        yield f'{name} | version={item.get("version","workspace")} | dev={item.get("dev",False)} | optional={item.get("optional",False)} | license={item.get("license","not recorded")}'
        if item.get('engines'): yield '  engines: '+json.dumps(item['engines'],sort_keys=True)
        if item.get('os') or item.get('cpu'): yield '  platform: '+json.dumps({k:item[k] for k in ['os','cpu'] if k in item})
        if deps: yield '  requires: '+', '.join(k+' '+v for k,v in sorted(deps.items()))
        if item.get('peerDependencies'): yield '  peers: '+json.dumps(item['peerDependencies'],sort_keys=True)
        if item.get('integrity'): yield '  integrity: '+item['integrity']
        if item.get('resolved'): yield '  resolved: '+item['resolved']


def main():
    OUT.parent.mkdir(parents=True,exist_ok=True)
    entries=records()
    INVENTORY.write_text(json.dumps({'snapshot_date':DATE,'policy':'All Git-tracked and non-ignored working files. sha256 hashes workstation bytes; lf_sha256 normalizes CRLF to LF for cross-platform Git comparisons. Derived document artifacts are listed without self-referential hashes.','files':entries},indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    source_entries=[e for e in entries if 'lines' in e and e['path'] not in {'docs/handbook.md'} and not e['path'].endswith('package-lock.json')]
    total_lines=sum(e['lines'] for e in source_entries)
    base=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    STORY.extend([Spacer(1,95),Paragraph('BYLINE',ParagraphStyle('Cover',fontName='Helvetica-Bold',fontSize=44,leading=50,textColor=colors.HexColor('#123e46'))),Spacer(1,22)])
    para('THE COMPLETE PROJECT HANDBOOK')
    para('Architecture, every file, technology usage, Android installation and operations. Condensed reading edition.')
    STORY.append(Spacer(1,20)); para(DATE)
    para(f'Every one of the {len(entries)} repository files is catalogued. Both npm dependency inventories are included. The companion repository reference preserves {len(source_entries)} full text listings and {total_lines:,} source lines without inflating this PDF.')
    para('Includes an installable signed Android APK in releases/android/byline-latest.apk. See the embedded release record for its verified identity and checksum.')
    para('Baseline commit before this documentation/release packaging: '+base,True)
    para('Working-source hashes in docs/repository-inventory.json identify the exact packaged source independently of that baseline. The final Git commit also contains this document.',True)
    heading('Contents',1,True,False)
    toc=TableOfContents(); toc.levelStyles=[ParagraphStyle('TOC',fontName='Helvetica',fontSize=9,leading=13,spaceBefore=4,leftIndent=0,firstLineIndent=0)]
    STORY.append(toc)
    markdown((ROOT/'docs/handbook.md').read_text('utf-8'))
    heading('26. Release metadata and fresh verification',1,True)
    for path in ['releases/android/release.json','reports/ByLine-auth-onboarding-fix-2026-11-07.md']:
        if (ROOT/path).exists():
            heading(path,2,toc=False)
            text=(ROOT/path).read_text('utf-8')
            if path.endswith('.json'): code(text,False)
            else:
                for block in text.split('\n\n'):
                    if block.strip(): para(block.replace('\n',' ').lstrip('# '))
    heading('27. Complete file catalogue',1,True)
    para('Every tracked or non-ignored project file is listed below. Private/generated dependencies and local runtime data are excluded by Git rules. Derived handbook artifacts are listed without recursive content/hashes. Binary assets have metadata instead of source text. The JSON inventory has full SHA-256 values for every non-derived file. Imports are collected in chapter 29 and the companion reference.')
    MD.append('# ByLine generated complete reference\n\nGenerated from publishable repository files on '+DATE+'.\n')
    MD.append('## Complete file catalogue\n')
    for e in entries:
        heading(e['path'],2,toc=False); para(e['purpose'])
        meta=f'{e.get("bytes","generated")} bytes'
        if 'lines' in e: meta+=f'; {e["lines"]} lines'
        para(meta,True)
        if 'sha256' in e: meta+='; SHA-256 '+e['sha256']
        if e.get('symbols'): para('Declared symbols: '+', '.join(e['symbols']),True)
        MD.extend(['### '+e['path']+'\n',e['purpose']+'\n',meta+'\n'])
        if e.get('symbols'): MD.append('Declared symbols: '+', '.join(e['symbols'])+'\n')
        if e.get('imports'): MD.append('Imports: '+', '.join(e['imports'])+'\n')
    heading('28. Direct packages and exact resolved dependencies',1,True)
    for path in ['package.json','cloud/package.json','mobile/pubspec.yaml']:
        heading(path,2,toc=False); code((ROOT/path).read_text('utf-8'),False)
    para('The following npm inventories preserve every resolved package path (including nested/platform variants), version, flags, dependencies, peers, engine/platform restrictions, source URL and integrity. They are complete package-entry inventories, not third-party implementation source. Flutter exact resolutions are in mobile/pubspec.lock and the companion repository source reference.')
    for path in ['package-lock.json','cloud/package-lock.json']:
        heading(path,2,toc=False)
        lines='\n'.join(npm_reference(path)); code(lines,False)
        MD.extend(['## Resolved dependencies: '+path+'\n','```text\n'+lines+'\n```\n'])
    heading('29. Import and configuration-use index',1,True)
    imports=collections.defaultdict(list); variables=collections.defaultdict(set)
    for e in entries:
        for module in e.get('imports',[]): imports[module].append(e['path'])
        if 'lines' not in e: continue
        for number,line in enumerate((ROOT/e['path']).read_text('utf-8-sig').splitlines(),1):
            names=re.findall(r'process\.env\.([A-Z][A-Z0-9_]+)|\benv\.([A-Z][A-Z0-9_]+)|\$env:([A-Z][A-Z0-9_]+)|fromEnvironment\([\s]*[\'"]([A-Z][A-Z0-9_]+)',line)
            for group in names:
                name=next(x for x in group if x); variables[name].add(f'{e["path"]}:{number}')
        # Multiline Dart environment declarations.
        for name in re.findall(r'''fromEnvironment\(\s*['"]([A-Z][A-Z0-9_]+)''',(ROOT/e['path']).read_text('utf-8-sig')): variables[name].add(e['path'])
    para('This syntactic index covers static imports and literal environment accesses. Dynamically computed names, CLI flags and generated platform bindings are additionally documented by their source/config files. Values are never read from private environment files.')
    for name,locations in sorted(variables.items()):
        para(name+' - '+'; '.join(sorted(locations)),True)
    heading('Module/package imports and users',2,toc=False)
    for name,users in sorted(imports.items()): para(name+' - '+'; '.join(users),True)
    MD.append('## Environment-use index\n'+json.dumps({k:sorted(v) for k,v in variables.items()},indent=2)+'\n')
    heading('30. API and schema navigation index',1,True)
    for e in entries:
        if re.match(r'app/api/.+/route\.ts$',e['path']):
            source=(ROOT/e['path']).read_text('utf-8-sig')
            methods=re.findall(r'export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)',source)
            para(e['path'].replace('app','',1).replace('/route.ts','')+' - '+', '.join(methods)+' - '+e['path'],True)
    para('Cloud method dispatch, including its public/authenticated boundary, is reproduced verbatim below. Dynamic post and slot paths are validated by regular expressions.')
    code((ROOT/'cloud/src/index.ts').read_text('utf-8'))
    heading('Database table responsibilities',2,toc=False)
    for name,description in sorted(TABLES.items()): para(name+' - '+description)
    for path in ['cloud/migrations/0001_initial.sql','cloud/migrations/0002_cloud_jobs.sql']:
        heading(path,2,toc=False); code((ROOT/path).read_text('utf-8'))
    heading('31. Test case index',1,True)
    for e in entries:
        if e.get('tests'):
            heading(e['path'],2,toc=False)
            for title in e['tests']: para(title,True)
    para('The index extracts literal test/group titles. Assertion labels, dynamically generated cases and complete test bodies are preserved in the companion source reference.')
    heading('32. Finding the exact implementation',1,True)
    para('This reading edition retains the explanations, every-file catalogue, dependency inventories, configuration/import index, API navigation, D1 schema and test-case index. The thousands of lines of raw application code are available as a separate searchable repository reference, rather than repeated in this PDF.')
    STORY.append(Paragraph('<link href="https://github.com/Don-Gabriel/link_agent/blob/main/docs/generated-reference.md" color="#145a65">Open the complete source reference on GitHub</link>',styles['BodyText2']))
    para('Repository path: docs/generated-reference.md. Download the raw Markdown if GitHub truncates its preview. It contains the full project-owned text listings, historical reports and lockfile resolution details. Individual files remain available at their paths in the repository.')
    for title,description in [
        ('A screen or interaction','Find its mobile/lib/screens or mobile/lib/widgets path in chapter 27, then follow its imports to AppState and ApiClient.'),
        ('An endpoint or validation rule','Use chapter 30 for method/path routing; inspect the named cloud/src handler or app/api route in the companion reference.'),
        ('A database field or concurrency rule','Use the D1 schema in chapter 30; inspect lib/schema.ts for PostgreSQL and the relevant adapter for transaction behavior.'),
        ('An AI prompt or editorial edge case','Inspect lib/writer-core.ts, lib/judge-core.ts, lib/critique.ts and the deployment-specific AI adapter.'),
        ('A package, configuration key or helper','Use chapters 28-29 for versions and usage locations, then the complete source file for the exact branch.'),
        ('A historical decision or test assertion','Use reports/ for dated evidence, chapter 31 for test titles and the source reference for complete assertions.'),
    ]:
        heading(title,2,toc=False);para(description)
    para('The inventory records source hashes, including LF-normalized text hashes for cross-platform comparison. Source snippets printed in this PDF use line numbers and wrap long lines; the repository contains the original bytes. Historical comments and reports may describe an earlier implementation.')
    for e in source_entries:
        source=(ROOT/e['path']).read_text('utf-8-sig')
        MD.extend(['## Source: '+e['path']+'\n','````text\n'+source+'\n````\n'])
    heading('33. Mobile UI preview gallery',1,True)
    para('One historical phone-width preview per screen is shown. These are design previews already in the repository, not fresh APK captures. Desktop/tablet variants remain in reports/ui-preview and in the file catalogue.')
    first_preview=True
    for e in entries:
        if e['path'].startswith('reports/ui-preview/') and e['path'].endswith('-390.png'):
            heading(e['path'],2,not first_preview,toc=False)
            first_preview=False
            img=Image(str(ROOT/e['path'])); scale=min(490/img.imageWidth,580/img.imageHeight)
            img.drawWidth=img.imageWidth*scale; img.drawHeight=img.imageHeight*scale; STORY.append(img)
    heading('34. Scope and source integrity',1,True)
    para(f'PDF catalogue: {len(entries)} files. Companion source reference: {len(source_entries)} full text listings and {total_lines:,} original lines. Both npm lockfiles are fully indexed in the PDF. Binary assets are accounted for by path, role, byte size and SHA-256; selected phone previews are rendered in the gallery.')
    para('Excluded from publication: Git internals, populated .env files, node_modules, Flutter/Android/Next build caches, local databases, private signing keys, service-account credentials and generated local Worker binding types. These are dependencies, secrets or runtime data, not omitted project source. Recreate generated dependencies with the documented setup commands and restore secrets from authorized secure storage.')
    para('This is a source snapshot rather than a warranty about changing third-party services. For any exact condition, use the file catalogue and companion source reference; for subsequent changes use Git history. The generated Markdown reference retains the exhaustive source material outside this condensed PDF.')
    REFERENCE.write_text('\n'.join(MD),encoding='utf-8')
    Handbook(OUT).multiBuild(STORY)
    reader=PdfReader(str(OUT))
    if not 100 <= len(reader.pages) <= 120:
        raise ValueError(f'Condensed handbook must be 100-120 pages; got {len(reader.pages)}')
    stats={'date':DATE,'files_catalogued':len(entries),'full_text_files':len(source_entries),'source_lines':total_lines,
           'edition':'condensed','source_listings_location':'docs/generated-reference.md',
           'pages':len(reader.pages),'pdf_bytes':OUT.stat().st_size,'pdf_sha256':hashlib.sha256(OUT.read_bytes()).hexdigest(),
           'baseline_commit':base,'source_inventory':'docs/repository-inventory.json'}
    (ROOT/'docs/handbook-build.json').write_text(json.dumps(stats,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(stats,indent=2))


if __name__=='__main__': main()
