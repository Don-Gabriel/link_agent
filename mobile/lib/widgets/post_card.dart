/// A draft or published post, rendered as LinkedIn will render it.
///
/// The fold marker is the reason this widget is not just a Text. LinkedIn hides
/// everything past ~210 characters behind "see more", and that cut happens on
/// a phone — which makes a phone the right place to judge whether the hook
/// survives it. Showing the boundary inline is the single most useful thing
/// this screen does that the LinkedIn composer does not.
library;

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

class PostCard extends StatelessWidget {
  const PostCard({
    super.key,
    required this.post,
    this.onApprove,
    this.onDiscard,
    this.onEdit,
    this.busy = false,
  });

  final Post post;
  final VoidCallback? onApprove;
  final VoidCallback? onDiscard;
  final VoidCallback? onEdit;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final actionable = onApprove != null || onDiscard != null || onEdit != null;

    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _header(),
          const SizedBox(height: S.x3),
          _FoldedText(post.text),
          if (post.hashtags.isNotEmpty) ...[
            const SizedBox(height: S.x3),
            Text(
              post.hashtags.map((h) => '#$h').join(' '),
              style: const TextStyle(fontSize: 15, color: C.accent),
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
                  'failed' => BadgeTone.bad,
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
    return Row(
      children: [
        if (onApprove != null)
          Expanded(
            child: FilledButton.icon(
              onPressed: busy ? null : onApprove,
              icon: const Icon(Icons.send, size: 18),
              label: const Text('Publish'),
            ),
          ),
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
              foregroundColor: C.bad,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(R.sm)),
            ),
          ),
        ],
      ],
    );
  }
}

/// Post text with the "see more" boundary drawn across it.
class _FoldedText extends StatelessWidget {
  const _FoldedText(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
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
        Padding(
          padding: const EdgeInsets.symmetric(vertical: S.x3),
          child: Row(
            children: [
              const Expanded(child: Divider(color: C.borderStrong, height: 1)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: S.x2),
                child: Text('see more', style: T.xs.copyWith(letterSpacing: 0.5)),
              ),
              const Expanded(child: Divider(color: C.borderStrong, height: 1)),
            ],
          ),
        ),
        Text(below, style: T.body.copyWith(color: C.textDim)),
      ],
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
                    valueColor: const AlwaysStoppedAnimation(C.accent),
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
