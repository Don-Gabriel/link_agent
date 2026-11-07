/// A draft or a published post, rendered as LinkedIn will render it.
///
/// This is the most important object in the app, so it is the one place the
/// layout rule bends: it IS a box, because it is a thing you act on. Inside the
/// box, though, the copy sits on the surface with nothing around it. Everything
/// that is not the post — the slug line, the schedule, the judge's reasoning,
/// the actions — is either a hairline away or folded out of sight.
///
/// What changed from the version this replaces:
///
///   * The judge's five score meters and its rationale used to sit open under
///     every draft, competing with the copy on every read. They are one
///     disclosure now, carrying the total, because "why did it pick this" is a
///     question asked occasionally.
///   * Send-now, edit and discard were three unlabelled icon squares. They are
///     named now: one primary, one secondary, the rest in a menu.
///   * Swipe is added as an accelerator — right to clear, left to discard —
///     and never as the only path to an action.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../theme.dart';
import '../timezones.dart';
import '../state/app_state.dart';
import 'primitives.dart';

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

String hhmm(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

/// A send time WITH its day, whenever the day is not today.
///
/// The bug this fixes: every send time on screen was a bare `HH:MM`. Pick 12:05
/// in the evening — when 12:05 has already gone — and the post correctly moves
/// to tomorrow, but the card then reads "Sends at 12:05, in 16h 5m", which
/// looks like the clock and the countdown are describing different events. The
/// countdown was right; the label was hiding the only thing that reconciled it.
///
/// Says nothing extra for today, because most posts go out today and "today"
/// on every card is noise.
String whenLabel(DateTime t, {String? timezone, DateTime? now}) {
  now ??= DateTime.now();
  if (timezone != null) {
    t = Timezones.at(t, timezone);
    now = Timezones.at(now, timezone);
  }
  final days = DateTime.utc(
    t.year,
    t.month,
    t.day,
  ).difference(DateTime.utc(now.year, now.month, now.day)).inDays;
  final label = switch (days) {
    0 => hhmm(t),
    1 => 'tomorrow ${hhmm(t)}',
    -1 => 'yesterday ${hhmm(t)}',
    _ => '${_weekday(t.weekday)} ${hhmm(t)}',
  };
  return timezone == null ? label : '$label · $timezone';
}

const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
String _weekday(int w) => _weekdays[(w - 1) % 7];

/// How often a countdown showing [remaining] actually needs to repaint.
///
/// Tied to what the display actually SHOWS, which is the bug this fixes. The
/// old rule repainted every twenty seconds above two minutes — but the hero clock
/// renders `mm:ss` for anything under an hour, so between two and sixty minutes
/// the seconds digit sat visibly frozen for twenty seconds and then jumped.
/// That is precisely what "the timer is not working" looks like.
///
/// So: a second while seconds are on screen, twenty otherwise. Above an hour
/// the finest thing said is minutes, and a one-second timer there would ask
/// Flutter to rebuild sixty times for every frame that could differ — once per
/// scheduled post on screen.
Duration countdownTick(Duration remaining) => remaining.abs().inHours < 1
    ? const Duration(seconds: 1)
    : const Duration(seconds: 20);

/// "in 12 min", "in 3h 40m", "2 min ago" — coarse on purpose above an hour.
String countdownWords(Duration d) {
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

/// A ticker that re-arms at the rate the distance to the deadline deserves,
/// and only replaces its timer when that rate actually changes.
mixin CountdownTicker<W extends StatefulWidget> on State<W> {
  Timer? _ticker;
  Duration? _interval;

  DateTime? get deadline;

  void startTicking() => _rearm();

  void _rearm() {
    final at = deadline;
    final next = countdownTick(
      at == null ? Duration.zero : at.difference(DateTime.now()),
    );
    if (_interval == next && _ticker != null) return;
    _interval = next;
    _ticker?.cancel();
    _ticker = Timer.periodic(next, (_) {
      if (!mounted) return;
      setState(() {});
      _rearm();
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }
}

// ------------------------------------------------------------------- the fold

/// The post, cut where LinkedIn cuts it — and the cut is the control.
///
/// Starts COLLAPSED, which is the whole point: what you see first is exactly
/// what a reader scrolling their feed sees first. Judge the hook against that,
/// then open the rest.
class FoldedCopy extends StatefulWidget {
  const FoldedCopy(this.text, {super.key, this.startExpanded = false});

  final String text;
  final bool startExpanded;

  @override
  State<FoldedCopy> createState() => _FoldedCopyState();
}

class _FoldedCopyState extends State<FoldedCopy> {
  late bool _expanded = widget.startExpanded;

  @override
  Widget build(BuildContext context) {
    final text = widget.text;

    // The fold falls at a character offset in the whole post, not at a line
    // break, so the text is split rather than measured — anything else would
    // put the marker where LinkedIn does not actually cut.
    if (text.length <= kFoldChars) {
      return Text(text, style: T.copy);
    }
    final above = text.substring(0, kFoldChars);
    final below = text.substring(kFoldChars);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(above, style: T.copy),
        FoldRule(
          expanded: _expanded,
          hiddenChars: below.trim().length,
          onTap: () => setState(() => _expanded = !_expanded),
        ),
        // Collapsed is not "hidden": the text above the fold is the whole post
        // as far as most readers are concerned, so what is below is simply not
        // shown until asked for.
        if (_expanded) Text(below, style: T.copy.copyWith(color: C.paperDim)),
      ],
    );
  }
}

/// The signature element. A dashed cut straight across the copy column,
/// breaking for a mono counter in the gutter, in the warm accent — because the
/// fold is a thing you can still do something about.
class FoldRule extends StatelessWidget {
  const FoldRule({
    super.key,
    required this.expanded,
    required this.hiddenChars,
    required this.onTap,
  });

  final bool expanded;
  final int hiddenChars;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: onTap != null,
      expanded: expanded,
      label: expanded
          ? 'Hide the $hiddenChars characters below the fold'
          : 'Show the $hiddenChars characters LinkedIn hides below the fold',
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(minHeight: kMinTouch),
          padding: const EdgeInsets.symmetric(vertical: S.x2),
          child: Row(
            children: [
              // Label first, then the cut running to the edge. A short stub of
              // dashes to the LEFT of the label read as a rendering accident
              // rather than a decision — a cut starts somewhere and goes.
              Padding(
                padding: const EdgeInsets.only(right: S.x3),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      expanded ? 'see less' : 'see more',
                      style: T.slug.copyWith(color: C.filament),
                    ),
                    const SizedBox(width: S.x2),
                    Text(
                      expanded ? '·' : '· $hiddenChars below',
                      style: T.mono.copyWith(fontSize: 11.5),
                    ),
                    const SizedBox(width: S.x1),
                    Icon(
                      expanded
                          ? Icons.keyboard_arrow_up
                          : Icons.keyboard_arrow_down,
                      size: 15,
                      color: C.filament,
                    ),
                  ],
                ),
              ),
              const Expanded(child: _DashedCut()),
            ],
          ),
        ),
      ),
    );
  }
}

/// A dashed hairline, drawn rather than borrowed from Divider — a dash pattern
/// says "cut here" in a way a solid rule does not.
class _DashedCut extends StatelessWidget {
  const _DashedCut();

  @override
  Widget build(BuildContext context) => CustomPaint(
    size: const Size(double.infinity, 1),
    painter: _DashPainter(),
  );
}

class _DashPainter extends CustomPainter {
  static const _dash = 4.0;
  static const _gap = 4.0;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = C.filament.withValues(alpha: 0.42)
      ..strokeWidth = 1;
    for (var x = 0.0; x < size.width; x += _dash + _gap) {
      canvas.drawLine(
        Offset(x, size.height / 2),
        Offset((x + _dash).clamp(0, size.width), size.height / 2),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

// ------------------------------------------------------------- the clock strip

/// When this post goes out, and whether anything still has to happen first.
///
/// Ticks, because the number that matters is how much of the review window is
/// left, and a countdown that only updates on pull-to-refresh invites you to
/// trust a figure that is already stale.
class ClockStrip extends StatefulWidget {
  const ClockStrip({super.key, required this.post, this.onTap, this.onRemove});

  final Post post;

  /// Change the time. The strip is the obvious place to tap for that.
  final VoidCallback? onTap;

  /// Take it off the timetable entirely.
  final VoidCallback? onRemove;

  @override
  State<ClockStrip> createState() => _ClockStripState();
}

class _ClockStripState extends State<ClockStrip> with CountdownTicker {
  @override
  DateTime? get deadline => widget.post.scheduledFor;

  @override
  void initState() {
    super.initState();
    startTicking();
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final at = post.scheduledFor!;
    final zone = context.watch<AppState?>()?.agent?.timezone;
    final remaining = at.difference(DateTime.now());

    // Five states, each needing a different action from the reader.
    final (Tone tone, IconData icon, String message) = switch (post) {
      _ when post.isMissed => (
        Tone.broken,
        Icons.event_busy,
        'Missed its ${whenLabel(at, timezone: zone)} slot — not sent late.',
      ),
      _ when post.isHeld => (
        Tone.desk,
        Icons.lock_clock,
        'Held while you edit. It will not send until you save.',
      ),
      _ when post.isCleared => (
        Tone.out,
        Icons.check_circle_outline,
        'Scheduled — publishes ${whenLabel(at, timezone: zone)}, ${countdownWords(remaining)}.',
      ),
      _ when remaining.isNegative => (
        Tone.desk,
        Icons.error_outline,
        'Due ${whenLabel(at, timezone: zone)} and not scheduled for publishing. Choose Schedule post or Publish now.',
      ),
      _ => (
        Tone.desk,
        Icons.schedule,
        'Sends ${whenLabel(at, timezone: zone)}, ${countdownWords(remaining)}. Schedule it before then.',
      ),
    };

    return Container(
      padding: const EdgeInsets.fromLTRB(S.x3, S.x2, S.x1, S.x2),
      decoration: BoxDecoration(
        color: tone.wash,
        border: Border(left: BorderSide(color: tone.ink, width: 2)),
        borderRadius: const BorderRadius.horizontal(
          right: Radius.circular(R.sm),
        ),
      ),
      child: Row(
        children: [
          Icon(icon, size: 15, color: tone.ink),
          const SizedBox(width: S.x2),
          Expanded(
            child: InkWell(
              onTap: widget.onTap,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: S.x2),
                child: Text(
                  message,
                  style: T.small.copyWith(color: tone.ink, height: 1.35),
                ),
              ),
            ),
          ),
          if (widget.onRemove != null)
            IconButton(
              onPressed: widget.onRemove,
              icon: const Icon(Icons.timer_off_outlined, size: 17),
              tooltip: 'Remove publish time',
              visualDensity: VisualDensity.compact,
              style: IconButton.styleFrom(
                foregroundColor: tone.ink.withValues(alpha: 0.75),
              ),
            ),
        ],
      ),
    );
  }
}

/// The one thing on the Desk with a deadline, at full weight.
///
/// The only orchestrated moment in the app: when an uncleared draft crosses
/// into its last two minutes the clock moves from the desk accent to the alarm,
/// because that is the last point at which a decision is still possible. It
/// earns the exception by marking something real.
class HeroClock extends StatefulWidget {
  const HeroClock({super.key, required this.post, this.onTap});

  final Post post;
  final VoidCallback? onTap;

  @override
  State<HeroClock> createState() => _HeroClockState();
}

class _HeroClockState extends State<HeroClock> with CountdownTicker {
  @override
  DateTime? get deadline => widget.post.scheduledFor;

  @override
  void initState() {
    super.initState();
    startTicking();
  }

  @override
  Widget build(BuildContext context) {
    final post = widget.post;
    final at = post.scheduledFor!;
    final remaining = at.difference(DateTime.now());

    // Cleared posts cool to the send clock: the card stops asking anything of
    // you the moment you have answered it.
    final urgent =
        !post.isCleared && remaining.inSeconds > 0 && remaining.inMinutes < 2;
    final tone = post.isMissed || urgent
        ? Tone.broken
        : post.isCleared
        ? Tone.out
        : Tone.desk;

    final (String figure, String caption) = switch (post) {
      _ when post.isMissed => ('missed', 'not sent late'),
      _ when post.isHeld => (_figure(remaining), 'held while you edit'),
      _ when remaining.isNegative => (
        'overdue',
        'not scheduled for publishing',
      ),
      _ when post.isCleared => (_figure(remaining), 'to send'),
      _ => (_figure(remaining), 'to review'),
    };

    return InkWell(
      onTap: widget.onTap,
      borderRadius: BorderRadius.circular(R.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                post.isCleared ? 'SCHEDULED' : 'NEXT OUT',
                style: T.slug.copyWith(color: tone.ink),
              ),
              const SizedBox(width: S.x3),
              Expanded(
                child: Divider(
                  color: tone.ink.withValues(alpha: 0.3),
                  height: 1,
                ),
              ),
            ],
          ),
          const SizedBox(height: S.x3),
          AnimatedDefaultTextStyle(
            duration: motionAllowed(context) ? kStateChange : Duration.zero,
            style: T.clock.copyWith(color: tone.ink),
            child: Text(figure),
          ),
          const SizedBox(height: S.x2),
          // The send time lives in the caption, NOT on the rule above the
          // clock. Up there it sat forty pixels from the countdown in the same
          // weight and the same colour, and two numbers of different kinds that
          // close together read as one thing measured twice.
          Text(
            '$caption · sends ${whenLabel(at, timezone: context.watch<AppState?>()?.agent?.timezone)}'
                .toUpperCase(),
            style: T.slug,
          ),
        ],
      ),
    );
  }

  /// `2h 13m` above an hour, `04:32` below it.
  ///
  /// Two formats rather than one, because a single h:mm form renders 2 hours 13
  /// minutes as "2:13" — which is exactly how anyone would write 2 minutes 13
  /// seconds. The unit letters are what make the long form unambiguous, and the
  /// colon form only ever appears when it genuinely means minutes and seconds.
  static String _figure(Duration d) {
    // No space between the two halves. Plex Mono is monospaced, so a space is a
    // FULL character advance — at 44pt that is a 26px hole punched through the
    // middle of the number, and it read as two separate figures. The unit
    // letters already do the separating.
    if (d.inHours >= 1) {
      return '${d.inHours}h${(d.inMinutes % 60).toString().padLeft(2, '0')}m';
    }
    return '${d.inMinutes.toString().padLeft(2, '0')}:'
        '${(d.inSeconds % 60).toString().padLeft(2, '0')}';
  }
}

/// The offer of a send time, on a draft that has none.
///
/// Reads as an invitation rather than an empty field: a draft with no time is
/// perfectly normal — you publish it when you get to it — so this must not look
/// like something left unfilled.
class OfferATime extends StatelessWidget {
  const OfferATime({super.key, required this.onTap});

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(R.sm),
      child: Container(
        constraints: const BoxConstraints(minHeight: kMinTouch),
        padding: const EdgeInsets.symmetric(horizontal: S.x3),
        decoration: BoxDecoration(
          border: Border.all(color: C.rule),
          borderRadius: BorderRadius.circular(R.sm),
        ),
        child: Row(
          children: [
            const Icon(Icons.schedule, size: 15, color: C.paperFaint),
            const SizedBox(width: S.x2),
            Expanded(
              child: Text(
                'Choose a publish time',
                style: T.small.copyWith(
                  color: onTap == null ? C.paperFaint : C.paperDim,
                ),
              ),
            ),
            Text('optional'.toUpperCase(), style: T.slug),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- the card

/// What a draft card is allowed to do. Passing null for any of these removes
/// the control rather than disabling it — an action that cannot apply should
/// not be on screen at all.
class DraftActions {
  const DraftActions({
    this.onClear,
    this.onSendNow,
    this.onSchedule,
    this.onUnschedule,
    this.onDiscard,
    this.onEdit,
    this.onFollowUp,
  });

  /// "Let it go at its scheduled time." Null when there is no time to clear it
  /// for, or when it has already been cleared.
  final VoidCallback? onClear;

  /// "Send it right now." The override.
  final VoidCallback? onSendNow;

  /// Give this ONE post a send time, or change the one it has.
  final VoidCallback? onSchedule;

  /// Take it back off the timetable, leaving a plain draft.
  final VoidCallback? onUnschedule;

  /// Offered only on posts that have gone out — a follow-up to a draft is a
  /// rewrite, and rewriting already exists.
  final VoidCallback? onFollowUp;

  final VoidCallback? onDiscard;
  final VoidCallback? onEdit;

  bool get any =>
      onClear != null ||
      onSendNow != null ||
      onDiscard != null ||
      onEdit != null ||
      onFollowUp != null;
}

class DraftCard extends StatelessWidget {
  const DraftCard({
    super.key,
    required this.post,
    this.actions = const DraftActions(),
    this.busy = false,
    this.emphasis = false,
    this.hero = false,
  });

  final Post post;
  final DraftActions actions;
  final bool busy;

  /// Brightens the edge. Used for the one draft on the Desk with a deadline.
  final bool emphasis;

  /// Swaps the one-line clock strip for the full countdown.
  ///
  /// Reserved for the next post due, and there is exactly one of those. The
  /// design this replaces showed that countdown on a separate screen from the
  /// draft it applied to, so the same post appeared twice in two different
  /// shapes — the hero on Schedule and a card in the Queue. One object, one
  /// place, with the deadline attached to the thing that has it.
  final bool hero;

  Tone get _tone => switch (post) {
    _ when post.isMissed => Tone.broken,
    _ when post.status == 'failed' => Tone.broken,
    _ when post.isPublished => Tone.out,
    _ when post.isCleared => Tone.out,
    _ => Tone.desk,
  };

  @override
  Widget build(BuildContext context) {
    final card = ObjectCard(
      tone: _tone,
      emphasis: emphasis,
      padding: const EdgeInsets.fromLTRB(S.x4, S.x3, S.x4, S.x3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _SlugLine(post: post, hero: hero),
          // No divider on the hero: the NEXT OUT rule immediately below does
          // that job, and two hairlines twenty pixels apart is a stutter.
          if (hero)
            const SizedBox(height: S.x3)
          else
            const Divider(color: C.rule, height: S.x4),

          if (post.isScheduled && !post.isPublished && hero) ...[
            HeroClock(post: post, onTap: busy ? null : actions.onSchedule),
            const SizedBox(height: S.x4),
          ] else if (post.isScheduled && !post.isPublished) ...[
            ClockStrip(
              post: post,
              onTap: busy ? null : actions.onSchedule,
              onRemove: busy ? null : actions.onUnschedule,
            ),
            const SizedBox(height: S.x4),
          ] else if (actions.onSchedule != null && !post.isPublished) ...[
            OfferATime(onTap: busy ? null : actions.onSchedule),
            const SizedBox(height: S.x4),
          ],

          if (post.reviewNotes.isNotEmpty && !post.isPublished) ...[
            Notice(
              tone: Tone.broken,
              icon: Icons.edit_note,
              title: 'Draft saved · review needed',
              body:
                  '${post.reviewNotes.join('\n')}\n${post.isCleared ? 'You approved this draft for its scheduled time.' : 'Automatic publishing waits for your review. Edit the draft or explicitly approve it.'}',
            ),
            const SizedBox(height: S.x3),
          ],
          FoldedCopy(post.text),
          for (final source in post.sources.where(
            (s) =>
                Uri.tryParse(s)?.scheme == 'https' ||
                Uri.tryParse(s)?.scheme == 'http',
          ))
            TextButton.icon(
              onPressed: () => launchUrl(
                Uri.parse(source),
                mode: LaunchMode.externalApplication,
              ),
              icon: const Icon(Icons.open_in_new, size: 16),
              label: Text('Source · ${Uri.parse(source).host}'),
            ),

          if (post.hashtags.isNotEmpty) ...[
            const SizedBox(height: S.x3),
            Text(
              post.hashtags.map((h) => '#$h').join('  '),
              style: T.copy.copyWith(color: C.daylight, fontSize: 15),
            ),
          ],

          if (post.rationale.isNotEmpty || post.scores.isNotEmpty) ...[
            const Divider(color: C.rule, height: S.x5),
            Disclosure(
              label: 'Why this one',
              trailing: _total(post.scores),
              child: _Judgement(rationale: post.rationale, scores: post.scores),
            ),
          ],

          if (actions.any) ...[
            const Divider(color: C.rule, height: S.x5),
            _Actions(post: post, actions: actions, busy: busy),
          ],
        ],
      ),
    );

    // Swipe is an accelerator on the recurring job — approving and turning
    // down drafts — never the only way to reach either. Offered only when both
    // meanings are unambiguous on this post.
    final canSwipeClear = actions.onClear != null && !busy;
    final canSwipeDiscard = actions.onDiscard != null && !busy;
    if (!canSwipeClear && !canSwipeDiscard) return card;

    return Dismissible(
      key: ValueKey('swipe-${post.seq}'),
      direction: canSwipeClear && canSwipeDiscard
          ? DismissDirection.horizontal
          : canSwipeClear
          ? DismissDirection.startToEnd
          : DismissDirection.endToStart,
      dismissThresholds: const {
        DismissDirection.startToEnd: 0.4,
        DismissDirection.endToStart: 0.4,
      },
      background: const _SwipeHint(
        tone: Tone.out,
        icon: Icons.check,
        label: 'Schedule post',
        alignment: Alignment.centerLeft,
      ),
      secondaryBackground: const _SwipeHint(
        tone: Tone.broken,
        icon: Icons.delete_outline,
        label: 'Discard',
        alignment: Alignment.centerRight,
      ),
      confirmDismiss: (direction) async {
        if (direction == DismissDirection.startToEnd) {
          actions.onClear?.call();
          // Clearing is reversible and its reward is the card changing state in
          // place, so the card stays put rather than flying off the list.
          return false;
        }
        actions.onDiscard?.call();
        // Discarding opens a confirmation of its own; the refresh behind it is
        // what removes the card.
        return false;
      },
      child: card,
    );
  }

  static String? _total(Map<String, num> scores) {
    final total = scores['total'];
    if (total != null) return '${total.toStringAsFixed(1)} / 10';
    if (scores.isEmpty) return null;
    final rest = scores.entries.where((e) => e.key != 'total').toList();
    if (rest.isEmpty) return null;
    final mean =
        rest.fold<double>(0, (a, e) => a + e.value.toDouble()) / rest.length;
    return '${mean.toStringAsFixed(1)} / 10';
  }
}

/// Where a story came from and what state it is in, set as one line above a
/// hairline — the way a slug line sits above copy.
class _SlugLine extends StatelessWidget {
  const _SlugLine({required this.post, this.hero = false});

  final Post post;

  /// On a hero card the countdown's eyebrow already says CLEARED or NEXT OUT in
  /// larger type an inch below, so repeating the state word here was the same
  /// word twice on one card.
  final bool hero;

  @override
  Widget build(BuildContext context) {
    final stamp = post.publishedAt ?? post.createdAt;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Expanded(
          // Wrap, not Row: several markers plus an id do not fit on a narrow
          // phone, and a clipped state word is worse than a second line.
          child: Wrap(
            spacing: S.x2,
            runSpacing: S.x1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(post.id, style: T.mono.copyWith(color: C.paperDim)),
              // Nested, not `!hero && ... case`: the pattern binds to the whole
              // `&&` expression, which is a bool.
              if (!hero)
                if (_stateWord(post) case final word?)
                  Slug(word.$1, tone: word.$2, icon: word.$3),
              if (post.kind == 'custom') const Slug('yours'),
              if (post.usedQuote) const Slug('quote'),
            ],
          ),
        ),
        if (stamp != null) ...[
          const SizedBox(width: S.x2),
          Text(relativeTime(stamp), style: T.micro),
        ],
      ],
    );
  }

  /// Only states worth naming. A plain unscheduled draft says nothing here —
  /// the whole screen is drafts, so labelling each one "draft" is noise.
  ///
  /// Cleared is checked before the status, because the server calls a cleared
  /// post "approved" and that word means two different things depending on
  /// whether a send time is still ahead of it: waiting to go out, or having
  /// failed to. The reader's word for the first one is "cleared".
  static (String, Tone, IconData?)? _stateWord(Post post) {
    if (post.isPublished) return ('published', Tone.out, Icons.check);
    if (post.isCleared && (post.isDraft || post.status == 'approved')) {
      return ('scheduled', Tone.out, Icons.check);
    }
    return switch (post.status) {
      'approved' => ('not sent', Tone.desk, Icons.schedule),
      'failed' => ('send failed', Tone.broken, Icons.priority_high),
      'missed' => ('missed', Tone.broken, Icons.event_busy),
      'unknown' => ('unconfirmed', Tone.broken, Icons.help_outline),
      _ => null,
    };
  }
}

/// The judge's reasoning and its five criteria, behind the disclosure.
class _Judgement extends StatelessWidget {
  const _Judgement({required this.rationale, required this.scores});

  final String rationale;
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
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (rationale.isNotEmpty) ...[
          Container(
            padding: const EdgeInsets.only(left: S.x3),
            decoration: const BoxDecoration(
              border: Border(left: BorderSide(color: C.ruleStrong, width: 2)),
            ),
            child: Text(rationale, style: T.small),
          ),
          if (rows.isNotEmpty) const SizedBox(height: S.x4),
        ],
        for (final row in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: S.x2),
            child: Row(
              children: [
                SizedBox(
                  width: 104,
                  child: Text(_labels[row.key] ?? row.key, style: T.micro),
                ),
                Expanded(child: Meter(value: row.value.toDouble() / 10)),
                SizedBox(
                  width: 30,
                  child: Text(
                    '${row.value}',
                    textAlign: TextAlign.right,
                    style: T.data.copyWith(fontSize: 12.5),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// One named primary, one named secondary, everything else in a menu.
class _Actions extends StatelessWidget {
  const _Actions({
    required this.post,
    required this.actions,
    required this.busy,
  });

  final Post post;
  final DraftActions actions;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    // A published post has no send controls left, so the follow-up stands on
    // its own — it is the only thing still worth doing with a post that is out.
    if (actions.onClear == null &&
        actions.onSendNow == null &&
        actions.onFollowUp != null) {
      return SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          onPressed: busy ? null : actions.onFollowUp,
          icon: const Icon(Icons.subdirectory_arrow_right, size: 17),
          label: const Text('Write a follow-up'),
        ),
      );
    }

    // On a scheduled post the primary action clears it for its own time and
    // sending now is the override. On an unscheduled one there is no time to
    // clear it for, so sending is the only thing approving can mean.
    final Widget? primary = actions.onClear != null
        ? FilledButton.icon(
            onPressed: busy ? null : actions.onClear,
            icon: const Icon(Icons.check, size: 17),
            // Just "Clear". The time it clears FOR is stated immediately above
            // on every card that has one — in the hero caption or in the clock
            // strip — so repeating it here bought nothing and cost a wrap: at
            // 390pt, "Clear for 16:33" plus Send now plus the menu does not fit
            // on one line, and a two-line primary button on the most-pressed
            // control in the app is not a trade worth making.
            label: const Text('Schedule post'),
          )
        : actions.onSendNow != null
        ? FilledButton.icon(
            onPressed: busy ? null : actions.onSendNow,
            icon: const Icon(Icons.send, size: 17),
            label: const Text('Publish now'),
          )
        : null;

    final menu = <PopupMenuEntry<VoidCallback>>[
      if (actions.onEdit != null)
        PopupMenuItem(
          value: actions.onEdit,
          child: const _MenuRow(Icons.edit_outlined, 'Edit'),
        ),
      if (actions.onSchedule != null)
        PopupMenuItem(
          value: actions.onSchedule,
          child: _MenuRow(
            Icons.schedule,
            post.isScheduled ? 'Change publish time' : 'Choose publish time',
          ),
        ),
      if (actions.onUnschedule != null)
        PopupMenuItem(
          value: actions.onUnschedule,
          child: const _MenuRow(
            Icons.timer_off_outlined,
            'Remove publish time',
          ),
        ),
      if (actions.onFollowUp != null)
        PopupMenuItem(
          value: actions.onFollowUp,
          child: const _MenuRow(
            Icons.subdirectory_arrow_right,
            'Write a follow-up',
          ),
        ),
      if (actions.onDiscard != null)
        PopupMenuItem(
          value: actions.onDiscard,
          child: const _MenuRow(
            Icons.delete_outline,
            'Discard',
            tone: Tone.broken,
          ),
        ),
    ];

    return Wrap(
      spacing: S.x2,
      runSpacing: S.x2,
      children: [
        ?primary,
        // Both at once only when clearing is primary — then this is the "never
        // mind the schedule" escape hatch.
        if (actions.onClear != null && actions.onSendNow != null) ...[
          OutlinedButton(
            onPressed: busy ? null : actions.onSendNow,
            child: const Text('Publish now'),
          ),
        ],
        if (menu.isNotEmpty) ...[
          PopupMenuButton<VoidCallback>(
            enabled: !busy,
            tooltip: 'More actions',
            color: C.ink3,
            position: PopupMenuPosition.under,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(R.md),
              side: const BorderSide(color: C.rule),
            ),
            icon: const Icon(Icons.more_horiz),
            style: IconButton.styleFrom(
              minimumSize: const Size(kMinTouch, kMinTouch),
              side: const BorderSide(color: C.ruleStrong),
              foregroundColor: C.paperDim,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(R.sm),
              ),
            ),
            itemBuilder: (_) => menu,
            onSelected: (action) => action(),
          ),
        ],
      ],
    );
  }
}

class _MenuRow extends StatelessWidget {
  const _MenuRow(this.icon, this.label, {this.tone = Tone.quiet});

  final IconData icon;
  final String label;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    final colour = tone == Tone.quiet ? C.paper : tone.ink;
    return Row(
      children: [
        Icon(icon, size: 18, color: tone == Tone.quiet ? C.paperFaint : colour),
        const SizedBox(width: S.x3),
        Flexible(
          child: Text(label, style: T.body.copyWith(color: colour)),
        ),
      ],
    );
  }
}

/// What a swipe is about to do, revealed under the card.
class _SwipeHint extends StatelessWidget {
  const _SwipeHint({
    required this.tone,
    required this.icon,
    required this.label,
    required this.alignment,
  });

  final Tone tone;
  final IconData icon;
  final String label;
  final Alignment alignment;

  @override
  Widget build(BuildContext context) => Container(
    alignment: alignment,
    padding: const EdgeInsets.symmetric(horizontal: S.x5),
    decoration: BoxDecoration(
      color: tone.wash,
      borderRadius: BorderRadius.circular(R.md),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 18, color: tone.ink),
        const SizedBox(width: S.x2),
        Text(label.toUpperCase(), style: T.slug.copyWith(color: tone.ink)),
      ],
    ),
  );
}
