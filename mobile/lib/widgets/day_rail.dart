/// The day as a rail, with time as its spine.
///
/// This app is fundamentally about time and, before this widget existed, showed
/// time nowhere — a queue sorted by when drafts happened to be written, and one
/// buried "post time" field. A rail puts the hours down the left edge and hangs
/// the day's events off them, so the shape of a day is legible at a glance
/// instead of having to be reconstructed from a list.
///
/// Colour is the whole legend, and it means exactly one thing: which clock this
/// event is on. Warm is the write clock — drafted, waiting on you, still yours.
/// Cold is the send clock — published, on the record. Red is neither: missed or
/// failed. Grey is a slot that judged its candidates and chose silence.
///
/// That last state is the reason this widget exists at all. Rendered as a gap,
/// a deliberate silence is indistinguishable from a broken cron, and that
/// ambiguity is the fastest way to stop trusting the agent.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme.dart';
import 'post_card.dart' show countdownTick;

/// How one entry on the rail should read.
enum RailTone { live, draft, quiet, alarm, pending }

extension _ToneColor on RailTone {
  Color get color => switch (this) {
        RailTone.live => C.live,
        RailTone.draft => C.draft,
        RailTone.alarm => C.alarm,
        RailTone.quiet => C.textFaint,
        RailTone.pending => C.textFaint,
      };

  IconData get glyph => switch (this) {
        RailTone.live => Icons.check_circle,
        RailTone.draft => Icons.edit_note,
        RailTone.alarm => Icons.event_busy,
        RailTone.quiet => Icons.volume_off,
        RailTone.pending => Icons.schedule,
      };
}

RailTone toneFor(String outcome) => switch (outcome) {
      'published' => RailTone.live,
      'drafted' => RailTone.draft,
      'silent' => RailTone.quiet,
      'missed' => RailTone.alarm,
      'failed' => RailTone.alarm,
      _ => RailTone.pending,
    };

String labelFor(String outcome) => switch (outcome) {
      'published' => 'Published',
      'drafted' => 'Drafted, waiting on you',
      'silent' => 'Stayed quiet',
      'missed' => 'Missed',
      'failed' => 'Failed to send',
      _ => 'Waiting to run',
    };

/// The rail itself. Give it the day's entries, already in time order.
class DayRail extends StatelessWidget {
  const DayRail({super.key, required this.entries});

  final List<TimelineEntry> entries;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < entries.length; i++)
          _RailStop(
            entry: entries[i],
            isLast: i == entries.length - 1,
          ),
      ],
    );
  }
}

class _RailStop extends StatelessWidget {
  const _RailStop({required this.entry, required this.isLast});

  final TimelineEntry entry;
  final bool isLast;

  static const _gutter = 44.0;
  static const _dot = 9.0;

  @override
  Widget build(BuildContext context) {
    final tone = toneFor(entry.outcome);
    final color = tone.color;

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The hour. Tabular figures so the column stays a column — times of
          // different digit widths would otherwise wander against the spine.
          SizedBox(
            width: _gutter,
            child: Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Text(
                entry.localTime,
                textAlign: TextAlign.right,
                style: T.data.copyWith(
                  color: tone == RailTone.quiet ? C.textFaint : C.textDim,
                ),
              ),
            ),
          ),
          const SizedBox(width: S.x3),

          // The spine, and this stop's marker on it.
          SizedBox(
            width: _dot,
            child: Column(
              children: [
                Container(
                  width: _dot,
                  height: _dot,
                  margin: const EdgeInsets.only(top: 5),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    // A hollow marker for a slot that produced nothing, a solid
                    // one for a slot that did. The difference is readable
                    // without reading the label.
                    color: tone == RailTone.quiet || tone == RailTone.pending ? C.bg : color,
                    border: Border.all(color: color, width: 2),
                  ),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(width: 1, margin: const EdgeInsets.only(top: 4), color: C.border),
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
                      Icon(tone.glyph, size: 14, color: color),
                      const SizedBox(width: S.x2),
                      Expanded(
                        child: Text(
                          labelFor(entry.outcome),
                          style: T.bodyStrong.copyWith(fontSize: 14, color: color),
                        ),
                      ),
                    ],
                  ),
                  if (entry.detail != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2, left: 22),
                      child: Text(entry.detail!, style: T.xs),
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

/// The one thing on the screen with a deadline: the next post, and how long
/// you have left with it.
///
/// Ticks every second. A countdown that only updates on pull-to-refresh invites
/// you to trust a figure that is already stale, which is worse than showing no
/// figure at all.
class NextUpCard extends StatefulWidget {
  const NextUpCard({super.key, required this.post, this.onTap});

  final Post post;
  final VoidCallback? onTap;

  @override
  State<NextUpCard> createState() => _NextUpCardState();
}

class _NextUpCardState extends State<NextUpCard> {
  Timer? _ticker;
  Duration? _interval;

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  /// Ticks once a second only while the last two minutes are running down —
  /// which is exactly when this card's urgent styling depends on the seconds.
  /// The rest of the time the reading is in minutes and so is the timer.
  void _schedule() {
    final at = widget.post.scheduledFor;
    final next = countdownTick(at == null ? Duration.zero : at.difference(DateTime.now()));
    if (_interval == next && _ticker != null) return;
    _interval = next;
    _ticker?.cancel();
    _ticker = Timer.periodic(next, (_) {
      if (!mounted) return;
      setState(() {});
      _schedule();
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final at = post.scheduledFor;
    final remaining = at?.difference(DateTime.now()) ?? Duration.zero;

    // Cleared posts cool to the send clock: the card stops asking anything of
    // you the moment you have answered it. Under two minutes an uncleared draft
    // goes to the alarm — that is the last point at which you can still act.
    final urgent = !post.isCleared && remaining.inSeconds > 0 && remaining.inMinutes < 2;
    final tone = post.isMissed
        ? C.alarm
        : post.isCleared
            ? C.live
            : urgent
                ? C.alarm
                : C.draft;

    return AnimatedContainer(
      duration: kStateChange,
      curve: Curves.easeOut,
      padding: const EdgeInsets.all(S.x4),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [tone.withValues(alpha: 0.13), Colors.transparent],
        ),
        border: Border.all(color: tone.withValues(alpha: 0.55)),
        borderRadius: BorderRadius.circular(R.md),
      ),
      child: InkWell(
        onTap: widget.onTap,
        borderRadius: BorderRadius.circular(R.sm),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  post.isCleared ? 'CLEARED' : 'NEXT UP',
                  style: T.panelHead.copyWith(color: tone),
                ),
                const Spacer(),
                if (at != null)
                  Text(_hhmm(at), style: T.data.copyWith(color: tone)),
              ],
            ),
            const SizedBox(height: S.x2),
            if (at != null && !post.isMissed) ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    remaining.isNegative ? 'overdue' : _clock(remaining),
                    style: T.clock.copyWith(color: tone),
                  ),
                  const SizedBox(width: S.x2),
                  Text(
                    post.isCleared
                        ? 'to send'
                        : remaining.isNegative
                            ? 'not cleared'
                            : 'to review',
                    style: T.panelHead,
                  ),
                ],
              ),
              const SizedBox(height: S.x3),
            ],
            Text(post.hook, style: T.body, maxLines: 3, overflow: TextOverflow.ellipsis),
          ],
        ),
      ),
    );
  }

  /// mm:ss under an hour, h:mm above it. The seconds matter only when there are
  /// few enough of them left to act on.
  static String _clock(Duration d) {
    if (d.inHours >= 1) {
      return '${d.inHours}:${(d.inMinutes % 60).toString().padLeft(2, '0')}';
    }
    return '${d.inMinutes.toString().padLeft(2, '0')}:'
        '${(d.inSeconds % 60).toString().padLeft(2, '0')}';
  }
}

String _hhmm(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
