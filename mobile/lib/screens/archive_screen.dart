/// What went out, and what never did.
///
/// Split from the Desk because nothing here needs a decision — mixing "read
/// this and choose" with "look at what happened" is what made the old queue
/// three segments deep and put a reference list in front of a deadline.
///
/// PASSED OVER earns its place. Seeing what the judge rejected, and why, is the
/// fastest way to tell whether the categories and the threshold are set right:
/// a desk that has been empty for three days means something completely
/// different if this list is full than if it is also empty.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/draft_card.dart';
import '../widgets/primitives.dart';
import 'draft_commands.dart';

enum _Shelf { published, passed }

class ArchiveScreen extends StatefulWidget {
  const ArchiveScreen({super.key});

  @override
  State<ArchiveScreen> createState() => _ArchiveScreenState();
}

class _ArchiveScreenState extends State<ArchiveScreen> {
  _Shelf _shelf = _Shelf.published;

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
          Row(
            children: [
              const Text('Archive', style: T.title),
              const Spacer(),
              WriteButton(onTap: () => writeSomething(context)),
            ],
          ),
          const SizedBox(height: S.x4),
          _ShelfBar(
            value: _shelf,
            published: status?.history.length ?? 0,
            passed: status?.rejections.length ?? 0,
            onChanged: (v) => setState(() => _shelf = v),
          ),
          const SizedBox(height: S.x5),
          ...switch (_shelf) {
            _Shelf.published => _published(context, state, status),
            _Shelf.passed => _passed(status),
          },
        ],
      ),
    );
  }

  List<Widget> _published(BuildContext context, AppState state, AppStatus? status) {
    final history = status?.history ?? const <Post>[];
    if (history.isEmpty) {
      return [
        const Empty(
          icon: Icons.send_outlined,
          title: 'Nothing published yet',
          blurb: 'Posts that reached LinkedIn appear here, newest first.',
        ),
      ];
    }
    return [
      for (final post in history) ...[
        DraftCard(post: post, busy: state.loading, actions: commandsFor(context, post)),
        const SizedBox(height: S.x3),
      ],
    ];
  }

  List<Widget> _passed(AppStatus? status) {
    final rejections = status?.rejections ?? const <Rejection>[];
    if (rejections.isEmpty) {
      return [
        const Empty(
          icon: Icons.filter_alt_outlined,
          title: 'Nothing passed over',
          blurb: 'Stories the judge scored and turned down appear here, with its reasoning.',
        ),
      ];
    }
    return [
      Text(
        'What the judge read and turned down. If everything here looks like something '
        'you would have posted, the bar is too high — or the topics are too narrow.',
        style: T.small,
      ),
      const SizedBox(height: S.x5),
      for (final item in rejections) ...[
        _PassedOver(item: item),
        const SizedBox(height: S.x5),
      ],
    ];
  }
}

/// Two shelves, as a segmented control with live counts.
class _ShelfBar extends StatelessWidget {
  const _ShelfBar({
    required this.value,
    required this.published,
    required this.passed,
    required this.onChanged,
  });

  final _Shelf value;
  final int published;
  final int passed;
  final ValueChanged<_Shelf> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: C.ink2,
        border: Border.all(color: C.rule),
        borderRadius: BorderRadius.circular(R.md),
      ),
      child: Row(
        children: [
          _tab(_Shelf.published, 'Published', published),
          _tab(_Shelf.passed, 'Passed over', passed),
        ],
      ),
    );
  }

  Widget _tab(_Shelf shelf, String label, int count) {
    final selected = shelf == value;
    return Expanded(
      child: Semantics(
        selected: selected,
        button: true,
        child: InkWell(
          onTap: () => onChanged(shelf),
          borderRadius: BorderRadius.circular(R.sm),
          child: Container(
            height: 42,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: selected ? C.ink3 : Colors.transparent,
              borderRadius: BorderRadius.circular(R.sm),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: T.body.copyWith(color: selected ? C.paper : C.paperDim),
                  ),
                ),
                if (count > 0) ...[
                  const SizedBox(width: S.x2),
                  Text(
                    '$count',
                    style: T.data.copyWith(
                      fontSize: 12.5,
                      color: selected ? C.paperDim : C.paperFaint,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A story the judge turned down, and why.
///
/// Not a card: there is nothing to do to it. Just a headline, the reasoning
/// against a rule, and where it came from.
class _PassedOver extends StatelessWidget {
  const _PassedOver({required this.item});

  final Rejection item;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(item.title, style: T.bodyStrong.copyWith(fontSize: 16, height: 1.35)),
        const SizedBox(height: S.x2),
        Container(
          padding: const EdgeInsets.only(left: S.x3),
          decoration: const BoxDecoration(
            border: Border(left: BorderSide(color: C.ruleStrong, width: 2)),
          ),
          child: Text(item.reason, style: T.small),
        ),
        if (item.url.isNotEmpty) ...[
          const SizedBox(height: S.x3),
          Text(_host(item.url), style: T.mono.copyWith(color: C.daylight)),
        ],
      ],
    );
  }

  static String _host(String url) {
    final parsed = Uri.tryParse(url);
    return parsed?.host.isNotEmpty == true ? parsed!.host : url;
  }
}
