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

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/panel.dart';

/// Fallback labels, used only when the server has not told us its categories
/// yet — a cold start, or a backend too old to serve them. The live list comes
/// from /api/status so adding a category needs no client release.
const _fallbackCategoryLabels = {
  'music-tech-software': 'Music tech · software',
  'music-tech-hardware': 'Music tech · hardware',
  'emerging-tech': 'Emerging tech',
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

    return RefreshIndicator(
      onRefresh: state.refresh,
      backgroundColor: C.surface2,
      color: C.accent,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(S.x4, S.x4, S.x4, S.x7),
        children: [
          // Scheduling, publishing and "Run a cycle now" now live on the
          // Schedule tab, with the timetable they act on. Splitting them across
          // two screens left the old daily-post-time field sitting here quietly
          // doing nothing once slots replaced it.
          _RunningNow(status: status, agent: agent),
          const SizedBox(height: S.x4),
          _Topics(agent: agent),
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
  const _RunningNow({required this.status, required this.agent});

  final AppStatus status;
  final Agent agent;

  @override
  Widget build(BuildContext context) {
    return Panel(
      title: 'Agent',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The name is a proper noun, not a section label — it gets real type,
          // not the small-caps treatment panel titles use.
          Text(agent.name, style: T.lg),
          const SizedBox(height: S.x1),
          Text(agent.domain, style: T.sm),
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
  const _Topics({required this.agent});

  final Agent agent;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    return Panel(
      title: 'What it reads',
      subtitle: 'Discovery pulls from these; the judge scores against them.',
      child: Wrap(
        spacing: S.x2,
        runSpacing: S.x2,
        children: [
          for (final entry in _availableCategories(state).entries)
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
                  size: 18, color: account.usable ? C.good : C.bad),
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
          if (!account.usable || account.expiringSoon) ...[
            const SizedBox(height: S.x3),
            // Connecting is an OAuth redirect, which needs a browser — the app
            // cannot complete it, so it says where to go rather than offering a
            // button that would dead-end.
            Container(
              padding: const EdgeInsets.all(S.x3),
              decoration: BoxDecoration(
                color: C.surface2,
                borderRadius: BorderRadius.circular(R.sm),
                border: Border.all(color: C.border),
              ),
              child: const Text(
                'Reconnecting is an OAuth redirect and has to happen in a browser. '
                'Open the web dashboard and press Connect LinkedIn.',
                style: T.xs,
              ),
            ),
          ],
          if (account.lastError != null) ErrorText(account.lastError!),
        ],
      ),
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
          color: selected ? C.accentDim : C.surface2,
          border: Border.all(color: selected ? C.accent : C.borderStrong),
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
