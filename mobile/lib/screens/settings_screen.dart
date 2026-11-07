/// Everything you set once and revisit — behind one index.
///
/// Three of the old five bottom-bar destinations were configuration, each
/// holding a permanent seat for something touched once a month. They are rows
/// here instead, and every row carries a LIVE SUMMARY: the timezone and the
/// posting times, the voice in a phrase, the topics, whether LinkedIn is
/// connected and for how much longer. Most questions this screen exists to
/// answer are answered without opening anything.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../auth_browser.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/experience.dart';
import '../widgets/form_select.dart';
import '../widgets/profile_card.dart';
import '../widgets/personal_topics.dart';
import '../widgets/primitives.dart';
import 'timetable_screen.dart';
import 'voice_screen.dart';
import 'delivery_settings_screen.dart';
import 'delete_account_screen.dart';

/// Fallback labels, used only when the server has not sent its categories yet —
/// a cold start, or a backend too old to serve them. The live list comes from
/// /api/status so adding a category needs no client release.
///
/// It has to list every id, not just the ones an early build shipped with: when
/// this held only the three original ids, a cold start rendered a picker with
/// four categories missing and no hint they existed.
const _fallbackCategoryLabels = {
  'music-tech-software': 'Music tech — software',
  'music-tech-hardware': 'Music tech — hardware',
  'emerging-tech': 'Emerging tech',
  'ai-ml': 'AI & ML engineering',
  'dev-tooling': 'Developer tooling',
  'hardware-embedded': 'Hardware & embedded',
  'compute-silicon': 'Compute & silicon',
};

/// When a quiet watchdog actually means something is wrong.
///
/// This was 90 minutes, against a watchdog that runs every THREE HOURS
/// (`.github/workflows/watchdog.yml`, `cron: "0 */3 * * *"`). A perfectly
/// healthy agent therefore spent half of every cycle showing a red alarm
/// saying the watchdog may have stopped — which is worse than no check at all,
/// because an alarm that cries wolf on schedule is one you learn to ignore.
///
/// Four hours: the 180-minute cadence, plus the 15-30 minutes GitHub's cron
/// routinely runs late (the workflow's own comments call this out), plus
/// margin. A genuinely dead watchdog still surfaces within about an hour.
const int kWatchdogStaleMinutes = 240;

/// The shared shape of every settings page: a plain title, a scrolling body,
/// and nothing else competing with it.
class SettingsPage extends StatefulWidget {
  const SettingsPage({
    super.key,
    required this.title,
    required this.children,
    this.blurb,
  });

  final String title;
  final String? blurb;
  final List<Widget> children;

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  @override
  void initState() {
    super.initState();
    // Every page in here is a READOUT of status fetched somewhere else, and
    // some of it is time-sensitive — "last health check, 162 minutes ago" was
    // being rendered from a payload hours old, on an agent that had checked in
    // four minutes earlier. Quiet, so it does not flash a spinner over a screen
    // that already has content to show.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<AppState>().refresh(quiet: true);
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: SafeArea(
        child: PageSurface(
          child: RefreshIndicator(
            onRefresh: state.refresh,
            backgroundColor: C.ink2,
            color: C.filament,
            child: ListView(
              padding: const EdgeInsets.fromLTRB(S.x4, S.x5, S.x4, S.x6),
              children: [
                if (widget.blurb != null) ...[
                  Text(widget.blurb!, style: T.small),
                  const SizedBox(height: S.x5),
                ],
                ...widget.children,
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Jump straight to the page that owns a problem.
///
/// The Desk raises conditions but does not fix them; these are how a
/// one-line strip up there leads to the controls down here.
void openTimetable(BuildContext context) => Navigator.of(
  context,
).push(MaterialPageRoute(builder: (_) => const TimetableScreen()));

void openLinkedIn(BuildContext context) => Navigator.of(
  context,
).push(MaterialPageRoute(builder: (_) => const LinkedInScreen()));

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key, this.scrollController});
  final ScrollController? scrollController;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final status = state.status;
    final agent = state.agent;

    if (status == null || agent == null) {
      return const Center(child: CircularProgressIndicator());
    }

    final labels = availableCategories(state);
    final chosen = labels.keys.where(agent.categories.contains).toList();

    return ListView(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 32),
      children: [
        const ProfileCard(),
        const Divider(height: 24),
        FormSection(
          title: 'Writing preferences',
          description: 'Make every suggestion sound more like you.',
          child: Column(
            children: [
              NavRow(
                label: 'Voice',
                icon: Icons.edit_note,
                value: state.style.summary,
                onTap: () => _open(context, const VoiceScreen()),
              ),
              const Divider(),
              NavRow(
                label: 'Topics',
                icon: Icons.interests_outlined,
                value: chosen.isEmpty
                    ? 'Choose your interests'
                    : chosen.map((id) => labels[id] ?? id).join(' · '),
                onTap: () => _open(context, const TopicsScreen()),
              ),
            ],
          ),
        ),
        const Divider(height: 24),
        FormSection(
          title: 'Schedule & notifications',
          child: Column(
            children: [
              if (state.api.isNativeSession) ...[
                NavRow(
                  label: 'Notifications',
                  icon: Icons.notifications_none,
                  value: '${agent.postTimeLocal} · ${agent.timezone}',
                  onTap: () => _open(context, const DeliverySettingsScreen()),
                ),
                const Divider(),
              ],
              NavRow(
                label: 'Timetable',
                icon: Icons.event_note,
                value: _timetableSummary(status, agent),
                tone: status.scheduler.healthy ? null : Tone.broken,
                onTap: () => _open(context, const TimetableScreen()),
              ),
            ],
          ),
        ),
        const Divider(height: 24),
        FormSection(
          title: 'Account',
          child: Column(
            children: [
              NavRow(
                label: 'LinkedIn',
                icon: status.account.usable ? Icons.link : Icons.link_off,
                value: _accountSummary(status.account),
                tone: status.account.usable ? Tone.out : Tone.broken,
                onTap: () => _open(context, const LinkedInScreen()),
              ),
              const Divider(),
              NavRow(
                label: 'Diagnostics',
                icon: Icons.monitor_heart_outlined,
                value:
                    'Model usage, health checks, ${status.cycleCount} cycles run',
                onTap: () => _open(context, const DiagnosticsScreen()),
              ),
              const Divider(),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.logout),
                title: const Text('Sign out'),
                onTap: state.signOut,
              ),
              if (state.api.isNativeSession)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.delete_outline, color: C.flare),
                  title: const Text(
                    'Delete ByLine account',
                    style: TextStyle(color: C.flare),
                  ),
                  onTap: () => _open(context, const DeleteAccountScreen()),
                ),
            ],
          ),
        ),
      ],
    );
  }

  static void _open(BuildContext context, Widget page) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  static String _timetableSummary(AppStatus status, Agent agent) {
    if (!status.scheduler.healthy) {
      return status.scheduler.neverRan
          ? 'The scheduler never started — no posting time will fire'
          : 'The scheduler stopped — posting times will not fire';
    }
    if (agent.paused) return 'Paused · ${agent.timezone}';
    final on = status.slots.where((s) => s.enabled).toList();
    if (on.isEmpty) return 'No posting times set · ${agent.timezone}';
    final times = on.map((s) => s.localTime).join(', ');
    return '$times · ${agent.timezone}';
  }

  static String _accountSummary(Account account) {
    if (!account.connected) return 'Not connected — nothing can publish';
    if (account.needsReauth) {
      return 'Access expired — reconnect to resume posting';
    }
    final days = account.daysRemaining;
    final who = account.memberName ?? 'Connected';
    return days == null ? who : '$who · $days days of access left';
  }
}

/// The categories to offer, preferring the server's list.
///
/// Falls back to the built-in map only when the server has sent none. Any
/// category the agent already has selected but the server did not list is
/// appended, so an id this build does not recognise stays visible and removable
/// rather than silently vanishing from the picker.
Map<String, String> availableCategories(AppState state) {
  final served = state.status?.categories ?? const <CategoryInfo>[];
  final out = <String, String>{};
  if (served.isEmpty) {
    out.addAll(_fallbackCategoryLabels);
  } else {
    for (final c in served) {
      out[c.id] = c.groupLabel == null
          ? c.label
          : '${c.label} · ${c.groupLabel}';
    }
  }
  for (final id in state.agent?.categories ?? const <String>[]) {
    out.putIfAbsent(id, () => id);
  }
  return out;
}

// ------------------------------------------------------------------- topics

class TopicsScreen extends StatelessWidget {
  const TopicsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final agent = state.agent;
    if (agent == null) return const SettingsPage(title: 'Topics', children: []);
    final labels = availableCategories(state);

    return SettingsPage(
      title: 'Topics',
      blurb: 'Make room for the subjects that matter to you.',
      children: [
        const PersonalTopics(),
        const SizedBox(height: 32),
        const SectionRule('Source coverage'),
        const Text(
          'Search the subject catalogue and choose up to 12 areas. Your selection guides which articles become drafts.',
          style: T.small,
        ),
        const SizedBox(height: 16),
        MultiSelectField(
          label: 'Source coverage',
          options: labels,
          values: agent.categories,
          max: 12,
          onChanged: state.loading ? null : (v) => state.setCategories(v),
        ),
        if (agent.categories.length == 1) ...[
          const SizedBox(height: S.x4),
          Text(
            'Keep at least one subject selected to receive relevant drafts.',
            style: T.micro,
          ),
        ],
        if (state.error != null) ErrorNote(state.error!),
      ],
    );
  }
}

// ----------------------------------------------------------------- linkedin

/// Connect or disconnect LinkedIn, from the phone.
///
/// Consent is an OAuth redirect and genuinely cannot happen inside the app's
/// own HTTP client — the screen needs a real browser, and the session that
/// comes back has to belong to one. So the app asks the server for the consent
/// URL (`/api/linkedin/connect?json=1`, which answers with the URL instead of a
/// 302) and hands it to the system browser.
class LinkedInScreen extends StatefulWidget {
  const LinkedInScreen({super.key});

  @override
  State<LinkedInScreen> createState() => _LinkedInScreenState();
}

class _LinkedInScreenState extends State<LinkedInScreen> {
  bool _busy = false;

  Future<void> _connect() async {
    final state = context.read<AppState>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _busy = true);
    final url = await state.linkedInConsentUrl();
    if (!mounted) return;
    setState(() => _busy = false);

    if (url == null) {
      messenger.showSnackBar(
        const SnackBar(
          content: Text(
            'Could not start the connection. Is the server reachable?',
          ),
        ),
      );
      return;
    }

    final opened = await openAuthBrowser(Uri.parse(url));
    if (!mounted) return;
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          opened
              ? 'Finish in your browser. ByLine will refresh when you return.'
              : 'No browser could open the LinkedIn page.',
        ),
      ),
    );
  }

  Future<void> _confirmDisconnect() async {
    final state = context.read<AppState>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Disconnect LinkedIn?'),
        content: const Text(
          'The stored token is deleted and nothing can publish until you reconnect. '
          'Your drafts and history are untouched.',
          style: T.small,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: C.flare,
              foregroundColor: C.paper,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    final messenger = ScaffoldMessenger.of(context);
    final error = await state.disconnectLinkedIn();
    messenger.showSnackBar(SnackBar(content: Text(error ?? 'Disconnected.')));
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final account = state.status?.account;
    if (account == null) {
      return const SettingsPage(title: 'LinkedIn', children: []);
    }

    final busy = _busy || state.loading;
    final connected = account.connected;

    return SettingsPage(
      title: 'LinkedIn',
      children: [
        Row(
          children: [
            Icon(
              account.usable ? Icons.check_circle_outline : Icons.error_outline,
              size: 18,
              color: account.usable ? C.daylight : C.flare,
            ),
            const SizedBox(width: S.x2),
            Expanded(
              child: Text(
                connected
                    ? (account.memberName ?? 'Connected')
                    : 'Not connected',
                style: T.body,
              ),
            ),
          ],
        ),
        if (account.daysRemaining != null) ...[
          const SizedBox(height: S.x2),
          Text(
            'Access valid for ${account.daysRemaining} more days. LinkedIn tokens last '
            '60 days and cannot refresh themselves.',
            style: T.small,
          ),
        ],
        const SizedBox(height: S.x5),
        Row(
          children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: busy ? null : _connect,
                icon: const Icon(Icons.link, size: 17),
                // Reconnecting an expiring token is the same round trip as a
                // first connection, but calling it "Connect" when something is
                // already connected reads as though it would replace nothing.
                label: Text(connected ? 'Reconnect' : 'Connect LinkedIn'),
              ),
            ),
            if (connected) ...[
              const SizedBox(width: S.x2),
              OutlinedButton(
                onPressed: busy ? null : _confirmDisconnect,
                child: const Text('Disconnect'),
              ),
            ],
          ],
        ),
        const SizedBox(height: S.x2),
        Text(
          connected
              ? 'Reconnecting opens LinkedIn in your browser and issues a fresh 60-day token.'
              : 'Opens LinkedIn in your browser to approve posting access.',
          style: T.micro,
        ),
        if (account.lastError != null) ErrorNote(account.lastError!),
      ],
    );
  }
}

// -------------------------------------------------------------- diagnostics

class DiagnosticsScreen extends StatelessWidget {
  const DiagnosticsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final status = state.status;
    if (status == null) {
      return const SettingsPage(title: 'Diagnostics', children: []);
    }

    final watchdog = status.watchdogMinutesSince;

    return SettingsPage(
      title: 'Diagnostics',
      children: [
        const SectionRule('Model usage today'),
        Text(
          'Quotas are per model, so the cascade stacks them.',
          style: T.micro,
        ),
        const SizedBox(height: S.x3),
        if (status.llm.isEmpty)
          Text('No model calls recorded today.', style: T.small)
        else
          for (final usage in status.llm)
            Readout(
              usage.model,
              usage.cap > 0
                  ? '${usage.calls} / ${usage.cap}'
                  : '${usage.calls}',
            ),
        const SizedBox(height: S.x5),

        const SectionRule('Health'),
        // The safety net's own pulse. The watchdog is what notices the agent
        // dying; nothing noticed the watchdog dying, and it runs somewhere that
        // switches scheduled jobs off after sixty quiet days. A number that
        // keeps climbing here is the only sign that would ever appear.
        if (watchdog != null)
          Readout(
            'Last health check',
            '$watchdog min ago',
            tone: watchdog < kWatchdogStaleMinutes ? Tone.out : Tone.broken,
          ),
        if (watchdog != null && watchdog >= kWatchdogStaleMinutes) ...[
          const SizedBox(height: S.x2),
          Text(
            'Nothing has pinged the health check in over four hours — the watchdog '
            'itself may have stopped. Check the schedule on the watchdog workflow.',
            style: T.micro.copyWith(color: C.flare),
          ),
        ],
        Readout(
          'Scheduler',
          status.scheduler.healthy ? 'running' : 'stopped',
          tone: status.scheduler.healthy ? Tone.out : Tone.broken,
        ),
        Readout('Cycles run', '${status.cycleCount}'),
        const SizedBox(height: S.x5),

        const SectionRule('Server'),
        Text(state.baseUrl, style: T.mono),
      ],
    );
  }
}
