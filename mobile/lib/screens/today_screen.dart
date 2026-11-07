import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api/models.dart';
import '../api/client.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/editorial.dart';
import '../widgets/draft_card.dart';
import '../widgets/preparation_progress.dart';
import 'composer_screen.dart';
import 'draft_commands.dart';
import 'timetable_screen.dart';

/// Home follows the timetable: one occurrence and one draft per enabled time.
class TodayScreen extends StatefulWidget {
  const TodayScreen({super.key, this.scrollController});
  final ScrollController? scrollController;
  @override
  State<TodayScreen> createState() => _TodayScreenState();
}

class _TodayScreenState extends State<TodayScreen> with WidgetsBindingObserver {
  Map<String, dynamic>? _day;
  String? _error;
  bool _polling = false,
      _starting = false,
      _active = true,
      _reconnecting = false;
  Timer? _timer;
  DateTime _nextPoll = DateTime.fromMillisecondsSinceEpoch(0);
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _poll(force: true));
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _poll());
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState lifecycle) {
    _active = lifecycle == AppLifecycleState.resumed;
    if (_active) _poll(force: true);
  }

  List<Map<String, dynamic>> get _entries => (_day?['entries'] as List? ?? [])
      .map((e) => Map<String, dynamic>.from(e as Map))
      .toList();
  Future<void> _poll({bool force = false}) async {
    if (!mounted ||
        !_active ||
        _polling ||
        (!force && DateTime.now().isBefore(_nextPoll))) {
      return;
    }
    final state = context.read<AppState>();
    final id = state.agent?.agentId;
    if (!state.api.isNativeSession) return;
    _polling = true;
    try {
      final result = Map<String, dynamic>.from(
        await state.api.get('/api/review-delivery') as Map,
      );
      if (!mounted || state.agent?.agentId != id) return;
      final before = _entries
          .map((e) => (e['post'] as Map?)?['seq'])
          .whereType<num>()
          .toSet();
      setState(() {
        _day = result;
        _reconnecting = false;
        _error = null;
      });
      final after = _entries
          .map((e) => (e['post'] as Map?)?['seq'])
          .whereType<num>()
          .toSet();
      if (after.difference(before).isNotEmpty) await state.refresh(quiet: true);
    } catch (e) {
      if (!mounted || state.agent?.agentId != id) return;
      if (e is ApiException && e.isUnauthorized) {
        await state.signOut();
        return;
      }
      if (mounted) {
        setState(() {
          _reconnecting = true;
          if (_day == null) _error = e.toString();
        });
      }
    } finally {
      _polling = false;
      final working = _entries.any(
        (e) => (e['progress'] as Map?)?['state'] == 'working',
      );
      _nextPoll = DateTime.now().add(
        Duration(seconds: working || _starting ? 3 : 15),
      );
    }
  }

  Future<void> _prepare([String? slotId]) async {
    if (_starting) return;
    setState(() {
      _starting = true;
      _error = null;
    });
    try {
      await context.read<AppState>().api.post('/api/review-delivery', {
        'action': 'generate',
        if (slotId != null) 'slotIds': [slotId],
      });
      _nextPoll = DateTime.fromMillisecondsSinceEpoch(0);
      await _poll(force: true);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<void> _refresh() async {
    await context.read<AppState>().refresh();
    await _poll(force: true);
    if (mounted) setState(() => _error = null);
  }

  Future<void> _timetable() async {
    await Navigator.push(
      context,
      MaterialPageRoute<void>(builder: (_) => const TimetableScreen()),
    );
    if (mounted) await _refresh();
  }

  Post _currentPost(Map raw, AppState state) {
    final post = Post.fromJson(Map<String, dynamic>.from(raw));
    for (final current in [
      ...?state.status?.queue,
      ...?state.status?.history,
    ]) {
      if (current.seq == post.seq) return current;
    }
    return post;
  }

  Widget _post(Post post, AppState state) => DraftCard(
    key: ValueKey('home-${post.seq}'),
    post: post,
    busy: state.loading,
    actions: commandsFor(context, post, actionable: post.status != 'rejected'),
  );
  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final entries = _entries;
    final ready = entries.where((e) => e['post'] != null).length;
    final canPrepare = entries.any((e) => e['canPrepare'] == true);
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        controller: widget.scrollController,
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 28),
        children: [
          OutlinedButton.icon(
            onPressed: () => openComposer(context),
            icon: const Icon(Icons.edit_outlined),
            label: const Text('Start a post'),
          ),
          const SizedBox(height: 20),
          StudioBanner(
            title: entries.isEmpty ? 'Your writing day' : 'Today’s posts',
            caption: entries.isEmpty
                ? 'Your timetable decides when ByLine prepares posts.'
                : '$ready of ${entries.length} posts prepared · ${_day?['timezone'] ?? state.agent?.timezone ?? ''}',
            eyebrow: 'YOUR TIMETABLE',
            scene: StudioScene.routine,
            compact: true,
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (canPrepare)
                FilledButton.icon(
                  onPressed: _starting || state.loading
                      ? null
                      : () => _prepare(),
                  icon: const Icon(Icons.auto_awesome),
                  label: Text(
                    _starting ? 'Starting…' : 'Prepare today’s posts',
                  ),
                ),
              TextButton.icon(
                onPressed: _timetable,
                icon: const Icon(Icons.schedule),
                label: const Text('Edit timetable'),
              ),
              TextButton.icon(
                onPressed: _refresh,
                icon: const Icon(Icons.refresh),
                label: const Text('Refresh'),
              ),
            ],
          ),
          if (_day == null && !_reconnecting)
            const Padding(
              padding: EdgeInsets.all(24),
              child: LinearProgressIndicator(),
            ),
          if (_reconnecting)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text(
                'Reconnecting to ByLine. Showing the last saved progress.',
                style: T.small,
              ),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(_error!, style: T.small.copyWith(color: C.flare)),
            ),
          if (_day != null && entries.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Text(
                'No posting times are enabled for today. Add or change times and days in Timetable. You can still write a post whenever you want.',
                style: T.body,
              ),
            ),
          for (final entry in entries) ...[
            const SizedBox(height: 20),
            Row(
              children: [
                const Icon(Icons.schedule, size: 18, color: C.filament),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${entry['time']} · ${entry['post'] == null ? 'Planned post' : 'Your post'}',
                    style: T.bodyStrong,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (entry['post'] is Map) ...[
              if (_currentPost(entry['post'] as Map, state).isDraft)
                const PreparationProgress(
                  progress: {
                    'state': 'ready',
                    'stage': 'ready',
                    'completed': 4,
                  },
                ),
              _post(_currentPost(entry['post'] as Map, state), state),
            ] else ...[
              if ((entry['progress'] as Map?)?['state'] != 'idle')
                PreparationProgress(
                  progress: Map<String, dynamic>.from(entry['progress'] as Map),
                  reconnecting: _reconnecting,
                )
              else
                const Padding(
                  padding: EdgeInsets.only(bottom: 12),
                  child: Text(
                    'A draft will be prepared before this posting time. You can also prepare it now.',
                    style: T.small,
                  ),
                ),
              if (entry['canPrepare'] == true)
                OutlinedButton.icon(
                  onPressed: _starting
                      ? null
                      : () => _prepare(entry['slotId'] as String),
                  icon: const Icon(Icons.auto_awesome, size: 18),
                  label: const Text('Prepare this post'),
                ),
            ],
          ],
          if ((_day?['posts'] as List? ?? []).isNotEmpty) ...[
            const SizedBox(height: 28),
            const Text('Other posts today', style: T.title),
            for (final raw in _day!['posts'] as List) ...[
              const SizedBox(height: 16),
              _post(_currentPost(raw as Map, state), state),
            ],
          ],
          const WritingPrompt(),
        ],
      ),
    );
  }
}
