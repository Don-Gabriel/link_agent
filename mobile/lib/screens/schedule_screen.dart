/// The timetable: when this agent posts, and what each slot did.
///
/// This screen is the whole scheduling feature made visible. It exists because
/// the product is fundamentally about time and, until now, showed time nowhere
/// — one buried "post time" field on a settings page, and a queue sorted by
/// when drafts happened to be written.
///
/// Two halves, in this order:
///   TODAY  what is coming, what already went, and what stayed silent and why.
///   SLOTS  the recurring rules you can actually edit.
///
/// Today leads because it is the thing with a deadline. The rules are what you
/// set once and revisit; today is what you check.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/panel.dart';

const _categoryLabels = {
  'music-tech-software': 'Music tech · software',
  'music-tech-hardware': 'Music tech · hardware',
  'emerging-tech': 'Emerging tech',
};

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

    if (status == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return RefreshIndicator(
      onRefresh: state.refresh,
      backgroundColor: C.surface2,
      color: C.accent,
      child: ListView(
        padding: const EdgeInsets.all(S.x4),
        children: [
          _TodayPanel(status: status),
          const SizedBox(height: S.x4),
          _SlotsPanel(state: state, status: status),
          const SizedBox(height: S.x6),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------- today

class _TodayPanel extends StatelessWidget {
  const _TodayPanel({required this.status});

  final AppStatus status;

  @override
  Widget build(BuildContext context) {
    final today = status.timeline
        .where((e) => e.runDate == _localToday())
        .toList()
      ..sort((a, b) => a.localTime.compareTo(b.localTime));

    final next = status.nextDue;

    return Panel(
      title: 'Today',
      subtitle: status.needingReview > 0
          ? '${status.needingReview} draft${status.needingReview == 1 ? "" : "s"} waiting on you.'
          : 'Nothing waiting on a decision.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (next != null) ...[
            _NextUp(post: next),
            const SizedBox(height: S.x4),
          ],
          if (today.isEmpty)
            Text(
              next == null
                  ? 'No slot has run yet today.'
                  : 'The first slot of the day has not reported in yet.',
              style: T.sm,
            )
          else
            for (final entry in today) _TimelineRow(entry: entry),
        ],
      ),
    );
  }

  static String _localToday() {
    final now = DateTime.now();
    return '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
  }
}

/// The single most useful thing on the screen: the draft with the nearest
/// deadline, and whether it still needs you.
class _NextUp extends StatelessWidget {
  const _NextUp({required this.post});

  final Post post;

  @override
  Widget build(BuildContext context) {
    final at = post.scheduledFor;
    final cleared = post.isCleared;

    return Container(
      padding: const EdgeInsets.all(S.x3),
      decoration: BoxDecoration(
        color: cleared ? C.good.withValues(alpha: 0.08) : C.accent.withValues(alpha: 0.08),
        border: Border.all(
          color: (cleared ? C.good : C.accent).withValues(alpha: 0.35),
        ),
        borderRadius: BorderRadius.circular(R.sm),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                at == null ? 'NEXT UP' : 'NEXT UP · ${_hhmm(at)}',
                style: T.panelHead.copyWith(color: cleared ? C.good : C.accent),
              ),
              const Spacer(),
              Badge2(cleared ? 'cleared' : 'needs you',
                  tone: cleared ? BadgeTone.good : BadgeTone.warn),
            ],
          ),
          const SizedBox(height: S.x2),
          Text(post.hook, style: T.body, maxLines: 3, overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({required this.entry});

  final TimelineEntry entry;

  @override
  Widget build(BuildContext context) {
    // A silent slot is a JUDGMENT, not a failure, and it has to read that way.
    // Rendered as a gap it would be indistinguishable from a broken cron, which
    // is exactly the anxiety this row exists to remove.
    final (Color tone, IconData icon, String label) = switch (entry.outcome) {
      'published' => (C.live, Icons.check_circle, 'Published'),
      'drafted' => (C.accent, Icons.edit_note, 'Drafted, waiting'),
      'silent' => (C.textFaint, Icons.volume_off, 'Stayed quiet'),
      'missed' => (C.bad, Icons.event_busy, 'Missed'),
      'failed' => (C.bad, Icons.error_outline, 'Failed'),
      _ => (C.textFaint, Icons.schedule, 'Pending'),
    };

    return Padding(
      padding: const EdgeInsets.only(bottom: S.x3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 48,
            child: Text(
              entry.localTime,
              style: const TextStyle(
                fontSize: 14,
                color: C.textDim,
                fontWeight: FontWeight.w600,
                fontFeatures: [FontFeature.tabularFigures()],
              ),
            ),
          ),
          const SizedBox(width: S.x2),
          Icon(icon, size: 16, color: tone),
          const SizedBox(width: S.x2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: TextStyle(fontSize: 14, color: tone, fontWeight: FontWeight.w500)),
                if (entry.detail != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(entry.detail!, style: T.xs),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
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
          ToggleRow(
            title: 'Publish without me',
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
                  Badge2(_categoryLabels[c] ?? c, tone: BadgeTone.neutral),
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

String _hhmm(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
