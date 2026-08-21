/// A draft or published post, rendered as LinkedIn will render it.
///
/// The fold marker is the reason this widget is not just a Text. LinkedIn hides
/// everything past ~210 characters behind "see more", and that cut happens on
/// a phone — which makes a phone the right place to judge whether the hook
/// survives it. Showing the boundary inline is the single most useful thing
/// this screen does that the LinkedIn composer does not.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme.dart';
import 'panel.dart';

/// Matches FOLD_CHARS in lib/format.ts. Keep the two in step.
const int kFoldChars = 210;

/// Compact relative time — "4h", "2d". Absolute timestamps make a feed harder
/// to scan: what matters is whether something is recent, not which minute.
String relativeTime(DateTime when) {
  final seconds = DateTime.now().difference(when).inSeconds;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return '${seconds ~/ 60}m ago';
  if (seconds < 86400) return '${seconds ~/ 3600}h ago';
  if (seconds < 604800) return '${seconds ~/ 86400}d ago';
  return '${seconds ~/ 604800}w ago';
}

String _hhmm(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

/// "in 12 min", "in 3h 40m", "2 min ago" — coarse on purpose above an hour.
/// How often a countdown showing [remaining] actually needs to repaint.
///
/// These readouts are rendered in MINUTES — the finest thing they ever say is
/// "less than a minute" — so a one-second timer was asking Flutter to rebuild
/// sixty times for every frame that could possibly look different, once per
/// scheduled post on screen. Under two minutes the resolution genuinely
/// matters, because that is where the urgent styling flips and where "less
/// than a minute" appears; past that, twenty seconds keeps every minute
/// boundary fresh to within a third of a minute and costs a twentieth as much.
Duration countdownTick(Duration remaining) =>
    remaining.abs().inMinutes < 2 ? const Duration(seconds: 1) : const Duration(seconds: 20);

String _countdown(Duration d) {
  final late = d.isNegative;
  final total = d.abs();
  final label = total.inMinutes < 1
      ? 'less than a minute'
      : total.inMinutes < 60
          ? '${total.inMinutes} min'
          : total.inHours < 24
              ? '${total.inHours}h ${total.inMinutes % 60}m'
              : '${total.inDays}d ${total.inHours % 24}h';
  return late ? '$label ago' : 'in $label';
}

/// When this post goes out, and whether anything still has to happen first.
///
/// Ticks once a second rather than rendering a static string: the number that
/// matters here is how much of the review window is left, and a countdown that
/// only updates on pull-to-refresh is worse than none — it invites you to trust
/// a figure that is already stale.
class _ScheduleStrip extends StatefulWidget {
  const _ScheduleStrip({required this.post, this.onTap, this.onClear});

  final Post post;

  /// Change the time. The strip is the obvious place to tap for that.
  final VoidCallback? onTap;

  /// Take it off the timetable entirely.
  final VoidCallback? onClear;

  @override
  State<_ScheduleStrip> createState() => _ScheduleStripState();
}

class _ScheduleStripState extends State<_ScheduleStrip> {
  Timer? _ticker;
  Duration? _interval;

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  /// Re-arms at the rate the current distance to the deadline deserves, and
  /// only replaces the timer when that rate actually changes.
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
    final at = post.scheduledFor!;
    final remaining = at.difference(DateTime.now());

    // Three states worth distinguishing, because each needs a different action.
    final (Color tone, IconData icon, String message) = switch (post) {
      _ when post.isMissed => (
          C.alarm,
          Icons.event_busy,
          'Missed its ${_hhmm(at)} slot — not sent late.',
        ),
      _ when post.isHeld => (
          C.attention,
          Icons.lock_clock,
          'Held while you edit. It will not send until you save.',
        ),
      _ when post.isCleared => (
          C.good,
          Icons.check_circle_outline,
          'Cleared — sends at ${_hhmm(at)}, ${_countdown(remaining)}.',
        ),
      _ when remaining.isNegative => (
          C.attention,
          Icons.error_outline,
          'Due at ${_hhmm(at)} and not cleared. It will not send until you clear it.',
        ),
      _ => (
          C.draft,
          Icons.schedule,
          'Sends at ${_hhmm(at)}, ${_countdown(remaining)}. Clear it before then.',
        ),
    };

    return Container(
      padding: const EdgeInsets.fromLTRB(S.x3, S.x2, S.x2, S.x2),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.10),
        border: Border.all(color: tone.withValues(alpha: 0.40)),
        borderRadius: BorderRadius.circular(R.sm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Icon(icon, size: 16, color: tone),
          const SizedBox(width: S.x2),
          Expanded(
            child: InkWell(
              onTap: widget.onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: S.x1),
                child: Text(
                  message,
                  style:
                      TextStyle(fontSize: 13, height: 1.4, color: tone, fontWeight: FontWeight.w500),
                ),
              ),
            ),
          ),
          if (widget.onClear != null)
            IconButton(
              onPressed: widget.onClear,
              icon: const Icon(Icons.timer_off_outlined, size: 18),
              tooltip: 'Remove the send time',
              visualDensity: VisualDensity.compact,
              style: IconButton.styleFrom(foregroundColor: tone.withValues(alpha: 0.8)),
            ),
        ],
      ),
    );
  }
}

/// The offer of a send time, on a draft that has none.
///
/// Reads as an invitation rather than an empty field: a draft with no time is a
/// perfectly normal thing that you will publish when you get to it, so this must
/// not look like something left unfilled.
class _OfferATime extends StatelessWidget {
  const _OfferATime({required this.onTap});

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(R.sm),
      child: Container(
        constraints: const BoxConstraints(minHeight: kMinTouch),
        padding: const EdgeInsets.symmetric(horizontal: S.x3, vertical: S.x2),
        decoration: BoxDecoration(
          border: Border.all(color: C.borderStrong, style: BorderStyle.solid),
          borderRadius: BorderRadius.circular(R.sm),
        ),
        child: Row(
          children: [
            const Icon(Icons.schedule, size: 16, color: C.textFaint),
            const SizedBox(width: S.x2),
            Expanded(
              child: Text(
                'Send at a set time',
                style: TextStyle(
                  fontSize: 13,
                  color: onTap == null ? C.textFaint : C.textDim,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            const Text('optional', style: T.xs),
          ],
        ),
      ),
    );
  }
}

class PostCard extends StatelessWidget {
  const PostCard({
    super.key,
    required this.post,
    this.onClear,
    this.onSendNow,
    this.onSchedule,
    this.onUnschedule,
    this.onDiscard,
    this.onEdit,
    this.busy = false,
  });

  final Post post;

  /// "Let it go at its scheduled time." Null when there is no time to clear it
  /// for, or when it has already been cleared.
  final VoidCallback? onClear;

  /// "Send it right now." The override.
  final VoidCallback? onSendNow;

  /// Give this ONE post a send time, or change the time it already has.
  ///
  /// Deliberately optional and deliberately empty until used. A draft waiting
  /// in the queue is not obliged to have a time — most will just be published
  /// when you get to them — so this is an offer rather than a field you have to
  /// clear. It is the per-post counterpart to a recurring slot: same machinery
  /// underneath, no timetable required.
  final VoidCallback? onSchedule;

  /// Take this post back off the timetable, leaving it a plain draft.
  final VoidCallback? onUnschedule;

  final VoidCallback? onDiscard;
  final VoidCallback? onEdit;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final actionable =
        onClear != null || onSendNow != null || onDiscard != null || onEdit != null;

    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _header(),
          if (post.isScheduled && !post.isPublished) ...[
            const SizedBox(height: S.x3),
            _ScheduleStrip(post: post, onTap: busy ? null : onSchedule, onClear: busy ? null : onUnschedule),
          ] else if (onSchedule != null && !post.isPublished) ...[
            const SizedBox(height: S.x3),
            _OfferATime(onTap: busy ? null : onSchedule),
          ],
          const SizedBox(height: S.x3),
          _FoldedText(post.text),
          if (post.hashtags.isNotEmpty) ...[
            const SizedBox(height: S.x3),
            Text(
              post.hashtags.map((h) => '#$h').join(' '),
              style: const TextStyle(fontSize: 15, color: C.live),
            ),
          ],
          if (post.rationale.isNotEmpty) ...[
            const SizedBox(height: S.x3),
            Container(
              padding: const EdgeInsets.only(left: S.x3),
              decoration: const BoxDecoration(
                border: Border(left: BorderSide(color: C.borderStrong, width: 2)),
              ),
              child: Text(post.rationale, style: T.sm),
            ),
          ],
          if (post.scores.isNotEmpty) ...[
            const SizedBox(height: S.x3),
            _Scores(post.scores),
          ],
          if (actionable) ...[
            const SizedBox(height: S.x4),
            _actions(),
          ],
        ],
      ),
    );
  }

  Widget _header() {
    final stamp = post.publishedAt ?? post.createdAt;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          // Wrap, not Row: four badges plus an id do not fit on a narrow phone,
          // and a clipped status badge is worse than a second line.
          child: Wrap(
            spacing: S.x2,
            runSpacing: S.x2,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(post.id, style: T.xs.copyWith(fontWeight: FontWeight.w600, color: C.textDim)),
              Badge2(
                post.status,
                tone: switch (post.status) {
                  'published' => BadgeTone.live,
                  'draft' => BadgeTone.neutral,
                  'approved' => BadgeTone.good,
                  'failed' => BadgeTone.alarm,
                  'missed' => BadgeTone.alarm,
                  'unknown' => BadgeTone.warn,
                  _ => BadgeTone.neutral,
                },
              ),
              if (post.kind == 'custom') const Badge2('yours'),
              if (post.usedQuote) const Badge2('quote'),
            ],
          ),
        ),
        if (stamp != null) ...[
          const SizedBox(width: S.x2),
          Text(relativeTime(stamp), style: T.xs),
        ],
      ],
    );
  }

  Widget _actions() {
    // The primary action depends on whether this post has a time of its own.
    // Scheduled: clearing is primary and sending now is the override tucked
    // behind an icon. Unscheduled: sending is the only thing approval can mean.
    final primary = onClear != null
        ? FilledButton.icon(
            onPressed: busy ? null : onClear,
            icon: const Icon(Icons.check, size: 18),
            label: Text(
              post.scheduledFor == null
                  ? 'Clear to send'
                  : 'Clear for ${_hhmm(post.scheduledFor!)}',
            ),
          )
        : onSendNow != null
            ? FilledButton.icon(
                onPressed: busy ? null : onSendNow,
                icon: const Icon(Icons.send, size: 18),
                label: Text(post.isCleared ? 'Send now' : 'Publish'),
              )
            : null;

    return Row(
      children: [
        if (primary != null) Expanded(child: primary),
        // Both available at once only when clearing is primary — then this is
        // the "never mind the schedule" escape hatch.
        if (onClear != null && onSendNow != null) ...[
          const SizedBox(width: S.x2),
          IconButton(
            onPressed: busy ? null : onSendNow,
            icon: const Icon(Icons.send_outlined),
            tooltip: 'Send now instead',
            style: IconButton.styleFrom(
              minimumSize: const Size(kMinTouch, kMinTouch),
              side: const BorderSide(color: C.borderStrong),
              foregroundColor: C.textDim,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
            ),
          ),
        ],
        if (onEdit != null) ...[
          const SizedBox(width: S.x2),
          IconButton(
            onPressed: busy ? null : onEdit,
            icon: const Icon(Icons.edit_outlined),
            tooltip: 'Edit',
            style: IconButton.styleFrom(
              minimumSize: const Size(kMinTouch, kMinTouch),
              side: const BorderSide(color: C.borderStrong),
              foregroundColor: C.textDim,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
            ),
          ),
        ],
        if (onDiscard != null) ...[
          const SizedBox(width: S.x2),
          IconButton(
            onPressed: busy ? null : onDiscard,
            icon: const Icon(Icons.delete_outline),
            tooltip: 'Discard',
            style: IconButton.styleFrom(
              minimumSize: const Size(kMinTouch, kMinTouch),
              side: const BorderSide(color: C.borderStrong),
              foregroundColor: C.alarm,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
            ),
          ),
        ],
      ],
    );
  }
}

/// Post text with the "see more" boundary drawn across it.
/// The post, cut where LinkedIn cuts it, with a real toggle.
///
/// Starts COLLAPSED, which is the whole point: what you see first is exactly
/// what a reader scrolling their feed sees first. Judge the hook against that,
/// then expand to review the rest.
///
/// It used to render "see more" as a divider caption with the remaining text
/// already visible underneath — a label that looked like a button, sat where a
/// button belongs, and did nothing when pressed.
class _FoldedText extends StatefulWidget {
  const _FoldedText(this.text);

  final String text;

  @override
  State<_FoldedText> createState() => _FoldedTextState();
}

class _FoldedTextState extends State<_FoldedText> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final text = widget.text;

    // The fold falls at a character offset in the whole post, not at a line
    // break, so the text is split rather than measured — anything else would
    // put the marker in a place LinkedIn does not actually cut.
    if (text.length <= kFoldChars) {
      return Text(text, style: T.body);
    }
    final above = text.substring(0, kFoldChars);
    final below = text.substring(kFoldChars);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(above, style: T.body),
        _FoldToggle(
          expanded: _expanded,
          hiddenChars: below.trim().length,
          onTap: () => setState(() => _expanded = !_expanded),
        ),
        // Collapsed is not "hidden": the text above the fold is the whole post
        // as far as most readers are concerned, so nothing below it is dimmed
        // out of existence — it is simply not shown until asked for.
        if (_expanded) Text(below, style: T.body.copyWith(color: C.textDim)),
      ],
    );
  }
}

/// The fold marker, which is also the control.
///
/// Full-width and touch-sized rather than a caption between two rules: the old
/// version was the right idea rendered as something unpressable.
class _FoldToggle extends StatelessWidget {
  const _FoldToggle({
    required this.expanded,
    required this.hiddenChars,
    required this.onTap,
  });

  final bool expanded;
  final int hiddenChars;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      expanded: expanded,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(R.sm),
        child: Container(
          constraints: const BoxConstraints(minHeight: kMinTouch),
          padding: const EdgeInsets.symmetric(vertical: S.x2),
          child: Row(
            children: [
              // Dashed in the draft accent, so the boundary reads as part of
              // the write clock — it is a thing you can still act on.
              const Expanded(child: _DashedRule()),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: S.x3),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      expanded ? 'see less' : 'see more',
                      style: T.xs.copyWith(
                        color: C.draft,
                        letterSpacing: 0.5,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (!expanded) ...[
                      const SizedBox(width: S.x1),
                      // What LinkedIn is hiding, in the reader's terms.
                      Text('· $hiddenChars more', style: T.xs),
                    ],
                    const SizedBox(width: S.x1),
                    Icon(
                      expanded ? Icons.expand_less : Icons.expand_more,
                      size: 16,
                      color: C.draft,
                    ),
                  ],
                ),
              ),
              const Expanded(child: _DashedRule()),
            ],
          ),
        ),
      ),
    );
  }
}

/// A dashed hairline. Drawn rather than using Divider, because a dash pattern
/// says "cut here" in a way a solid rule does not.
class _DashedRule extends StatelessWidget {
  const _DashedRule();

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        const dash = 5.0;
        const gap = 4.0;
        final count = (constraints.maxWidth / (dash + gap)).floor().clamp(0, 200);
        return Row(
          mainAxisSize: MainAxisSize.min,
          children: List.generate(
            count,
            (_) => Container(
              width: dash,
              height: 1,
              margin: const EdgeInsets.only(right: gap),
              color: C.draft.withValues(alpha: 0.35),
            ),
          ),
        );
      },
    );
  }
}

class _Scores extends StatelessWidget {
  const _Scores(this.scores);

  final Map<String, num> scores;

  static const _labels = {
    'persona_fit': 'persona fit',
    'category_fit': 'category fit',
    'novelty': 'novelty',
    'timeliness': 'timeliness',
    'non_duplication': 'non-duplication',
  };

  @override
  Widget build(BuildContext context) {
    final rows = scores.entries.where((e) => e.key != 'total').toList();
    return Column(
      children: rows.map((e) {
        final value = e.value.toDouble().clamp(0, 10) / 10;
        return Padding(
          padding: const EdgeInsets.only(bottom: S.x2),
          child: Row(
            children: [
              SizedBox(width: 110, child: Text(_labels[e.key] ?? e.key, style: T.xs)),
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    value: value.toDouble(),
                    minHeight: 4,
                    backgroundColor: C.surface3,
                    valueColor: const AlwaysStoppedAnimation(C.live),
                  ),
                ),
              ),
              SizedBox(
                width: 28,
                child: Text(
                  '${e.value}',
                  textAlign: TextAlign.right,
                  style: T.xs.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
                ),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }
}
