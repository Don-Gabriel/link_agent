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
          _RunningNow(status: status, agent: agent),
          const SizedBox(height: S.x4),
          _Schedule(status: status, agent: agent),
          const SizedBox(height: S.x4),
          _Topics(agent: agent),
          const SizedBox(height: S.x4),
          _Publishing(status: status, agent: agent),
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
    final state = context.watch<AppState>();
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
          const SizedBox(height: S.x4),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: state.loading || agent.paused
                  ? null
                  : () async {
                      final error = await state.runCycleNow();
                      if (!context.mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(error ??
                              'Cycle started. A draft appears in 30-60 seconds if anything clears the bar.'),
                        ),
                      );
                    },
              icon: const Icon(Icons.play_arrow, size: 20),
              label: const Text('Run a cycle now'),
            ),
          ),
          if (agent.paused)
            const Padding(
              padding: EdgeInsets.only(top: S.x2),
              child: Text('Unpause below to run cycles.', style: T.xs),
            ),
        ],
      ),
    );
  }
}

class _Schedule extends StatelessWidget {
  const _Schedule({required this.status, required this.agent});

  final AppStatus status;
  final Agent agent;

  Future<void> _pickTime(BuildContext context) async {
    final state = context.read<AppState>();
    final parts = agent.postTimeLocal.split(':');
    final initial = TimeOfDay(
      hour: int.tryParse(parts.first) ?? 9,
      minute: int.tryParse(parts.length > 1 ? parts[1] : '30') ?? 30,
    );

    final picked = await showTimePicker(context: context, initialTime: initial);
    if (picked == null || !context.mounted) return;

    final hhmm = '${picked.hour.toString().padLeft(2, '0')}:'
        '${picked.minute.toString().padLeft(2, '0')}';
    final error = await state.setPostTime(hhmm);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(error ??
            'Daily time set to $hhmm. If that moment has already passed today, '
                'the next run is tomorrow.'),
      ),
    );
  }

  Future<void> _editTimezone(BuildContext context) async {
    final state = context.read<AppState>();
    final controller = TextEditingController(text: agent.timezone);
    final value = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: C.surface2,
        title: const Text('Timezone'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Asia/Kolkata'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (value == null || value.isEmpty || !context.mounted) return;
    // An unrecognised zone is not rejected — lib/schedule.ts falls back to UTC
    // and logs, so a typo shows up as a wrong next-run time rather than a crash.
    final error = await state.setTimezone(value);
    if (!context.mounted) return;
    if (error != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final busy = context.watch<AppState>().loading;
    return Panel(
      title: 'Schedule',
      child: Column(
        children: [
          _Tappable(
            label: 'Daily post time',
            value: agent.postTimeLocal,
            onTap: busy ? null : () => _pickTime(context),
          ),
          _Tappable(
            label: 'Timezone',
            value: agent.timezone,
            onTap: busy ? null : () => _editTimezone(context),
          ),
          _Readout('Next run', status.nextRunLocal ?? 'not scheduled'),
          _Readout('Cycles run', '${status.cycleCount}'),
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

class _Publishing extends StatelessWidget {
  const _Publishing({required this.status, required this.agent});

  final AppStatus status;
  final Agent agent;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final budget = status.budget;
    final connected = status.account.usable;

    return Panel(
      title: 'Publishing',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ToggleRow(
            title: 'Paused',
            blurb: 'Stops the daily cycle entirely. Drafts and history are untouched.',
            value: agent.paused,
            onChanged: state.loading ? null : state.setPaused,
          ),
          const Divider(color: C.border, height: S.x5),
          ToggleRow(
            title: 'Publish automatically',
            blurb: connected
                ? 'Off means every post waits for you. Turn it on once the voice sounds like you.'
                : 'Connect LinkedIn before enabling this.',
            value: agent.autoPublish,
            onChanged: state.loading || !connected ? null : state.setAutoPublish,
          ),
          const Divider(color: C.border, height: S.x5),

          Text('AGENT ALLOWANCE', style: T.fieldLabel),
          const SizedBox(height: S.x1),
          const Text(
            'The most the agent may publish by itself in 24 hours. Your own '
            'posts do not count against it.',
            style: T.xs,
          ),
          const SizedBox(height: S.x3),
          _CapStepper(
            value: agent.autoPublishCap,
            max: status.maxAutoCap,
            enabled: !state.loading,
            onChanged: state.setAutoPublishCap,
          ),
          const SizedBox(height: S.x4),

          _BudgetBar(
            label: 'Agent published',
            used: budget.autoUsed,
            cap: budget.autoCap,
            tone: budget.autoExhausted ? BadgeTone.warn : BadgeTone.good,
          ),
          const SizedBox(height: S.x3),
          _BudgetBar(
            label: 'You published',
            used: budget.manualUsed,
            cap: budget.manualCap,
            tone: BadgeTone.neutral,
          ),
          const SizedBox(height: S.x2),
          Text(
            'Your own publishing is limited only by LinkedIn, which allows about '
            '${budget.linkedinDailyRequests} API calls per day across posts, image '
            'uploads and token checks.',
            style: T.xs,
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
            _Readout(usage.model, usage.cap > 0 ? '${usage.calls} / ${usage.cap}' : '${usage.calls}'),
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

class _Readout extends StatelessWidget {
  const _Readout(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: S.x2),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(width: 120, child: Text(label, style: T.xs)),
            Expanded(
              child: Text(value, style: const TextStyle(fontSize: 14, color: C.text)),
            ),
          ],
        ),
      );
}

/// A settings row that opens a picker. Full-width tap target, chevron to say so.
class _Tappable extends StatelessWidget {
  const _Tappable({required this.label, required this.value, required this.onTap});

  final String label;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(R.sm),
      child: Container(
        constraints: const BoxConstraints(minHeight: kMinTouch),
        padding: const EdgeInsets.symmetric(vertical: S.x2),
        child: Row(
          children: [
            SizedBox(width: 120, child: Text(label, style: T.xs)),
            Expanded(
              child: Text(
                value,
                style: TextStyle(fontSize: 15, color: onTap == null ? C.textFaint : C.text),
              ),
            ),
            const Icon(Icons.chevron_right, size: 20, color: C.textFaint),
          ],
        ),
      ),
    );
  }
}

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

/// 1..max selector for the agent's own allowance.
class _CapStepper extends StatelessWidget {
  const _CapStepper({
    required this.value,
    required this.max,
    required this.enabled,
    required this.onChanged,
  });

  final int value;
  final int max;
  final bool enabled;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: S.x2,
      children: [
        for (var n = 1; n <= max; n++)
          InkWell(
            onTap: enabled && n != value ? () => onChanged(n) : null,
            borderRadius: BorderRadius.circular(R.sm),
            child: Container(
              width: 56,
              height: kMinTouch,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: n == value ? C.accentDim : C.surface2,
                border: Border.all(color: n == value ? C.accent : C.borderStrong),
                borderRadius: BorderRadius.circular(R.sm),
              ),
              child: Text(
                '$n',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: n == value ? FontWeight.w600 : FontWeight.w400,
                  color: n == value ? C.text : C.textDim,
                ),
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.only(left: S.x2),
          child: SizedBox(
            height: kMinTouch,
            child: Center(
              child: Text(value == 1 ? 'post / day' : 'posts / day', style: T.xs),
            ),
          ),
        ),
      ],
    );
  }
}

class _BudgetBar extends StatelessWidget {
  const _BudgetBar({
    required this.label,
    required this.used,
    required this.cap,
    required this.tone,
  });

  final String label;
  final int used;
  final int cap;
  final BadgeTone tone;

  @override
  Widget build(BuildContext context) {
    final colour = switch (tone) {
      BadgeTone.good => C.good,
      BadgeTone.warn => C.warn,
      BadgeTone.bad => C.bad,
      BadgeTone.live => C.live,
      BadgeTone.neutral => C.textFaint,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: Text(label, style: const TextStyle(fontSize: 14, color: C.text))),
            Text('$used / $cap', style: T.xs.copyWith(color: colour)),
          ],
        ),
        const SizedBox(height: S.x1),
        ClipRRect(
          borderRadius: BorderRadius.circular(999),
          child: LinearProgressIndicator(
            value: cap == 0 ? 0 : (used / cap).clamp(0.0, 1.0),
            minHeight: 4,
            backgroundColor: C.surface3,
            valueColor: AlwaysStoppedAnimation(colour),
          ),
        ),
      ],
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
