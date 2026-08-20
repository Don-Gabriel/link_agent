/// The timetable: when this agent posts, and what each slot did.
///
/// This screen is the whole scheduling feature made visible. It exists because
/// the product is fundamentally about time and, until now, showed time nowhere
/// — one buried "post time" field on a settings page, and a queue sorted by
/// when drafts happened to be written.
///
/// Everything about WHEN, in one place:
///   TODAY       the next post and its deadline, then the day as a rail.
///   RUN NOW     write one immediately, off the timetable.
///   SLOTS       the recurring rules, with their days and review windows.
///   PUBLISHING  timezone, pause, publish-without-me, the daily allowance.
///
/// The last two used to sit on the Status tab, a screen away from the timetable
/// they govern — and the old "daily post time" field there kept alive a control
/// that slots had already replaced, so editing it changed nothing. Status is now
/// only what it says: what this thing IS, and whether it is well.
///
/// Today leads, and leads with ONE thing at full weight, because it is the part
/// with a deadline. The rest is what you set once and revisit.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/day_rail.dart';
import '../widgets/panel.dart';

/// Bit per weekday, 0 = Sunday — matching lib/schedule.ts, JS getDay() and
/// Postgres DOW. Rendered Monday-first because that is how a working week reads.
const _dayOrder = [1, 2, 3, 4, 5, 6, 0];
const _dayInitials = {0: 'S', 1: 'M', 2: 'T', 3: 'W', 4: 'T', 5: 'F', 6: 'S'};
const _maskDaily = 0x7F;
const _maskWeekdays = 0x3E;

class ScheduleScreen extends StatelessWidget {
  const ScheduleScreen({super.key});

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
      color: C.draft,
      child: ListView(
        padding: const EdgeInsets.all(S.x4),
        children: [
          _Today(status: status),
          const SizedBox(height: S.x5),
          _RunNow(agent: agent),
          const SizedBox(height: S.x4),
          _SlotsPanel(state: state, status: status),
          const SizedBox(height: S.x4),
          _Publishing(status: status, agent: agent),
          const SizedBox(height: S.x6),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------- today

/// Deliberately NOT a Panel.
///
/// Everything else on this screen is a bordered card, so the day reads as the
/// page rather than as one more box competing with the rest.
class _Today extends StatelessWidget {
  const _Today({required this.status});

  final AppStatus status;

  @override
  Widget build(BuildContext context) {
    final today = status.timeline.where((e) => e.runDate == _localToday()).toList()
      ..sort((a, b) => a.localTime.compareTo(b.localTime));
    final next = status.nextDue;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Text('Today', style: T.xl),
            const SizedBox(width: S.x3),
            Expanded(
              child: Text(
                status.needingReview > 0
                    ? '${status.needingReview} waiting on you'
                    : 'nothing waiting',
                style: T.panelHead.copyWith(
                  color: status.needingReview > 0 ? C.draft : C.textFaint,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: S.x4),

        if (next != null) ...[
          NextUpCard(
            post: next,
            onTap: () => context.read<AppState>().startEditing(next),
          ),
          const SizedBox(height: S.x5),
        ],

        if (today.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: S.x4),
            child: Text(
              next == null
                  ? 'No slot has run yet today.'
                  : 'The first slot of the day has not reported in yet.',
              style: T.sm,
            ),
          )
        else ...[
          Text('THE DAY SO FAR', style: T.panelHead),
          const SizedBox(height: S.x3),
          DayRail(entries: today),
        ],
      ],
    );
  }

  static String _localToday() {
    final now = DateTime.now();
    return '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
  }
}

// ------------------------------------------------------------------- slots

class _SlotsPanel extends StatelessWidget {
  const _SlotsPanel({required this.state, required this.status});

  final AppState state;
  final AppStatus status;

  @override
  Widget build(BuildContext context) {
    final slots = status.slots;
    final limits = status.slotLimits;

    return Panel(
      title: 'Posting times',
      subtitle: 'Each slot writes a draft ${limits.minLeadMinutes}+ minutes early so you can read it '
          'before it goes out.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (slots.isEmpty)
            Text('No posting times yet.', style: T.sm)
          else
            for (final slot in slots) ...[
              _SlotTile(slot: slot, canDelete: slots.length > 1),
              const SizedBox(height: S.x2),
            ],
          const SizedBox(height: S.x2),
          if (state.canAddSlot)
            OutlinedButton.icon(
              onPressed: state.loading ? null : () => _addSlot(context),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Add a posting time'),
            )
          else
            Text(
              'You have all ${limits.maxSlots} posting times. Remove one to add another.',
              style: T.xs,
            ),
        ],
      ),
    );
  }

  Future<void> _addSlot(BuildContext context) async {
    final state = context.read<AppState>();
    final picked = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 9, minute: 30),
      helpText: 'New posting time',
    );
    if (picked == null || !context.mounted) return;

    // Weekdays by default rather than daily: several posts a day every single
    // day is a volume almost nobody actually wants, and it is easier to add
    // weekends than to notice you are posting 21 times a week.
    final error = await state.addSlot(
      localTime: '${picked.hour.toString().padLeft(2, '0')}:'
          '${picked.minute.toString().padLeft(2, '0')}',
      daysMask: _maskWeekdays,
    );
    if (error != null && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
    }
  }
}

class _SlotTile extends StatelessWidget {
  const _SlotTile({required this.slot, required this.canDelete});

  final PostSlot slot;
  final bool canDelete;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final busy = state.loading;
    final limits = state.slotLimits;

    return Container(
      padding: const EdgeInsets.all(S.x3),
      decoration: BoxDecoration(
        color: slot.enabled ? C.surface2 : C.surface,
        border: Border.all(color: slot.enabled ? C.borderStrong : C.border),
        borderRadius: BorderRadius.circular(R.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              InkWell(
                onTap: busy ? null : () => _pickTime(context),
                borderRadius: BorderRadius.circular(R.sm),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: S.x2, vertical: S.x1),
                  child: Text(
                    slot.localTime,
                    style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w600,
                      color: slot.enabled ? C.text : C.textFaint,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: S.x2),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(slot.daysLabel, style: T.sm),
                    if (slot.enabled && slot.nextRunLocal != null)
                      Text('Next ${slot.nextRunLocal}', style: T.xs),
                  ],
                ),
              ),
              Switch(
                value: slot.enabled,
                onChanged: busy ? null : (v) => state.setSlotEnabled(slot.id, v),
              ),
            ],
          ),
          const SizedBox(height: S.x2),
          _DayPicker(
            mask: slot.daysMask,
            enabled: !busy && slot.enabled,
            onChanged: (m) => state.setSlotDays(slot.id, m),
          ),
          const SizedBox(height: S.x3),
          _LeadRow(slot: slot, limits: limits, enabled: !busy && slot.enabled),
          const SizedBox(height: S.x2),
          // Scoped wording on purpose. This toggle and the master switch further
          // down used to share the label "Publish without me", which is the kind
          // of duplicate that makes a screen impossible to reason about — two
          // controls, same words, different reach.
          ToggleRow(
            title: 'This time publishes itself',
            blurb: slot.autoPublish
                ? 'Goes out at ${slot.localTime} whether or not you have read it.'
                : 'Waits for you to clear it. If you do not, it stays put.',
            value: slot.autoPublish,
            onChanged:
                busy || !slot.enabled ? null : (v) => _confirmAutoPublish(context, v),
          ),
          if (slot.categories.isNotEmpty) ...[
            const SizedBox(height: S.x2),
            Wrap(
              spacing: S.x2,
              runSpacing: S.x2,
              children: [
                for (final c in slot.categories)
                  Badge2(state.status?.categoryLabel(c) ?? c, tone: BadgeTone.neutral),
              ],
            ),
          ],
          if (canDelete) ...[
            const SizedBox(height: S.x2),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: busy ? null : () => _confirmDelete(context),
                icon: const Icon(Icons.delete_outline, size: 18),
                label: const Text('Remove'),
                style: TextButton.styleFrom(foregroundColor: C.textFaint),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _pickTime(BuildContext context) async {
    final state = context.read<AppState>();
    final parts = slot.localTime.split(':');
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(
        hour: int.tryParse(parts.first) ?? 9,
        minute: int.tryParse(parts.last) ?? 30,
      ),
      helpText: 'Posting time',
    );
    if (picked == null || !context.mounted) return;
    await state.setSlotTime(
      slot.id,
      '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}',
    );
  }

  /// Turning auto-publish ON is the one setting here that can put unreviewed
  /// text on a real profile, so it asks. Turning it off never does.
  Future<void> _confirmAutoPublish(BuildContext context, bool value) async {
    final state = context.read<AppState>();
    if (!value) {
      await state.setSlotAutoPublish(slot.id, false);
      return;
    }

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: C.surface2,
        title: const Text('Publish without reading it?'),
        content: Text(
          'The ${slot.localTime} slot will post to your profile on its own, even if you '
          'never open the draft. You can still edit or stop it during the '
          '${slot.leadMinutes}-minute window before it sends.',
          style: T.sm,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Turn on')),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    await state.setSlotAutoPublish(slot.id, true);
  }

  Future<void> _confirmDelete(BuildContext context) async {
    final state = context.read<AppState>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: C.surface2,
        title: Text('Remove the ${slot.localTime} slot?'),
        content: const Text(
          'Drafts it already made stay in the queue. Nothing new will be written for it.',
          style: T.sm,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: C.bad),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    final error = await state.removeSlot(slot.id);
    if (error != null && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
    }
  }
}

/// Seven tappable initials. A row of toggles rather than a dropdown because the
/// whole set has to be readable at a glance — "which days does this run" is the
/// question, and a menu hides the answer until you open it.
class _DayPicker extends StatelessWidget {
  const _DayPicker({required this.mask, required this.enabled, required this.onChanged});

  final int mask;
  final bool enabled;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (final day in _dayOrder)
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(right: S.x1),
              child: _DayChip(
                label: _dayInitials[day]!,
                selected: (mask & (1 << day)) != 0,
                enabled: enabled,
                onTap: () {
                  final next = mask ^ (1 << day);
                  // An empty mask is a slot that can never fire, and a schedule
                  // that silently never runs is the worst outcome here. The
                  // server coerces this to daily too; refusing the last tap is
                  // clearer than accepting it and doing something else.
                  if ((next & _maskDaily) == 0) return;
                  onChanged(next);
                },
              ),
            ),
          ),
      ],
    );
  }
}

class _DayChip extends StatelessWidget {
  const _DayChip({
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
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(R.sm),
        child: Container(
          height: 40,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? C.accentDim : C.surface,
            border: Border.all(color: selected ? C.accent : C.border),
            borderRadius: BorderRadius.circular(R.sm),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 13,
              fontWeight: selected ? FontWeight.w700 : FontWeight.w400,
              color: !enabled
                  ? C.textFaint
                  : selected
                      ? C.text
                      : C.textDim,
            ),
          ),
        ),
      ),
    );
  }
}

/// The review window. Stepped in fives rather than typed, because the exact
/// number does not matter and a stepper cannot produce a value the server has
/// to clamp.
class _LeadRow extends StatelessWidget {
  const _LeadRow({required this.slot, required this.limits, required this.enabled});

  final PostSlot slot;
  final SlotLimits limits;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final state = context.read<AppState>();
    final value = slot.leadMinutes;
    final canDown = value - 5 >= limits.minLeadMinutes;
    final canUp = value + 5 <= limits.maxLeadMinutes;

    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Time to review', style: TextStyle(fontSize: 15, color: C.text)),
              Text(_describe(value), style: T.xs),
            ],
          ),
        ),
        _MiniStep(
          icon: Icons.remove,
          onTap: enabled && canDown ? () => state.setSlotLead(slot.id, value - 5) : null,
          semanticLabel: 'Less review time',
        ),
        SizedBox(
          width: 56,
          child: Text(
            value >= 60 ? '${(value / 60).toStringAsFixed(value % 60 == 0 ? 0 : 1)}h' : '${value}m',
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 16,
              color: C.text,
              fontWeight: FontWeight.w600,
              fontFeatures: [FontFeature.tabularFigures()],
            ),
          ),
        ),
        _MiniStep(
          icon: Icons.add,
          onTap: enabled && canUp ? () => state.setSlotLead(slot.id, value + 5) : null,
          semanticLabel: 'More review time',
        ),
      ],
    );
  }

  static String _describe(int minutes) {
    final at = minutes >= 60
        ? '${(minutes / 60).toStringAsFixed(minutes % 60 == 0 ? 0 : 1)} hours'
        : '$minutes minutes';
    return 'Written $at before it goes out — at least.';
  }
}

class _MiniStep extends StatelessWidget {
  const _MiniStep({required this.icon, required this.onTap, required this.semanticLabel});

  final IconData icon;
  final VoidCallback? onTap;
  final String semanticLabel;

  @override
  Widget build(BuildContext context) => IconButton(
        onPressed: onTap,
        icon: Icon(icon, size: 20),
        tooltip: semanticLabel,
        style: IconButton.styleFrom(
          minimumSize: const Size(kMinTouch, kMinTouch),
          backgroundColor: C.surface3,
          foregroundColor: onTap == null ? C.textFaint : C.text,
          side: const BorderSide(color: C.borderStrong),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
        ),
      );
}
/// Write one now, off the timetable.
///
/// Lives here rather than on Status because it is a scheduling action — it is
/// what you press when you do not want to wait for a slot. The draft it makes
/// has no send time of its own; give it one from its card in the queue, or just
/// publish it when you are happy with it.
class _RunNow extends StatelessWidget {
  const _RunNow({required this.agent});

  final Agent agent;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();

    return Panel(
      title: 'Write one now',
      subtitle: 'Runs the whole cycle immediately, ignoring the timetable.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
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
                              'Started. A draft appears in 30-60 seconds if anything clears the bar.'),
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
              child: Text('Paused — turn it back on below to run cycles.', style: T.xs),
            ),
        ],
      ),
    );
  }
}

/// Timezone, pause, publish-without-me, and the agent's daily allowance.
///
/// Moved here from Status because all of it acts on the timetable above. The
/// old "daily post time" field that used to sit alongside is gone: slots
/// replaced it, so it was a control that looked live and changed nothing.
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
          TappableRow(
            label: 'Timezone',
            value: agent.timezone,
            // Every slot time is read in this zone, so changing it moves the
            // whole timetable — the server reschedules each slot on the way.
            onTap: state.loading ? null : () => _editTimezone(context),
          ),
          const Divider(color: C.border, height: S.x5),
          ToggleRow(
            title: 'Paused',
            blurb: 'Stops every slot. Drafts and history are untouched.',
            value: agent.paused,
            onChanged: state.loading ? null : state.setPaused,
          ),
          const Divider(color: C.border, height: S.x5),
          ToggleRow(
            title: 'Publish without me',
            blurb: connected
                ? 'The master switch. Individual slots can still be set to wait for you.'
                : 'Connect LinkedIn before enabling this.',
            value: agent.autoPublish,
            onChanged: state.loading || !connected ? null : state.setAutoPublish,
          ),
          const Divider(color: C.border, height: S.x5),
          Text('AGENT ALLOWANCE', style: T.fieldLabel),
          const SizedBox(height: S.x1),
          const Text(
            'The most the agent may publish by itself in a day. It follows how '
            'many posting times you have, so you should rarely need to touch it. '
            'Your own posts do not count against it.',
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
            '${budget.linkedinDailyRequests} API calls a day across posts, image '
            'uploads and token checks.',
            style: T.xs,
          ),
          const SizedBox(height: S.x3),
          Readout('Cycles run', '${status.cycleCount}'),
        ],
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
}

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
