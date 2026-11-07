/// When this agent posts, and what it is allowed to do without you.
///
/// The whole scheduling feature in one place. What used to be here and is not
/// any more: the day's rail and "run a cycle now", both of which are about
/// TODAY and belong on the Desk with the drafts they produce. What is left is
/// the recurring shape of a week, and the two switches that decide whether
/// anything can reach LinkedIn unattended.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/form_select.dart';
import '../widgets/timezone_picker.dart';
import '../timezones.dart';
import '../widgets/primitives.dart';
import 'settings_screen.dart';

/// Bit per weekday, 0 = Sunday — matching lib/schedule.ts, JS getDay() and
/// Postgres DOW. Rendered Monday-first because that is how a working week reads.
const _dayOrder = [1, 2, 3, 4, 5, 6, 0];
const _maskWeekdays = 0x3E;

class TimetableScreen extends StatelessWidget {
  const TimetableScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final status = state.status;
    final agent = state.agent;
    if (status == null || agent == null) {
      return const SettingsPage(title: 'Timetable', children: []);
    }

    return SettingsPage(
      title: 'Timetable',
      children: [
        const Text('Your posting schedule', style: T.title),
        const SizedBox(height: 8),
        const Text(
          'Choose up to five posting times. Each enabled time has its own post on Home. New posts wait for you unless you explicitly enable automatic publishing.',
          style: T.small,
        ),
        const SizedBox(height: 24),
        // Above everything: when this is wrong, nothing else on the screen
        // means what it appears to mean.
        if (!status.scheduler.healthy) ...[
          Notice(
            tone: Tone.broken,
            icon: Icons.cloud_off,
            title: status.scheduler.neverRan
                ? 'The scheduler never started'
                : 'The scheduler stopped',
            body: status.scheduler.neverRan
                ? 'Nothing has ever called the scheduler on this server, so none of the '
                      'times below will fire. Check the connection and contact support if this continues.'
                : 'Nothing has checked in recently. None of the times below will fire '
                      'until it is running again.',
          ),
          const SizedBox(height: S.x5),
        ],

        FormSelect<int>(
          label: 'Number of posting times',
          value: status.slots.isEmpty ? null : status.slots.length,
          options: const {
            1: '1 post per scheduled day',
            2: '2 posts per scheduled day',
            3: '3 posts per scheduled day',
            4: '4 posts per scheduled day',
            5: '5 posts per scheduled day',
          },
          onChanged: state.loading
              ? null
              : (count) async {
                  final error = await state.mutate(
                    () => state.api.post('/api/slots', {
                      'action': 'count',
                      'count': count,
                    }),
                  );
                  if (context.mounted && error != null) {
                    ScaffoldMessenger.of(
                      context,
                    ).showSnackBar(SnackBar(content: Text(error)));
                  }
                },
        ),
        const SizedBox(height: 8),
        const Text(
          'One post per enabled time on its selected days. Changing timezone also moves upcoming timetable drafts and clears their approval. Other timetable changes affect future drafts; change an existing post’s time on its card. Saved posts stay in My posts.',
          style: T.small,
        ),
        const SizedBox(height: 20),
        SectionRule(
          'Posting times',
          trailing: Text(
            '${status.slots.where((s) => s.enabled).length} / ${status.slotLimits.maxSlots}',
            style: T.data.copyWith(fontSize: 12.5),
          ),
        ),
        Text(
          'Preparation starts before your selected time. You are notified when the draft is ready. Publishing is checked every minute; phone delivery also depends on notification permissions and connectivity.',
          style: T.micro,
        ),
        const SizedBox(height: S.x4),

        if (status.slots.isEmpty)
          Text(
            'No posting times yet. Add one to start your schedule.',
            style: T.small,
          )
        else
          for (final slot in status.slots) ...[
            _SlotCard(
              slot: slot,
              canRemove: state.api.isNativeSession || status.slots.length > 1,
            ),
            const SizedBox(height: S.x3),
          ],

        const SizedBox(height: S.x2),
        if (state.canAddSlot)
          OutlinedButton.icon(
            onPressed: state.loading ? null : () => _addSlot(context),
            icon: const Icon(Icons.add, size: 17),
            label: const Text('Add a posting time'),
          )
        else
          Text(
            'You have all ${status.slotLimits.maxSlots} posting times. '
            'Remove one to add another.',
            style: T.micro,
          ),

        const SizedBox(height: S.x6),
        const SectionRule('Publishing'),
        NavRow(
          label: 'Timezone',
          // Every posting time is read in this zone, so changing it moves the
          // whole timetable — the server reschedules each slot on the way.
          value:
              '${Timezones.label(agent.timezone)} · ${Timezones.offset(agent.timezone)}',
          onTap: state.loading ? null : () => _editTimezone(context, agent),
        ),
        const Divider(),
        SwitchRow(
          title: 'Paused',
          blurb: 'Stops every posting time. Drafts and history are untouched.',
          value: agent.paused,
          onChanged: state.loading ? null : state.setPaused,
        ),
        const Divider(),
        SwitchRow(
          title: 'Publish without me',
          blurb: status.account.usable
              ? 'The master switch. Individual times can still be set to wait for you.'
              : 'Connect LinkedIn before enabling this.',
          value: agent.autoPublish,
          onChanged: state.loading || !status.account.usable
              ? null
              : state.setAutoPublish,
        ),

        const SizedBox(height: S.x6),
        ExpansionTile(
          tilePadding: EdgeInsets.zero,
          title: const Text('Advanced publishing limits'),
          children: [
            const SectionRule('Automatic publishing limit'),
            Text(
              'An optional lower limit on automatic publishing. This does not set how many drafts are prepared. It follows how many '
              'posting times you have, so you should rarely need to touch it. Your own '
              'posts do not count against it.',
              style: T.micro,
            ),
            const SizedBox(height: S.x4),
            _CapStepper(
              value: agent.autoPublishCap,
              max: status.maxAutoCap,
              enabled: !state.loading,
              onChanged: state.setAutoPublishCap,
            ),
            const SizedBox(height: S.x5),
            _Budget(
              label: 'Agent published',
              used: status.budget.autoUsed,
              cap: status.budget.autoCap,
              tone: status.budget.autoExhausted ? Tone.desk : Tone.out,
            ),
            const SizedBox(height: S.x4),
            _Budget(
              label: 'You published',
              used: status.budget.manualUsed,
              cap: status.budget.manualCap,
              tone: Tone.quiet,
            ),
            const SizedBox(height: S.x3),
            Text(
              'Your own publishing is limited only by LinkedIn, which allows about '
              '${status.budget.linkedinDailyRequests} API calls a day across posts, image '
              'uploads and token checks.',
              style: T.micro,
            ),
          ],
        ),
      ],
    );
  }

  Future<void> _addSlot(BuildContext context) async {
    final state = context.read<AppState>();
    final messenger = ScaffoldMessenger.of(context);
    final picked = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 9, minute: 30),
      helpText: 'NEW POSTING TIME',
    );
    if (picked == null) return;

    // Weekdays by default rather than daily: several posts a day every single
    // day is a volume almost nobody actually wants, and it is easier to add
    // weekends than to notice you are posting 21 times a week.
    final error = await state.addSlot(
      localTime:
          '${picked.hour.toString().padLeft(2, '0')}:'
          '${picked.minute.toString().padLeft(2, '0')}',
      daysMask: _maskWeekdays,
    );
    if (error != null) messenger.showSnackBar(SnackBar(content: Text(error)));
  }

  Future<void> _editTimezone(BuildContext context, Agent agent) async {
    final state = context.read<AppState>();
    final messenger = ScaffoldMessenger.of(context);
    final value = await showTimezonePicker(context, value: agent.timezone);
    if (!context.mounted || value == null || value == agent.timezone) return;
    final error = await state.setTimezone(value);
    if (error != null) messenger.showSnackBar(SnackBar(content: Text(error)));
  }
}

// -------------------------------------------------------------------- slots

/// One recurring posting time. A card, because it is an object you act on.
class _SlotCard extends StatelessWidget {
  const _SlotCard({required this.slot, required this.canRemove});

  final PostSlot slot;
  final bool canRemove;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final busy = state.loading;
    final limits = state.slotLimits;

    return ObjectCard(
      tone: slot.enabled ? Tone.desk : null,
      padding: const EdgeInsets.all(S.x3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              InkWell(
                onTap: busy ? null : () => _pickTime(context),
                borderRadius: BorderRadius.circular(R.sm),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: S.x1,
                    vertical: S.x1,
                  ),
                  child: Text(
                    slot.localTime,
                    style: T.clock.copyWith(
                      fontSize: 30,
                      letterSpacing: -0.8,
                      color: slot.enabled ? C.paper : C.paperFaint,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: S.x3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(slot.daysLabel, style: T.small),
                    if (slot.enabled && slot.nextRunLocal != null)
                      Text('Next ${slot.nextRunLocal}', style: T.micro),
                  ],
                ),
              ),
              Switch(
                value: slot.enabled,
                onChanged: busy
                    ? null
                    : (v) => state.setSlotEnabled(slot.id, v),
              ),
            ],
          ),
          const SizedBox(height: S.x3),
          _DayPicker(
            mask: slot.daysMask,
            enabled: !busy && slot.enabled,
            onChanged: (m) => state.setSlotDays(slot.id, m),
          ),
          const Divider(color: C.rule, height: S.x5),
          _LeadRow(slot: slot, limits: limits, enabled: !busy && slot.enabled),
          const Divider(color: C.rule, height: S.x5),
          // Scoped wording on purpose. This toggle and the master switch on the
          // page below used to share the label "Publish without me", which is
          // the kind of duplicate that makes a screen impossible to reason
          // about — two controls, same words, different reach.
          SwitchRow(
            title: 'This time publishes itself',
            blurb: slot.autoPublish
                ? 'Goes out at ${slot.localTime} whether or not you have read it.'
                : 'Waits for you to choose Schedule post or Publish now.',
            value: slot.autoPublish,
            onChanged: busy || !slot.enabled
                ? null
                : (v) => _confirmAutoPublish(context, v),
          ),
          if (slot.categories.isNotEmpty) ...[
            const SizedBox(height: S.x3),
            Wrap(
              spacing: S.x2,
              runSpacing: S.x2,
              children: [
                for (final c in slot.categories)
                  Slug(state.status?.categoryLabel(c) ?? c),
              ],
            ),
          ],
          if (canRemove) ...[
            const SizedBox(height: S.x2),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: busy ? null : () => _confirmRemove(context),
                icon: const Icon(Icons.delete_outline, size: 17),
                label: const Text('Remove'),
                style: TextButton.styleFrom(foregroundColor: C.paperFaint),
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
      helpText: 'POSTING TIME',
    );
    if (picked == null) return;
    await state.setSlotTime(
      slot.id,
      '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}',
    );
  }

  /// Turning this ON is the one setting here that can put unreviewed text on a
  /// real profile, so it asks. Turning it off never does.
  Future<void> _confirmAutoPublish(BuildContext context, bool value) async {
    final state = context.read<AppState>();
    if (!value) {
      await state.setSlotAutoPublish(slot.id, false);
      return;
    }

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Publish without reading it?'),
        content: Text(
          'The ${slot.localTime} time will post to your profile on its own, even if you '
          'never open the draft. You can still edit or stop it during the '
          '${slot.leadMinutes}-minute window before it sends.',
          style: T.small,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Turn on'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await state.setSlotAutoPublish(slot.id, true);
  }

  Future<void> _confirmRemove(BuildContext context) async {
    final state = context.read<AppState>();
    final messenger = ScaffoldMessenger.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Remove the ${slot.localTime} time?'),
        content: const Text(
          'Drafts it already made stay on the desk. Nothing new will be written for it.',
          style: T.small,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Keep'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: C.flare,
              foregroundColor: C.onFilament,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    final error = await state.removeSlot(slot.id);
    if (error != null) messenger.showSnackBar(SnackBar(content: Text(error)));
  }
}

/// A summarized weekday field opens a staged checklist.
class _DayPicker extends StatelessWidget {
  const _DayPicker({
    required this.mask,
    required this.enabled,
    required this.onChanged,
  });
  final int mask;
  final bool enabled;
  final ValueChanged<int> onChanged;
  @override
  Widget build(BuildContext context) => MultiSelectField(
    label: 'Days of the week',
    options: const {
      '1': 'Monday',
      '2': 'Tuesday',
      '3': 'Wednesday',
      '4': 'Thursday',
      '5': 'Friday',
      '6': 'Saturday',
      '0': 'Sunday',
    },
    values: [
      for (final day in _dayOrder)
        if ((mask & (1 << day)) != 0) '$day',
    ],
    onChanged: enabled
        ? (v) => onChanged(v.fold<int>(0, (a, d) => a | (1 << int.parse(d))))
        : null,
  );
}

/// The review window. Stepped in fives rather than typed, because the exact
/// number does not matter and a stepper cannot produce a value the server has
/// to clamp.
class _LeadRow extends StatelessWidget {
  const _LeadRow({
    required this.slot,
    required this.limits,
    required this.enabled,
  });

  final PostSlot slot;
  final SlotLimits limits;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final state = context.read<AppState>();
    final value = slot.leadMinutes;

    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Time to review', style: T.bodyStrong),
              // "Waiting for you", not "written" — the agent starts earlier
              // than this so the finished draft is on the desk when the window
              // opens. Promising the moment work BEGINS would promise the
              // wrong thing.
              Text(
                'On your desk this long before it goes out, at least.',
                style: T.micro,
              ),
            ],
          ),
        ),
        const SizedBox(width: S.x2),
        _Step(
          icon: Icons.remove,
          label: 'Less review time',
          onTap: enabled && value - 5 >= limits.minLeadMinutes
              ? () => state.setSlotLead(slot.id, value - 5)
              : null,
        ),
        SizedBox(
          width: 52,
          child: Text(
            value >= 60
                ? '${(value / 60).toStringAsFixed(value % 60 == 0 ? 0 : 1)}h'
                : '${value}m',
            textAlign: TextAlign.center,
            style: T.data.copyWith(fontSize: 16, color: C.paper),
          ),
        ),
        _Step(
          icon: Icons.add,
          label: 'More review time',
          onTap: enabled && value + 5 <= limits.maxLeadMinutes
              ? () => state.setSlotLead(slot.id, value + 5)
              : null,
        ),
      ],
    );
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.icon, required this.onTap, required this.label});

  final IconData icon;
  final VoidCallback? onTap;
  final String label;

  @override
  Widget build(BuildContext context) => IconButton(
    onPressed: onTap,
    icon: Icon(icon, size: 18),
    tooltip: label,
    style: IconButton.styleFrom(
      minimumSize: const Size(kMinTouch, kMinTouch),
      backgroundColor: C.ink3,
      foregroundColor: onTap == null ? C.paperFaint : C.paper,
      side: const BorderSide(color: C.ruleStrong),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
    ),
  );
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
  Widget build(BuildContext context) => Wrap(
    spacing: S.x2,
    runSpacing: S.x2,
    crossAxisAlignment: WrapCrossAlignment.center,
    children: [
      for (var n = 1; n <= max; n++)
        Semantics(
          selected: n == value,
          button: true,
          child: InkWell(
            onTap: enabled && n != value ? () => onChanged(n) : null,
            borderRadius: BorderRadius.circular(R.sm),
            child: Container(
              width: 52,
              height: kMinTouch,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: n == value ? C.filamentWash : C.ink2,
                border: Border.all(
                  color: n == value ? C.filament : C.ruleStrong,
                ),
                borderRadius: BorderRadius.circular(R.sm),
              ),
              child: Text(
                '$n',
                style: T.data.copyWith(
                  fontSize: 17,
                  color: n == value ? C.filament : C.paperDim,
                ),
              ),
            ),
          ),
        ),
      Padding(
        padding: const EdgeInsets.only(left: S.x2),
        child: Text(value == 1 ? 'post / day' : 'posts / day', style: T.micro),
      ),
    ],
  );
}

class _Budget extends StatelessWidget {
  const _Budget({
    required this.label,
    required this.used,
    required this.cap,
    required this.tone,
  });

  final String label;
  final int used;
  final int cap;
  final Tone tone;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        children: [
          Expanded(child: Text(label, style: T.body)),
          Text(
            '$used / $cap',
            style: T.data.copyWith(fontSize: 13, color: tone.ink),
          ),
        ],
      ),
      const SizedBox(height: S.x2),
      Meter(value: cap == 0 ? 0 : used / cap, tone: tone),
    ],
  );
}
