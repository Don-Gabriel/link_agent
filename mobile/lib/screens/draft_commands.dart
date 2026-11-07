/// Everything you can do to a post, in one place.
///
/// The Desk and the Archive both render posts and both need the same verbs, so
/// the confirmations, the wording and the undo live here rather than being
/// written twice and drifting apart.
///
/// Two rules run through all of it:
///
///   * Anything irreversible on LinkedIn's side asks first — including in dry
///     run, so the habit is identical when live mode is on.
///   * Anything reversible does NOT ask, and offers undo instead. Clearing a
///     draft is one tap away from being un-cleared until its time comes, so a
///     dialog in front of it would be a tax on the action you take most.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../timezones.dart';
import '../theme.dart';
import '../widgets/draft_card.dart';
import 'composer_screen.dart';

/// Build the action set for [post].
///
/// [actionable] is false for an ambiguous send — one LinkedIn never confirmed —
/// which must not be republished blind.
DraftActions commandsFor(
  BuildContext context,
  Post post, {
  bool actionable = true,
}) {
  if (post.status == 'unknown') return const DraftActions();
  if (!actionable) return const DraftActions();

  if (post.isPublished) {
    // The one thing still worth doing with a post that has gone out. Answers
    // with text and saves nothing, then opens the composer with it loaded.
    return DraftActions(onFollowUp: () => followUp(context, post.seq));
  }

  return DraftActions(
    // On a scheduled post the primary action clears it for its own time. On an
    // unscheduled one there is no time to clear it for, so sending is the only
    // thing approving can mean.
    onClear:
        post.isScheduled &&
            !post.isCleared &&
            post.scheduledFor!.isAfter(DateTime.now())
        ? () => clearForItsTime(context, post)
        : null,
    onSendNow: () => sendNow(context, post),
    // Offered on every unpublished draft, whether or not it came from a slot.
    // A post from the agent arrives with its slot's time; one from "run a cycle
    // now" or the composer arrives with none, and this is how it gets one.
    onSchedule: () => pickSendTime(context, post),
    onUnschedule: post.isScheduled ? () => removeSendTime(context, post) : null,
    onDiscard: () => discard(context, post),
    onEdit: () => context.read<AppState>().startEditing(post),
  );
}

/// "I have read it. Let it go at its time."
///
/// NOT publishing, and the difference is the point of the whole schedule.
/// Nothing reaches LinkedIn now, so it does not need the irreversibility
/// warning that [sendNow] does — it is one tap from reversible until the time
/// comes, and the snackbar says so.
Future<void> clearForItsTime(BuildContext context, Post post) async {
  final state = context.read<AppState>();
  final messenger = ScaffoldMessenger.of(context);
  final at = post.scheduledFor;
  final error = await state.clear(post.seq, reviewed: post);
  messenger.showSnackBar(
    SnackBar(
      content: Text(
        error ??
            'Scheduled — publishes ${at == null ? "at its time" : whenLabel(at, timezone: state.agent?.timezone)}.',
      ),
      action: error != null
          ? null
          : SnackBarAction(
              label: 'Undo',
              onPressed: () => state.unclear(post.seq),
            ),
      persist: false,
      duration: const Duration(seconds: 6),
    ),
  );
}

/// Publishing is irreversible on LinkedIn's side, so it always asks.
Future<void> sendNow(BuildContext context, Post post) async {
  final state = context.read<AppState>();
  final live = state.status?.liveMode ?? false;
  final scheduled = post.scheduledFor;

  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(live ? 'Publish now?' : 'Publish now (dry run)?'),
      content: Text(
        !live
            ? 'Live mode is off, so nothing will actually reach LinkedIn.'
            : scheduled != null
            ? 'This posts to your profile immediately, instead of ${whenLabel(scheduled, timezone: state.agent?.timezone)}. '
                  'It cannot be unpublished from here.'
            : 'This posts to your profile now. It cannot be unpublished from here.',
        style: T.small,
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Publish now'),
        ),
      ],
    ),
  );
  if (ok != true || !context.mounted) return;

  final messenger = ScaffoldMessenger.of(context);
  final error = await state.sendNow(post.seq, reviewed: post);
  messenger.showSnackBar(
    SnackBar(content: Text(error ?? 'Published ${post.id}.')),
  );
}

/// Give this one post a send time.
///
/// A plain time picker, not a date picker: "publish this at 21:00" is how the
/// decision is actually made. A time that has already passed today means
/// tomorrow, because nobody picking 07:00 at midnight means seven hours ago.
Future<void> pickSendTime(BuildContext context, Post post) async {
  final state = context.read<AppState>();
  final zone = state.agent?.timezone ?? 'UTC';
  final existing = Timezones.at(post.scheduledFor ?? DateTime.now(), zone);
  final picked = await showTimePicker(
    context: context,
    initialTime: TimeOfDay(hour: existing.hour, minute: existing.minute),
    helpText: 'SEND TIME · $zone',
  );
  if (picked == null || !context.mounted) return;

  final when = Timezones.nextTime(zone, picked.hour, picked.minute);

  final messenger = ScaffoldMessenger.of(context);
  final error = await state.reschedule(post.seq, when);
  messenger.showSnackBar(
    SnackBar(
      content: Text(
        error ??
            'Sends ${whenLabel(when, timezone: zone)}. Schedule it before then or publish it manually.',
      ),
    ),
  );
}

Future<void> removeSendTime(BuildContext context, Post post) async {
  final state = context.read<AppState>();
  final messenger = ScaffoldMessenger.of(context);
  final error = await state.reschedule(post.seq, null);
  messenger.showSnackBar(
    SnackBar(
      content: Text(error ?? 'Send time removed. It waits for you now.'),
    ),
  );
}

Future<void> discard(BuildContext context, Post post) async {
  final state = context.read<AppState>();
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Discard this draft?'),
      content: const Text(
        'It leaves the queue, and the story will not be written about again.',
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
            foregroundColor: C.paper,
          ),
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Discard'),
        ),
      ],
    ),
  );
  if (ok != true || !context.mounted) return;

  final messenger = ScaffoldMessenger.of(context);
  final error = await state.discard(post.seq);
  messenger.showSnackBar(
    SnackBar(content: Text(error ?? 'Discarded ${post.id}.')),
  );
}

/// Ask for a follow-up, then hand it to the composer.
///
/// This is the slowest thing in the app and it is worth saying so. The writer
/// call is paced four seconds behind any other model call, then usually spends
/// a SECOND call repairing the draft to the author's word range — half a minute
/// is normal and a minute is not alarming.
///
/// The notice is brief; the request continues after it disappears. Completion
/// must not dismiss a different notification that arrived in the meantime.
Future<void> followUp(BuildContext context, int seq) async {
  final messenger = ScaffoldMessenger.of(context);
  messenger.showSnackBar(
    const SnackBar(
      content: Row(
        children: [
          SizedBox(
            width: 16,
            height: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          SizedBox(width: S.x3),
          Expanded(
            child: Text('Writing a follow-up — this takes up to a minute.'),
          ),
        ],
      ),
      duration: Duration(seconds: 6),
      persist: false,
    ),
  );
  final error = await context.read<AppState>().followUp(seq);
  if (error != null) {
    messenger.showSnackBar(SnackBar(content: Text(error)));
  }
  // On success the state bump opens the composer with the follow-up loaded;
  // see the compose request watcher in the shell.
}

/// Why a post is sitting outside the draft list, in the reader's terms.
String explainStranded(String status) => switch (status) {
  'approved' =>
    'This post has not been sent. Choose a publish time or use Publish now.',
  'failed' => 'The last send was rejected. Fix the text and try again.',
  'unknown' =>
    'LinkedIn never confirmed this send. Check your profile, then resolve it '
        'below before trying again.',
  'missed' => 'The send time passed. Choose a new time or use Publish now.',
  _ => '',
};

Future<void> resolveSend(BuildContext context, Post post) async {
  final state = context.read<AppState>();
  final messenger = ScaffoldMessenger.of(context);
  final didPublish = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Check your LinkedIn profile'),
      content: const Text(
        'Look for this exact post on your profile before choosing. If you cannot tell yet, cancel and check again later.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Confirmed: not published'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Confirmed: published'),
        ),
      ],
    ),
  );
  if (didPublish == null) return;
  final error = await state.mutate(
    () => state.api.patch('/api/posts/${post.seq}', {
      'action': 'resolve',
      'didPublish': didPublish,
    }),
  );
  messenger.showSnackBar(
    SnackBar(
      content: Text(
        error ??
            (didPublish
                ? 'Marked as published.'
                : 'Returned to Drafts. Review it before sending again.'),
      ),
    ),
  );
}

/// Ask the agent to run a whole cycle right now, off the timetable.
Future<void> runCycleNow(BuildContext context) async {
  final messenger = ScaffoldMessenger.of(context);
  final error = await context.read<AppState>().runCycleNow();
  messenger.showSnackBar(
    SnackBar(
      content: Text(
        error ??
            'Started in the cloud. You can close ByLine; we’ll notify you when the draft is ready or needs attention.',
      ),
    ),
  );
}

/// Open the composer for a brand new post.
void writeSomething(BuildContext context) {
  context.read<AppState>().stopEditing();
  openComposer(context);
}
