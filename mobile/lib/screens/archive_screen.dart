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
import 'package:url_launcher/url_launcher.dart';

import '../api/models.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/form_select.dart';
import '../widgets/draft_card.dart';
import '../widgets/primitives.dart';
import 'draft_commands.dart';
import '../widgets/editorial.dart';

enum _Shelf { published, passed }

class ArchiveScreen extends StatefulWidget {
  const ArchiveScreen({super.key});

  @override
  State<ArchiveScreen> createState() => _ArchiveScreenState();
}

class _ArchiveScreenState extends State<ArchiveScreen> {
  _Shelf _shelf = _Shelf.published;
  final List<Post> _older = [];
  bool _loadingOlder = false, _hasMore = true;
  String? _historyError;

  Future<void> _loadOlder() async {
    if (_loadingOlder) return;
    final history = context.read<AppState>().status?.history ?? [];
    final cursor = _older.isNotEmpty
        ? _older.last.seq
        : history.lastOrNull?.seq;
    if (cursor == null) return;
    setState(() {
      _loadingOlder = true;
      _historyError = null;
    });
    try {
      final result = await context.read<AppState>().api.get(
        '/api/posts?before=$cursor',
      );
      if (!mounted) return;
      setState(() {
        _older.addAll(
          (result['posts'] as List).map(
            (p) => Post.fromJson(Map<String, dynamic>.from(p as Map)),
          ),
        );
        _hasMore = result['hasMore'] == true;
      });
    } catch (e) {
      if (mounted) setState(() => _historyError = '$e');
    } finally {
      if (mounted) setState(() => _loadingOlder = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final status = state.status;

    return RefreshIndicator(
      onRefresh: () async {
        await state.refresh();
        if (mounted) {
          setState(() {
            _older.clear();
            _hasMore = true;
            _historyError = null;
          });
        }
      },
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
          const StudioBanner(
            compact: true,
            scene: StudioScene.ideas,
            eyebrow: 'YOUR BODY OF WORK',
            title: 'Every post adds a chapter.',
            caption:
                'Revisit what you shared and find the thread for your next idea.',
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

  List<Widget> _published(
    BuildContext context,
    AppState state,
    AppStatus? status,
  ) {
    final history = {
      for (final post in [...(status?.history ?? <Post>[]), ..._older])
        post.seq: post,
    }.values.toList();
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
        DraftCard(
          post: post,
          busy: state.loading,
          actions: commandsFor(context, post),
        ),
        const SizedBox(height: S.x3),
      ],
      if (_historyError != null) Text(_historyError!, style: T.small),
      if (_hasMore && (status?.history.length ?? 0) >= 20)
        OutlinedButton(
          onPressed: _loadingOlder ? null : _loadOlder,
          child: Text(_loadingOlder ? 'Loading…' : 'Load older posts'),
        ),
    ];
  }

  List<Widget> _passed(AppStatus? status) {
    final rejections = status?.rejections ?? const <Rejection>[];
    if (rejections.isEmpty) {
      return [
        const Empty(
          icon: Icons.filter_alt_outlined,
          title: 'Nothing passed over',
          blurb:
              'Stories the judge scored and turned down appear here, with its reasoning.',
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

/// Filter history using a compact dropdown.
class _ShelfBar extends StatelessWidget {
  const _ShelfBar({
    required this.value,
    required this.published,
    required this.passed,
    required this.onChanged,
  });
  final _Shelf value;
  final int published, passed;
  final ValueChanged<_Shelf> onChanged;
  @override
  Widget build(BuildContext context) => FormSelect<_Shelf>(
    label: 'Show history',
    value: value,
    options: {
      _Shelf.published: 'Published ($published)',
      _Shelf.passed: 'Passed over ($passed)',
    },
    onChanged: onChanged,
  );
}

class _PassedOver extends StatelessWidget {
  const _PassedOver({required this.item});

  final Rejection item;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          item.title,
          style: T.bodyStrong.copyWith(fontSize: 16, height: 1.35),
        ),
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
          TextButton.icon(
            onPressed: () async {
              final url = Uri.tryParse(item.url);
              if (url == null || !['https', 'http'].contains(url.scheme)) {
                return;
              }
              final messenger = ScaffoldMessenger.of(context);
              try {
                if (await launchUrl(
                  url,
                  mode: LaunchMode.externalApplication,
                )) {
                  return;
                }
              } catch (_) {}
              messenger.showSnackBar(
                const SnackBar(
                  content: Text('Could not open this source article.'),
                ),
              );
            },
            icon: const Icon(Icons.open_in_new, size: 16),
            label: Text(_host(item.url)),
          ),
        ],
      ],
    );
  }

  static String _host(String url) {
    final parsed = Uri.tryParse(url);
    return parsed?.host.isNotEmpty == true ? parsed!.host : url;
  }
}
