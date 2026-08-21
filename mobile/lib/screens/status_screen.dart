/// Everything about how the agent runs: schedule, what it reads, what it may
/// publish on its own, connection health, and the two budgets.
///
/// Organised as a short list of named sections rather than a wall of controls,
/// and ordered by how often you touch them: what it's doing now, then what it
/// writes about, then the safety settings, then diagnostics. The two switches
/// that decide whether anything reaches LinkedIn unattended sit together at the
/// bottom under one heading, because that is the decision they represent.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/panel.dart';

/// Fallback labels, used only when the server has not told us its categories
/// yet — a cold start, or a backend too old to serve them. The live list comes
/// from /api/status so adding a category needs no client release.
///
/// It has to list every id, not just the ones an early build shipped with. When
/// this held only the three original music-and-emerging ids, a cold start
/// rendered a picker with four categories missing and no hint they existed.
const _fallbackCategoryLabels = {
  'music-tech-software': 'Music tech — software',
  'music-tech-hardware': 'Music tech — hardware',
  'emerging-tech': 'Emerging tech',
  'ai-ml': 'AI & ML engineering',
  'dev-tooling': 'Developer tooling',
  'hardware-embedded': 'Hardware & embedded',
  'compute-silicon': 'Compute & silicon',
};

class StatusScreen extends StatelessWidget {
  const StatusScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final status = state.status;
    final agent = status?.agent;

    if (status == null || agent == null) {
      return const Center(child: CircularProgressIndicator());
    }

    // Resolved once and handed to both panels, so the line under the name and
    // the chips below it are literally the same data rendered twice. They used
    // to come from different places — the header printed agent.domain, a
    // sentence typed once at setup and never revised, while the chips showed
    // the live selection. Switch music off and the header still announced an
    // agent that wrote about music.
    final labels = _availableCategories(state);

    return RefreshIndicator(
      onRefresh: state.refresh,
      backgroundColor: C.surface2,
      color: C.draft,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(S.x4, S.x4, S.x4, S.x7),
        children: [
          // Scheduling, publishing and "Run a cycle now" now live on the
          // Schedule tab, with the timetable they act on. Splitting them across
          // two screens left the old daily-post-time field sitting here quietly
          // doing nothing once slots replaced it.
          _RunningNow(status: status, agent: agent, categoryLabels: labels),
          const SizedBox(height: S.x4),
          _Topics(agent: agent, categoryLabels: labels),
          const SizedBox(height: S.x4),
          _Connection(status: status),
          const SizedBox(height: S.x4),
          _Diagnostics(status: status),
          const SizedBox(height: S.x4),
          _Session(state: state),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- sections

class _RunningNow extends StatelessWidget {
  const _RunningNow({required this.status, required this.agent, required this.categoryLabels});

  final AppStatus status;
  final Agent agent;
  final Map<String, String> categoryLabels;

  @override
  Widget build(BuildContext context) {
    // Walked in the picker's order rather than the agent's, so this line reads
    // top-to-bottom in the same order as the chips it is summarising. The
    // stored list is in the order the categories were tapped.
    final selected = categoryLabels.keys.where(agent.categories.contains).toList();

    return Panel(
      title: 'Agent',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The name is a proper noun, not a section label — it gets real type,
          // not the small-caps treatment panel titles use.
          Text(agent.name, style: T.lg),
          const SizedBox(height: S.x1),
          // What it covers, read straight off the selection below rather than
          // from agent.domain. The server now keeps that field in step too, but
          // deriving it here means the two halves of this screen cannot
          // disagree even against a backend that has not been updated.
          Text(
            selected.isEmpty
                ? 'No topics selected — it has nothing to look for.'
                : selected.map((id) => categoryLabels[id] ?? id).join('  ·  '),
            style: T.sm,
          ),
          const SizedBox(height: S.x3),
          Wrap(
            spacing: S.x2,
            runSpacing: S.x2,
            children: [
              Badge2(status.liveMode ? 'live' : 'dry run',
                  tone: status.liveMode ? BadgeTone.live : BadgeTone.warn),
              Badge2(agent.paused ? 'paused' : 'running',
                  tone: agent.paused ? BadgeTone.warn : BadgeTone.good),
              Badge2(agent.autoPublish ? 'auto-publish' : 'approval mode',
                  tone: agent.autoPublish ? BadgeTone.live : BadgeTone.neutral),
            ],
          ),
        ],
      ),
    );
  }
}
class _Topics extends StatelessWidget {
  const _Topics({required this.agent, required this.categoryLabels});

  final Agent agent;
  final Map<String, String> categoryLabels;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return Panel(
      title: 'What it reads',
      // Says out loud that this list is the agent's whole remit, because it is
      // also what the line under the name reports and what the persona is built
      // from — changing it here changes what the agent thinks it is about.
      subtitle: 'Discovery pulls from these; the judge scores against them, and '
          'the agent describes itself by them.',
      child: Wrap(
        spacing: S.x2,
        runSpacing: S.x2,
        children: [
          for (final entry in categoryLabels.entries)
            _CategoryChip(
              label: entry.value,
              selected: agent.categories.contains(entry.key),
              // Refuse to remove the last one: an agent with no categories
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
    );
  }
}
class _Connection extends StatelessWidget {
  const _Connection({required this.status});

  final AppStatus status;

  @override
  Widget build(BuildContext context) {
    final account = status.account;
    return Panel(
      title: 'LinkedIn',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(account.usable ? Icons.check_circle_outline : Icons.error_outline,
                  size: 18, color: account.usable ? C.good : C.alarm),
              const SizedBox(width: S.x2),
              Expanded(
                child: Text(
                  account.connected ? (account.memberName ?? 'Connected') : 'Not connected',
                  style: const TextStyle(fontSize: 15, color: C.text),
                ),
              ),
            ],
          ),
          if (account.daysRemaining != null) ...[
            const SizedBox(height: S.x2),
            Text(
              'Access valid for ${account.daysRemaining} more days. LinkedIn tokens '
              'last 60 days and cannot refresh themselves.',
              style: T.xs,
            ),
          ],
          const SizedBox(height: S.x3),
          _ConnectionActions(account: account),
          if (account.lastError != null) ErrorText(account.lastError!),
        ],
      ),
    );
  }
}

/// Connect or disconnect LinkedIn, from the phone.
///
/// Consent is an OAuth redirect and genuinely cannot happen inside the app's
/// own HTTP client — the screen needs a real browser, and the session that
/// comes back has to belong to one. The app therefore asks the server for the
/// consent URL (`/api/linkedin/connect?json=1`, which answers with the URL
/// instead of a 302) and hands it to the system browser.
///
/// Before this the panel simply told you to go and find the web dashboard,
/// which is a poor answer on the surface where everything else is done.
class _ConnectionActions extends StatefulWidget {
  const _ConnectionActions({required this.account});

  final Account account;

  @override
  State<_ConnectionActions> createState() => _ConnectionActionsState();
}

class _ConnectionActionsState extends State<_ConnectionActions> {
  bool _busy = false;

  Future<void> _connect() async {
    final state = context.read<AppState>();
    setState(() => _busy = true);
    final url = await state.linkedInConsentUrl();
    if (!mounted) return;
    setState(() => _busy = false);

    if (url == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not start the connection. Is the server reachable?')),
      );
      return;
    }

    final opened = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
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
        backgroundColor: C.surface2,
        title: const Text('Disconnect LinkedIn?'),
        content: const Text(
          'The stored token is deleted and nothing can publish until you '
          'reconnect. Your drafts and history are untouched.',
          style: T.sm,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: C.alarm),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    final error = await state.disconnectLinkedIn();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error ?? 'Disconnected.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final busy = _busy || context.watch<AppState>().loading;
    final account = widget.account;
    final connected = account.connected;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: FilledButton.icon(
                onPressed: busy ? null : _connect,
                icon: const Icon(Icons.link, size: 18),
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
          style: T.xs,
        ),
      ],
    );
  }
}

class _Diagnostics extends StatelessWidget {
  const _Diagnostics({required this.status});

  final AppStatus status;

  @override
  Widget build(BuildContext context) {
    if (status.llm.isEmpty) return const SizedBox.shrink();
    return Panel(
      title: 'Model usage today',
      subtitle: 'Quotas are per model, so the cascade stacks them.',
      child: Column(
        children: [
          for (final usage in status.llm)
            Readout(usage.model, usage.cap > 0 ? '${usage.calls} / ${usage.cap}' : '${usage.calls}'),
        ],
      ),
    );
  }
}

class _Session extends StatelessWidget {
  const _Session({required this.state});

  final AppState state;

  @override
  Widget build(BuildContext context) {
    return Panel(
      title: 'Session',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(state.baseUrl, style: T.mono),
          const SizedBox(height: S.x3),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(onPressed: state.signOut, child: const Text('Sign out')),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- pieces
class _CategoryChip extends StatelessWidget {
  const _CategoryChip({
    required this.label,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: enabled ? onTap : null,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        constraints: const BoxConstraints(minHeight: 44),
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: S.x4),
        decoration: BoxDecoration(
          color: selected ? C.draftDim : C.surface2,
          border: Border.all(color: selected ? C.draft : C.borderStrong),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 14,
            color: !enabled ? C.textFaint : (selected ? C.text : C.textDim),
            fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
      ),
    );
  }
}

/// The categories to offer, preferring the server's list.
///
/// Falls back to the built-in map only when the server has sent none. Any
/// category the agent already has selected but the server did not list is
/// appended, so an id this build does not recognise stays visible and
/// removable rather than silently vanishing from the picker.
Map<String, String> _availableCategories(AppState state) {
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
