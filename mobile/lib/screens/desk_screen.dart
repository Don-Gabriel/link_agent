/// The desk: the deadline, what is waiting on you, and the day so far.
///
/// This is the screen the app exists for. The daily loop is
///
///   1. is anything waiting on me, and how long have I got
///   2. read it properly, above the fold first
///   3. decide
///
/// and all three now happen without leaving this page. The design this replaces
/// split them: the countdown lived on Schedule, the drafts on Queue, so the
/// most urgent object in the product was rendered twice, in two shapes, one tab
/// apart. Here the next post due IS the first draft on the page, wearing its
/// countdown.
///
/// Order is by claim on your attention, not by category:
///
///   conditions   anything that makes the rest of the screen mean something
///                different — a stopped scheduler, a dead token
///   the lede     the next post out, at full weight
///   the desk     every other draft asking for a decision
///   stranded     posts that failed or were never confirmed
///   today        the rail — including the slots that chose silence
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/day_rail.dart';
import '../widgets/draft_card.dart';
import '../widgets/primitives.dart';
import 'draft_commands.dart';
import 'settings_screen.dart';
import '../widgets/editorial.dart';
import '../widgets/preparation_progress.dart';

class DeskScreen extends StatelessWidget {
  const DeskScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final status = state.status;

    return RefreshIndicator(
      onRefresh: state.refresh,
      backgroundColor: C.ink2,
      color: C.filament,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(S.x4, S.x4, S.x4, S.x7),
        children: [
          _Masthead(state: state),
          const SizedBox(height: S.x5),
          const StudioBanner(
            compact: true,
            title: 'Good ideas start here.',
            eyebrow: 'ON YOUR DESK',
            caption: 'A place to read, refine and make each post your own.',
          ),
          const SizedBox(height: S.x5),
          if (status == null)
            const _Waiting()
          else
            ..._body(context, state, status),
        ],
      ),
    );
  }

  List<Widget> _body(BuildContext context, AppState state, AppStatus status) {
    final queue = status.queue;
    final next = status.nextDue;
    final drafts = queue
        .where(
          (p) =>
              p.isDraft ||
              (p.status == 'approved' && p.isScheduled && p.isCleared),
        )
        .toList();
    // Stranded means "this went wrong and needs a hand". A post that has been
    // cleared is 'approved' on the server too, so without the schedule check a
    // perfectly healthy cleared draft was filed under "needs a hand" and told
    // the reader its publish had failed — while ALSO appearing above as the
    // lede, which is the same post twice on one screen.
    final stranded = queue
        .where(
          (p) =>
              !p.isDraft &&
              !p.isPublished &&
              p.seq != next?.seq &&
              !(p.isScheduled && p.isCleared),
        )
        .toList();
    final rest = drafts.where((p) => p.seq != next?.seq).toList();
    final today =
        status.timeline.where((e) => e.runDate == _localToday()).toList()
          ..sort((a, b) => a.localTime.compareTo(b.localTime));

    return [
      ..._conditions(context, state, status),
      if (state.generation?['state'] == 'failed') ...[
        Text('Draft preparation could not finish', style: T.bodyStrong),
        const SizedBox(height: 8),
        Text(
          state.generation?['error'] as String? ??
              'Please try preparing the draft again.',
          style: T.body,
        ),
        const SizedBox(height: S.x4),
      ],
      if (state.preparingDraft) ...[
        PreparationProgress(
          progress: {
            'state': 'working',
            'stage': state.generation?['stage'] ?? 'discovering',
            'completed': [
              'discovering',
              'judging',
              'writing',
              'saving',
            ].indexOf(state.generation?['stage'] ?? 'discovering').clamp(0, 3),
          },
        ),
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 12),
          child: Text(
            'You can close ByLine. We’ll notify you when the draft is ready or needs attention.',
          ),
        ),
      ],

      // The lede. One object, wearing its own deadline.
      if (next != null) ...[
        DraftCard(
          post: next,
          hero: true,
          emphasis: true,
          busy: state.loading,
          actions: commandsFor(context, next),
        ),
        const SizedBox(height: S.x5),
      ],

      if (rest.isNotEmpty) ...[
        SectionRule(
          next == null ? 'On the desk' : 'Also on the desk',
          tone: Tone.desk,
          trailing: Text(
            '${rest.length}',
            style: T.data.copyWith(color: C.filament),
          ),
        ),
        for (final post in rest) ...[
          DraftCard(
            post: post,
            busy: state.loading,
            actions: commandsFor(context, post),
          ),
          const SizedBox(height: S.x4),
        ],
        const SizedBox(height: S.x4),
      ],

      if (stranded.isNotEmpty) ...[
        const SectionRule('Needs a hand', tone: Tone.broken),
        for (final post in stranded) ...[
          Padding(
            padding: const EdgeInsets.only(bottom: S.x2),
            child: Text(explainStranded(post.status), style: T.small),
          ),
          DraftCard(
            post: post,
            busy: state.loading,
            actions: commandsFor(
              context,
              post,
              actionable: post.status != 'unknown',
            ),
          ),
          if (post.status == 'unknown')
            OutlinedButton(
              onPressed: state.loading
                  ? null
                  : () => resolveSend(context, post),
              child: const Text('Confirm publishing result'),
            ),
          const SizedBox(height: S.x4),
        ],
        const SizedBox(height: S.x4),
      ],

      if (next == null &&
          drafts.isEmpty &&
          stranded.isEmpty &&
          !state.loading &&
          !state.preparingDraft)
        Empty(
          icon: Icons.done_all,
          title: 'Nothing on the desk',
          blurb: status.slots.isEmpty
              ? 'There are no posting times set yet, so the agent has nothing to write to. '
                    'Add one in Settings → Timetable.'
              : 'The agent reads on its timetable and stays quiet on days when nothing '
                    'clears the bar. Check the Archive to see what it passed over.',
          actionLabel: 'Ask it to write one now',
          onAction: state.loading || (state.agent?.paused ?? false)
              ? null
              : () => runCycleNow(context),
        ),

      if (today.isNotEmpty) ...[
        const SizedBox(height: S.x2),
        const SectionRule('Today'),
        DayRail(entries: today),
        const SizedBox(height: S.x5),
      ] else if (drafts.isNotEmpty) ...[
        const SectionRule('Today'),
        Text(
          next == null
              ? 'No posting time has run yet today.'
              : 'The first posting time of the day has not reported in yet.',
          style: T.small,
        ),
        const SizedBox(height: S.x5),
      ],

      // The agent's counterpart to the write button: this one asks IT to write.
      // Named to be unmistakably different from writing something yourself.
      if (drafts.isNotEmpty || stranded.isNotEmpty)
        OutlinedButton.icon(
          onPressed:
              state.loading ||
                  state.preparingDraft ||
                  (state.agent?.paused ?? false)
              ? null
              : () => runCycleNow(context),
          icon: const Icon(Icons.auto_awesome_outlined, size: 17),
          label: const Text('Ask the agent to write one now'),
        ),
      if (state.agent?.paused ?? false)
        const Padding(
          padding: EdgeInsets.only(top: S.x2),
          child: Text(
            'Paused — turn it back on in Settings → Timetable.',
            style: T.micro,
          ),
        ),
    ];
  }

  /// Anything that changes what the rest of the screen means, ONE LINE EACH.
  ///
  /// These sit between the reader and the thing with a countdown, so they have
  /// to earn their height. The first cut of this screen used the full
  /// three-line [Notice] and stacked two of them — an expiring token and a dry
  /// run — which between them pushed the deadline off the bottom of a 390pt
  /// phone. The explanation belongs on the settings page that owns the problem;
  /// here, one line and a way to get there.
  ///
  /// Dry run is deliberately NOT in this list. The masthead already carries it
  /// as a state chip forty pixels above, it is a standing condition rather than
  /// news, and it would otherwise be the permanent first thing on the screen
  /// for as long as live mode stays off — which is on purpose, for days.
  List<Widget> _conditions(
    BuildContext context,
    AppState state,
    AppStatus status,
  ) {
    final out = <Widget>[];

    void add(Widget w) {
      out.add(w);
      out.add(const SizedBox(height: S.x2));
    }

    if (!status.scheduler.healthy) {
      add(
        ConditionStrip(
          tone: Tone.broken,
          icon: Icons.cloud_off,
          text: status.scheduler.neverRan
              ? 'The scheduler never started — no posting time will fire'
              : 'The scheduler stopped — posting times will not fire',
          onTap: () => openTimetable(context),
        ),
      );
    }

    if (status.account.needsReauth) {
      add(
        ConditionStrip(
          tone: Tone.broken,
          icon: Icons.link_off,
          text: 'LinkedIn access expired — nothing can publish',
          onTap: () => openLinkedIn(context),
        ),
      );
    } else if (status.account.expiringSoon) {
      add(
        ConditionStrip(
          tone: Tone.desk,
          icon: Icons.schedule,
          text:
              'LinkedIn access expires in ${status.account.daysRemaining} days',
          onTap: () => openLinkedIn(context),
        ),
      );
    }

    if (state.error != null) add(ErrorNote(state.error!));

    if (out.isNotEmpty) out.add(const SizedBox(height: S.x2));
    return out;
  }

  static String _localToday() {
    final now = DateTime.now();
    return '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
  }
}

/// The date, the name of the page, and what the agent is currently doing.
///
/// A masthead rather than an app bar: the Desk earns the full width, and the
/// state words here are the answer to "why is nothing happening" — paused, dry
/// run, waiting on you — which is otherwise a trip into settings.
class _Masthead extends StatelessWidget {
  const _Masthead({required this.state});

  final AppState state;

  static const _days = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  static const _months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final status = state.status;
    final agent = state.agent;
    final waiting = state.onTheDesk;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              '${_days[now.weekday - 1]}  ${now.day}  ${_months[now.month - 1]}',
              style: T.slug,
            ),
            const Spacer(),
            WriteButton(onTap: () => writeSomething(context)),
            const SizedBox(width: S.x2),
            if (state.loading)
              const SizedBox(
                height: 16,
                width: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            else
              IconButton(
                onPressed: state.refresh,
                icon: const Icon(Icons.refresh, size: 20),
                tooltip: 'Refresh',
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
              ),
          ],
        ),
        const SizedBox(height: S.x2),
        Row(
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            const Text('The desk', style: T.display),
            const SizedBox(width: S.x3),
            Expanded(
              child: Text(
                waiting > 0 ? '$waiting waiting on you' : 'nothing waiting',
                style: T.slug.copyWith(
                  color: waiting > 0 ? C.filament : C.paperFaint,
                ),
              ),
            ),
          ],
        ),
        if (status != null && agent != null) ...[
          const SizedBox(height: S.x3),
          Wrap(
            spacing: S.x2,
            runSpacing: S.x2,
            children: [
              // Colour marks the ABNORMAL case only. All three of these lit up
              // in three different colours on a perfectly ordinary day, which
              // is three colours saying nothing. Paused, dry run and
              // publishes-itself are the three states that would make someone
              // say "wait, what?" — their opposites are the quiet default.
              Slug(
                agent.paused ? 'paused' : 'running',
                tone: agent.paused ? Tone.desk : Tone.quiet,
                icon: agent.paused ? Icons.pause : null,
              ),
              Slug(
                status.liveMode ? 'live' : 'dry run',
                tone: status.liveMode ? Tone.quiet : Tone.desk,
              ),
              Slug(
                agent.autoPublish ? 'publishes itself' : 'waits for you',
                tone: agent.autoPublish ? Tone.desk : Tone.quiet,
              ),
            ],
          ),
        ],
      ],
    );
  }
}

/// First load, before any status has arrived. A skeleton of the shape that is
/// coming, rather than a spinner in the middle of an empty page — the layout
/// should not jump when the data lands.
class _Waiting extends StatelessWidget {
  const _Waiting();

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      for (final height in [120.0, 220.0])
        Padding(
          padding: const EdgeInsets.only(bottom: S.x3),
          child: Container(
            height: height,
            decoration: BoxDecoration(
              color: C.ink2,
              border: Border.all(color: C.rule),
              borderRadius: BorderRadius.circular(R.md),
            ),
          ),
        ),
    ],
  );
}
