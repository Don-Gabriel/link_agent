/// The editorial tab: what needs deciding, what went out, and what was passed
/// over.
///
/// Three segments rather than three tabs. They are the same subject — the
/// agent's output — viewed at different stages, and the bottom bar is already
/// carrying four destinations. Reading a draft properly IS the job, so the
/// queue is first and its text is always fully expanded; the only thing hidden
/// is what LinkedIn itself hides, and that boundary is drawn rather than
/// applied.
///
/// "Passed over" earns its place: seeing what the judge rejected, and why, is
/// the fastest way to tell whether the categories and the threshold are set
/// right. A queue that is empty for three days means something different if the
/// rejection log is full than if it is also empty.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/panel.dart';
import '../widgets/post_card.dart';

enum _Segment { queue, published, passed }

class QueueScreen extends StatefulWidget {
  const QueueScreen({super.key});

  @override
  State<QueueScreen> createState() => _QueueScreenState();
}

class _QueueScreenState extends State<QueueScreen> {
  _Segment _segment = _Segment.queue;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final status = state.status;

    return RefreshIndicator(
      onRefresh: state.refresh,
      backgroundColor: C.surface2,
      color: C.draft,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(S.x4, S.x4, S.x4, S.x7),
        children: [
          _SegmentBar(
            value: _segment,
            queueCount: status?.queue.where((p) => p.isDraft).length ?? 0,
            onChanged: (v) => setState(() => _segment = v),
          ),
          const SizedBox(height: S.x4),
          ...switch (_segment) {
            _Segment.queue => _queue(context, state, status),
            _Segment.published => _published(status),
            _Segment.passed => _passed(status),
          },
        ],
      ),
    );
  }

  // ------------------------------------------------------------ segments

  List<Widget> _queue(BuildContext context, AppState state, AppStatus? status) {
    final queue = status?.queue ?? const <Post>[];
    final drafts = queue.where((p) => p.isDraft).toList();
    final other = queue.where((p) => !p.isDraft).toList();

    return [
      if (status != null && !status.liveMode) ...[
        const _Notice(
          tone: BadgeTone.warn,
          icon: Icons.science_outlined,
          title: 'Dry run',
          body: 'Publishing is disabled. Approving a draft will not reach LinkedIn.',
        ),
        const SizedBox(height: S.x4),
      ],
      if (status != null && status.account.needsReauth) ...[
        const _Notice(
          tone: BadgeTone.alarm,
          icon: Icons.link_off,
          title: 'LinkedIn needs reconnecting',
          body: 'The access token expired. Reconnect from the web dashboard to resume posting.',
        ),
        const SizedBox(height: S.x4),
      ] else if (status != null && status.account.expiringSoon) ...[
        _Notice(
          tone: BadgeTone.warn,
          icon: Icons.schedule,
          title: 'Token expires in ${status.account.daysRemaining} days',
          body: 'LinkedIn tokens last 60 days and cannot refresh themselves.',
        ),
        const SizedBox(height: S.x4),
      ],
      if (state.error != null) ...[
        Panel(child: ErrorText(state.error!)),
        const SizedBox(height: S.x4),
      ],
      if (queue.isEmpty && !state.loading)
        const EmptyState(
          icon: Icons.inbox_outlined,
          title: 'Nothing waiting',
          blurb: 'Drafts from the daily cycle land here for your approval.\n'
              'Check Passed over to see what the judge turned down.',
        ),
      for (final post in drafts) ...[
        _DraftCard(post: post),
        const SizedBox(height: S.x4),
      ],
      if (other.isNotEmpty) ...[
        const SizedBox(height: S.x2),
        const _SectionHeading('Needs attention'),
        for (final post in other) ...[
          Text(_explain(post.status), style: T.xs),
          const SizedBox(height: S.x2),
          _DraftCard(post: post, actionable: post.status != 'unknown'),
          const SizedBox(height: S.x4),
        ],
      ],
    ];
  }

  /// Ask for a follow-up, then let the composer take over.
  ///
  /// This is the slowest thing in the app and it is worth saying so. The writer
  /// call is paced four seconds behind any other model call, then usually spends
  /// a SECOND call repairing the draft to the author's word range — so half a
  /// minute is normal and a minute is not alarming.
  ///
  /// The notice stays up until the work finishes rather than expiring after a
  /// few seconds. A message that disappears while the request is still running
  /// is worse than none: it reads as the tap having been lost, which is exactly
  /// what this looked like before.
  Future<void> _followUp(BuildContext context, int seq) async {
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
            Expanded(child: Text('Writing a follow-up — this takes up to a minute.')),
          ],
        ),
        // Effectively "until dismissed": hidden explicitly below. The server
        // gives up at 120s, so nothing can outlive this.
        duration: Duration(minutes: 3),
      ),
    );
    final error = await context.read<AppState>().followUp(seq);
    messenger.hideCurrentSnackBar();
    if (error != null) {
      messenger.showSnackBar(SnackBar(content: Text(error)));
    }
  }

  List<Widget> _published(AppStatus? status) {
    final history = status?.history ?? const <Post>[];
    if (history.isEmpty) {
      return [
        const EmptyState(
          icon: Icons.send_outlined,
          title: 'Nothing published yet',
          blurb: 'Posts that reached LinkedIn appear here, newest first.',
        ),
      ];
    }
    final state = context.watch<AppState>();
    return [
      for (final post in history) ...[
        PostCard(
          post: post,
          busy: state.loading,
          // The one thing still worth doing with a post that has gone out.
          // Answers with text and saves nothing, then brings the composer
          // forward with it loaded — the same shape as accepting a rewrite.
          onFollowUp: () => _followUp(context, post.seq),
        ),
        const SizedBox(height: S.x4),
      ],
    ];
  }

  List<Widget> _passed(AppStatus? status) {
    final rejections = status?.rejections ?? const <Rejection>[];
    if (rejections.isEmpty) {
      return [
        const EmptyState(
          icon: Icons.filter_alt_outlined,
          title: 'Nothing passed over',
          blurb: 'Stories the judge scored and turned down appear here, with its reasoning.',
        ),
      ];
    }
    return [
      Text(
        'What the judge read and turned down. If everything here looks like '
        'something you would have posted, the bar is too high — or the '
        'categories are too narrow.',
        style: T.xs,
      ),
      const SizedBox(height: S.x4),
      for (final item in rejections) ...[
        _RejectionCard(item: item),
        const SizedBox(height: S.x3),
      ],
    ];
  }
}

// ---------------------------------------------------------------- pieces

/// Why a post is sitting outside the draft list, in the user's terms.
String _explain(String status) => switch (status) {
      'approved' => 'Approved but never sent — the publish failed. Try again, or discard it.',
      'failed' => 'The last send was rejected. Fix the text and try again.',
      'unknown' => 'LinkedIn never confirmed this send. Check your profile, then resolve it '
          'from the web dashboard before touching it here.',
      _ => '',
    };

class _SegmentBar extends StatelessWidget {
  const _SegmentBar({required this.value, required this.queueCount, required this.onChanged});

  final _Segment value;
  final int queueCount;
  final ValueChanged<_Segment> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: C.surface,
        border: Border.all(color: C.border),
        borderRadius: BorderRadius.circular(R.sm),
      ),
      child: Row(
        children: [
          _tab(_Segment.queue, queueCount > 0 ? 'Queue  $queueCount' : 'Queue'),
          _tab(_Segment.published, 'Published'),
          _tab(_Segment.passed, 'Passed over'),
        ],
      ),
    );
  }

  Widget _tab(_Segment segment, String label) {
    final selected = segment == value;
    return Expanded(
      child: InkWell(
        onTap: () => onChanged(segment),
        borderRadius: BorderRadius.circular(R.sm - 1),
        child: Container(
          height: 40,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? C.surface3 : Colors.transparent,
            borderRadius: BorderRadius.circular(R.sm - 1),
          ),
          child: Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 13,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
              color: selected ? C.text : C.textDim,
            ),
          ),
        ),
      ),
    );
  }
}

/// A heading between groups of cards, with a rule to separate it from what
/// came before.
class _SectionHeading extends StatelessWidget {
  const _SectionHeading(this.label);

  final String label;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: S.x3),
        child: Row(
          children: [
            Text(label.toUpperCase(), style: T.panelHead),
            const SizedBox(width: S.x3),
            const Expanded(child: Divider(color: C.border, height: 1)),
          ],
        ),
      );
}

class _RejectionCard extends StatelessWidget {
  const _RejectionCard({required this.item});

  final Rejection item;

  @override
  Widget build(BuildContext context) {
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(item.title, style: T.lg.copyWith(fontSize: 15)),
          const SizedBox(height: S.x2),
          Container(
            padding: const EdgeInsets.only(left: S.x3),
            decoration: const BoxDecoration(
              border: Border(left: BorderSide(color: C.borderStrong, width: 2)),
            ),
            child: Text(item.reason, style: T.sm),
          ),
          if (item.url.isNotEmpty) ...[
            const SizedBox(height: S.x3),
            Text(_host(item.url), style: T.xs.copyWith(color: C.live)),
          ],
        ],
      ),
    );
  }

  static String _host(String url) {
    final parsed = Uri.tryParse(url);
    return parsed?.host.isNotEmpty == true ? parsed!.host : url;
  }
}

class _DraftCard extends StatelessWidget {
  const _DraftCard({required this.post, this.actionable = true});

  final Post post;

  /// False for ambiguous sends, which must not be republished blind.
  final bool actionable;

  /// Clearing is NOT publishing, and the difference is the point of the whole
  /// schedule. This says "I have read it, let it go at its time" — nothing
  /// reaches LinkedIn now, so it does not need the irreversibility warning that
  /// [_confirmSendNow] does. It is reversible with one tap until the time comes.
  Future<void> _clear(BuildContext context) async {
    final state = context.read<AppState>();
    final error = await state.clear(post.seq);
    if (!context.mounted) return;
    final at = post.scheduledFor;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(error ?? 'Cleared — goes out at ${at == null ? "its time" : _hhmm(at)}.'),
        action: error != null
            ? null
            : SnackBarAction(label: 'Undo', onPressed: () => state.unclear(post.seq)),
      ),
    );
  }

  Future<void> _confirmSendNow(BuildContext context) async {
    final state = context.read<AppState>();
    final live = state.status?.liveMode ?? false;
    final scheduled = post.scheduledFor;

    // Publishing is irreversible on LinkedIn's side, so it always asks — even
    // in dry run, so the habit is the same when live mode is on.
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: C.surface2,
        title: Text(live ? 'Send now?' : 'Send now (dry run)?'),
        content: Text(
          !live
              ? 'Live mode is off, so nothing will actually reach LinkedIn.'
              : scheduled != null
                  ? 'This posts to your profile immediately, instead of at ${_hhmm(scheduled)}. It cannot be unpublished from here.'
                  : 'This posts to your profile now. It cannot be unpublished from here.',
          style: T.sm,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Send now')),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;

    final error = await state.sendNow(post.seq);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error ?? 'Published ${post.id}.')),
    );
  }

  /// Give this one post a send time.
  ///
  /// A plain time picker, not a date picker: "publish this at 21:00" is how the
  /// decision is actually made. If the time has already passed today it means
  /// tomorrow, because nobody picking 07:00 at midnight means seven hours ago.
  Future<void> _pickSendTime(BuildContext context) async {
    final state = context.read<AppState>();
    final existing = post.scheduledFor;
    final picked = await showTimePicker(
      context: context,
      initialTime: existing != null
          ? TimeOfDay(hour: existing.hour, minute: existing.minute)
          : TimeOfDay.now(),
      helpText: 'Send this post at',
    );
    if (picked == null || !context.mounted) return;

    final now = DateTime.now();
    var when = DateTime(now.year, now.month, now.day, picked.hour, picked.minute);
    if (!when.isAfter(now)) when = when.add(const Duration(days: 1));

    final error = await state.reschedule(post.seq, when);
    if (!context.mounted) return;

    final tomorrow = when.day != now.day;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(error ??
            'Sends at ${_hhmm(when)}${tomorrow ? ' tomorrow' : ''}. '
                'Clear it before then or it stays put.'),
      ),
    );
  }

  Future<void> _removeSendTime(BuildContext context) async {
    final state = context.read<AppState>();
    final error = await state.reschedule(post.seq, null);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error ?? 'Send time removed. It waits for you now.')),
    );
  }

  static String _hhmm(DateTime t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  Future<void> _confirmDiscard(BuildContext context) async {
    final state = context.read<AppState>();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: C.surface2,
        title: const Text('Discard this draft?'),
        content: const Text('It leaves the queue. The story will not be written about again.',
            style: T.sm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep')),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: C.alarm),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;

    final error = await state.discard(post.seq);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(error ?? 'Discarded ${post.id}.')),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!actionable) return PostCard(post: post);

    final busy = context.watch<AppState>().loading;
    return PostCard(
      post: post,
      busy: busy,
      // On a scheduled post the primary action clears it for its own time and
      // "Send now" is the override. On an unscheduled one there is no time to
      // clear it for, so sending is the only thing approving can mean.
      onClear: post.isScheduled && !post.isCleared ? () => _clear(context) : null,
      onSendNow: () => _confirmSendNow(context),
      // Offered on every unpublished draft, whether or not it came from a slot.
      // A post generated by the agent arrives with its slot's time; one from
      // "Run a cycle now" or the composer arrives with none, and this is how it
      // gets one.
      onSchedule: post.isPublished ? null : () => _pickSendTime(context),
      onUnschedule: post.isScheduled && !post.isPublished
          ? () => _removeSendTime(context)
          : null,
      onDiscard: () => _confirmDiscard(context),
      // Editing happens on the Compose tab, which has the attachments, the
      // rewrite action and the live voice summary. The shell switches tabs.
      onEdit: () => context.read<AppState>().startEditing(post),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.tone, required this.icon, required this.title, required this.body});

  final BadgeTone tone;
  final IconData icon;
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    final color = switch (tone) {
      BadgeTone.alarm => C.alarm,
      BadgeTone.warn => C.attention,
      BadgeTone.good => C.good,
      BadgeTone.live => C.live,
      BadgeTone.neutral => C.textFaint,
    };
    return Container(
      padding: const EdgeInsets.all(S.x3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        border: Border.all(color: color.withValues(alpha: 0.4)),
        borderRadius: BorderRadius.circular(R.sm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: S.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: TextStyle(fontSize: 14, color: color, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(body, style: T.xs),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
