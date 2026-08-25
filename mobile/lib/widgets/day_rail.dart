/// The day as a rail, with time as its spine.
///
/// This app is fundamentally about time, so the shape of a day should be
/// legible at a glance rather than reconstructed from a list. Hours down the
/// left edge, events hung off them.
///
/// The state that makes the widget necessary is SILENCE. A slot that read its
/// candidates and turned them all down is the agent working correctly — but
/// rendered as a gap it is indistinguishable from a cron that stopped, and that
/// ambiguity is the fastest way to stop trusting the thing.
///
/// Silence therefore gets a stop on the rail like everything else, and gets no
/// colour: a hollow marker in the faint ink. Correct behaviour must never look
/// like an alarm.
library;

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme.dart';
import 'primitives.dart';

/// How one stop on the rail reads. [Tone] carries the colour; this carries the
/// glyph and whether the marker is filled.
enum RailStop { published, drafted, quiet, broken, pending }

extension RailStopLook on RailStop {
  Tone get tone => switch (this) {
        RailStop.published => Tone.out,
        RailStop.drafted => Tone.desk,
        RailStop.broken => Tone.broken,
        RailStop.quiet => Tone.quiet,
        RailStop.pending => Tone.quiet,
      };

  /// Filled means the slot produced something. Hollow means it did not — which
  /// is readable without reading the label, and is the whole point.
  bool get filled => this == RailStop.published || this == RailStop.drafted;

  IconData get glyph => switch (this) {
        RailStop.published => Icons.check,
        RailStop.drafted => Icons.edit_outlined,
        RailStop.broken => Icons.priority_high,
        RailStop.quiet => Icons.volume_off_outlined,
        RailStop.pending => Icons.schedule,
      };
}

RailStop stopFor(String outcome) => switch (outcome) {
      'published' => RailStop.published,
      'drafted' => RailStop.drafted,
      'silent' => RailStop.quiet,
      'missed' => RailStop.broken,
      'failed' => RailStop.broken,
      _ => RailStop.pending,
    };

String labelFor(String outcome) => switch (outcome) {
      'published' => 'Published',
      'drafted' => 'Drafted, waiting on you',
      'silent' => 'Stayed quiet',
      'missed' => 'Missed',
      'failed' => 'Failed to send',
      _ => 'Waiting to run',
    };

/// The rail. Give it the day's entries, already in time order.
class DayRail extends StatelessWidget {
  const DayRail({super.key, required this.entries});

  final List<TimelineEntry> entries;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < entries.length; i++)
            _Stop(entry: entries[i], isLast: i == entries.length - 1),
        ],
      );
}

class _Stop extends StatelessWidget {
  const _Stop({required this.entry, required this.isLast});

  final TimelineEntry entry;
  final bool isLast;

  static const _gutter = 42.0;
  static const _marker = 9.0;

  @override
  Widget build(BuildContext context) {
    final stop = stopFor(entry.outcome);
    final colour = stop.tone.ink;

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Tabular figures so the column stays a column — times of different
          // digit widths would otherwise wander against the spine.
          SizedBox(
            width: _gutter,
            child: Text(
              entry.localTime,
              textAlign: TextAlign.right,
              style: T.data.copyWith(
                fontSize: 13,
                color: stop.filled ? C.paperDim : C.paperFaint,
              ),
            ),
          ),
          const SizedBox(width: S.x3),

          // The spine, with this stop's marker on it.
          SizedBox(
            width: _marker,
            child: Column(
              children: [
                Container(
                  width: _marker,
                  height: _marker,
                  margin: const EdgeInsets.only(top: 5),
                  decoration: BoxDecoration(
                    color: stop.filled ? colour : C.ink,
                    border: Border.all(color: colour, width: 1.5),
                    shape: BoxShape.circle,
                  ),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(width: 1, margin: const EdgeInsets.only(top: 4), color: C.rule),
                  ),
              ],
            ),
          ),
          const SizedBox(width: S.x3),

          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : S.x4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(stop.glyph, size: 13, color: colour),
                      const SizedBox(width: S.x2),
                      Flexible(
                        child: Text(
                          labelFor(entry.outcome),
                          style: T.bodyStrong.copyWith(fontSize: 14, color: colour),
                        ),
                      ),
                    ],
                  ),
                  if (entry.detail != null && entry.detail!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2, left: 21),
                      child: Text(entry.detail!, style: T.micro),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
