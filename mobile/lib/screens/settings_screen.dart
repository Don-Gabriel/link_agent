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
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/primitives.dart';
import 'timetable_screen.dart';
import 'voice_screen.dart';

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
        child: RefreshIndicator(
          onRefresh: state.refresh,
          backgroundColor: C.ink2,
          color: C.filament,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(S.x4, S.x2, S.x4, S.x7),
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
    );
  }
}

/// Jump straight to the page that owns a problem.
///
/// The Desk raises conditions but does not fix them; these are how a
/// one-line strip up there leads to the controls down here.
void openTimetable(BuildContext context) =>
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const TimetableScreen()));

void openLinkedIn(BuildContext context) =>
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LinkedInScreen()));

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

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
      padding: const EdgeInsets.fromLTRB(S.x4, S.x4, S.x4, S.x7),
      children: [
        const Text('Settings', style: T.title),
        const SizedBox(height: S.x2),
        // The agent's name is a proper noun, not a section label.
        Text(agent.name, style: T.body.copyWith(color: C.paperDim)),
        const SizedBox(height: S.x5),

        const SectionRule('How it runs'),
        NavRow(
          label: 'Timetable',
          icon: Icons.schedule,
          value: _timetableSummary(status, agent),
          tone: status.scheduler.healthy ? null : Tone.broken,
          onTap: () => _open(context, const TimetableScreen()),
        ),
        const Divider(),
        NavRow(
          label: 'Voice',
          icon: Icons.tune,
          value: state.style.summary,
          onTap: () => _open(context, const VoiceScreen()),
        ),
        const Divider(),
        NavRow(
          label: 'Topics',
          icon: Icons.category_outlined,
          value: chosen.isEmpty
              ? 'Nothing selected — it has nothing to look for'
              : chosen.map((id) => labels[id] ?? id).join(' · '),
          tone: chosen.isEmpty ? Tone.broken : null,
          onTap: () => _open(context, const TopicsScreen()),
        ),
        const SizedBox(height: S.x5),

        const SectionRule('Connection'),
        NavRow(
          label: 'LinkedIn',
          icon: status.account.usable ? Icons.link : Icons.link_off,
          value: _accountSummary(status.account),
          tone: status.account.needsReauth
              ? Tone.broken
              : status.account.expiringSoon
                  ? Tone.desk
                  : status.account.usable
                      ? Tone.out
                      : Tone.broken,
          onTap: () => _open(context, const LinkedInScreen()),
        ),
        const Divider(),
        NavRow(
          label: 'Diagnostics',
          icon: Icons.monitor_heart_outlined,
          value: 'Model usage, health checks, ${status.cycleCount} cycles run',
          onTap: () => _open(context, const DiagnosticsScreen()),
        ),
        const SizedBox(height: S.x6),

        const SectionRule('Session'),
        Text(state.baseUrl, style: T.mono),
        const SizedBox(height: S.x3),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton(onPressed: state.signOut, child: const Text('Sign out')),
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
    if (account.needsReauth) return 'Access expired — reconnect to resume posting';
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
      out[c.id] = c.label;
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
      blurb: 'Discovery pulls from these, the judge scores against them, and the agent '
          'describes itself by them. Changing this list changes what it thinks it is about.',
      children: [
        Wrap(
          spacing: S.x2,
          runSpacing: S.x2,
          children: [
            for (final entry in labels.entries)
              PickChip(
                label: entry.value,
                selected: agent.categories.contains(entry.key),
                // Refuse to remove the last one: an agent with no topics
                // discovers nothing and looks exactly like a broken cron.
                enabled: !state.loading &&
                    !(agent.categories.contains(entry.key) && agent.categories.length == 1),
                onTap: () {
                  final next = agent.categories.contains(entry.key)
                      ? (agent.categories.toList()..remove(entry.key))
                      : [...agent.categories, entry.key];
                  state.setCategories(next);
                },
              ),
          ],
        ),
        if (agent.categories.length == 1) ...[
          const SizedBox(height: S.x4),
          Text(
            'One topic left. It has to keep at least one, or there is nothing to read.',
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
        const SnackBar(content: Text('Could not start the connection. Is the server reachable?')),
      );
      return;
    }

    final opened = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!mounted) return;
    messenger.showSnackBar(
      SnackBar(
        content: Text(opened
            ? 'Approve it in the browser, then come back and pull to refresh.'
            : 'No browser could open the LinkedIn page.'),
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
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: C.flare, foregroundColor: C.paper),
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
    if (account == null) return const SettingsPage(title: 'LinkedIn', children: []);

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
                connected ? (account.memberName ?? 'Connected') : 'Not connected',
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
    if (status == null) return const SettingsPage(title: 'Diagnostics', children: []);

    final watchdog = status.watchdogMinutesSince;

    return SettingsPage(
      title: 'Diagnostics',
      children: [
        const SectionRule('Model usage today'),
        Text('Quotas are per model, so the cascade stacks them.', style: T.micro),
        const SizedBox(height: S.x3),
        if (status.llm.isEmpty)
          Text('No model calls recorded today.', style: T.small)
        else
          for (final usage in status.llm)
            Readout(
              usage.model,
              usage.cap > 0 ? '${usage.calls} / ${usage.cap}' : '${usage.calls}',
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
