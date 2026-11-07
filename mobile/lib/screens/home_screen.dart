import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/experience.dart';
import '../widgets/profile_card.dart';
import '../widgets/form_select.dart';
import 'voice_screen.dart';
import 'timetable_screen.dart';
import 'archive_screen.dart';
import 'composer_screen.dart';
import 'desk_screen.dart';
import 'settings_screen.dart';
import 'today_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, this.initialIndex = 0});

  /// Which destination to open on. Exists for the design preview and for tests,
  /// which otherwise have to reach a screen by tapping through a canvas.
  final int initialIndex;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  late int _index = widget.initialIndex;
  int _seenComposeRequest = 0;
  int _seenTabRequest = 0;
  Timer? _recoveryTimer;
  bool _active = true;
  bool _refreshing = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _recoveryTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      final state = context.read<AppState>();
      if (state.error != null || state.status == null || state.preparingDraft) {
        _refreshAfterReturn();
      }
    });
  }

  Future<void> _refreshAfterReturn() async {
    if (!mounted || !_active || _refreshing) return;
    final state = context.read<AppState>();
    if (state.phase != AuthPhase.signedIn) return;
    _refreshing = true;
    try {
      await state.refresh(quiet: true);
    } finally {
      _refreshing = false;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _active = state == AppLifecycleState.resumed;
    if (_active) _refreshAfterReturn();
  }

  @override
  void dispose() {
    _recoveryTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();

    // "Edit this draft" and "write a follow-up" are both raised from app state
    // — by a card here, or by a notification. The composer is a route, so
    // something above the tabs has to push it.
    if (state.composeRequest != _seenComposeRequest) {
      _seenComposeRequest = state.composeRequest;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) openComposer(context);
      });
    }

    // A tapped notification names the destination it is about — a failed send
    // opens the Desk, a stalled scheduler opens Settings. Landing on whatever
    // was already showing would make the tap feel like it did nothing.
    if (state.tabRequest != _seenTabRequest) {
      _seenTabRequest = state.tabRequest;
      final wanted = state.requestedTab;
      if (_index != wanted && wanted >= 0 && wanted < 3) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) setState(() => _index = wanted);
        });
      }
    }

    final wide = MediaQuery.sizeOf(context).width >= 860;
    const labels = ['Home', 'My posts', 'Me'];
    const icons = [
      Icons.home_outlined,
      Icons.article_outlined,
      Icons.person_outline,
    ];
    final content = IndexedStack(
      index: _index,
      children: [
        state.api.isNativeSession ? const TodayScreen() : const DeskScreen(),
        const _PostsWorkspace(),
        const SettingsScreen(),
      ],
    );
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: wide ? 72 : 60,
        title: SizedBox(width: 140, child: const ByLineMark()),
        actions: [
          if (wide) ...[
            for (var i = 0; i < labels.length; i++)
              Container(
                margin: const EdgeInsets.symmetric(horizontal: 8),
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      color: _index == i ? C.paper : Colors.transparent,
                      width: 2,
                    ),
                  ),
                ),
                child: TextButton.icon(
                  onPressed: () => setState(() => _index = i),
                  icon: i == 1
                      ? _PostsIcon(
                          pending: state.onTheDesk,
                          selected: _index == i,
                        )
                      : Icon(
                          icons[i],
                          color: _index == i ? C.paper : C.paperDim,
                        ),
                  label: Text(
                    labels[i],
                    style: T.bodyStrong.copyWith(
                      color: _index == i ? C.paper : C.paperDim,
                    ),
                  ),
                ),
              ),
            const SizedBox(width: 24),
          ] else
            IconButton(
              tooltip: 'Refresh ByLine',
              onPressed: state.refresh,
              icon: const Icon(Icons.refresh),
            ),
        ],
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(1),
          child: Divider(height: 1),
        ),
      ),
      body: SafeArea(
        bottom: false,
        child: ReadingWidth(
          width: 1080,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (wide)
                SizedBox(
                  width: 250,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 20, 16, 24),
                    children: [
                      ProfileCard(onEdit: () => setState(() => _index = 2)),
                      const Divider(height: 24),
                      Material(
                        color: Colors.transparent,
                        child: Column(
                          children: [
                            ListTile(
                              leading: const Icon(Icons.edit_note),
                              title: const Text('My writing voice'),
                              onTap: () => _open(context, const VoiceScreen()),
                            ),
                            ListTile(
                              leading: const Icon(Icons.interests_outlined),
                              title: const Text('My interests'),
                              onTap: () => _open(context, const TopicsScreen()),
                            ),
                            ListTile(
                              leading: const Icon(Icons.schedule),
                              title: const Text('Timetable'),
                              onTap: () =>
                                  _open(context, const TimetableScreen()),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              Expanded(
                key: const ValueKey('workspace'),
                child: PageSurface(width: 820, child: content),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: wide
          ? null
          : NavigationBar(
              height: 72,
              backgroundColor: C.ink2,
              indicatorColor: Colors.transparent,
              selectedIndex: _index,
              onDestinationSelected: (i) => setState(() => _index = i),
              destinations: [
                NavigationDestination(
                  icon: Icon(Icons.home_outlined),
                  selectedIcon: Icon(Icons.home),
                  label: 'Home',
                ),
                NavigationDestination(
                  icon: _PostsIcon(
                    pending: state.onTheDesk,
                    selected: _index == 1,
                  ),
                  label: 'My posts',
                ),
                NavigationDestination(
                  icon: _SettingsIcon(
                    alert: state.needsAttention,
                    selected: _index == 2,
                  ),
                  label: 'Me',
                ),
              ],
            ),
    );
  }
}

void _open(BuildContext context, Widget page) =>
    Navigator.push(context, MaterialPageRoute<void>(builder: (_) => page));

class _PostsWorkspace extends StatefulWidget {
  const _PostsWorkspace();
  @override
  State<_PostsWorkspace> createState() => _PostsWorkspaceState();
}

class _PostsWorkspaceState extends State<_PostsWorkspace> {
  String _view = 'drafts';
  int _seenRequest = 0;
  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    if (_seenRequest != state.tabRequest) {
      _seenRequest = state.tabRequest;
      if (state.requestedTab == 1) _view = 'drafts';
    }
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
          child: FormSelect<String>(
            label: 'My posts',
            value: _view,
            options: const {
              'drafts': 'Drafts & scheduled posts',
              'history': 'Published posts & source history',
            },
            onChanged: (v) => setState(() => _view = v),
          ),
        ),
        Expanded(
          child: IndexedStack(
            index: _view == 'drafts' ? 0 : 1,
            children: const [DeskScreen(), ArchiveScreen()],
          ),
        ),
      ],
    );
  }
}

/// The My posts icon, badged with what needs a DECISION — not with what merely
/// exists. A cleared draft is still in the queue but is no longer asking
/// anything of you, and a badge that never clears is a badge people learn to
/// ignore.
class _PostsIcon extends StatelessWidget {
  const _PostsIcon({required this.pending, required this.selected});

  final int pending;
  final bool selected;

  @override
  Widget build(BuildContext context) => Badge(
    isLabelVisible: pending > 0,
    label: Text('$pending'),
    backgroundColor: C.filament,
    textColor: C.onFilament,
    child: Icon(selected ? Icons.article : Icons.article_outlined),
  );
}

/// Settings carries a dot, not a count: what is wrong there is a condition —
/// a stopped scheduler, an expired token — and a number would imply a list.
class _SettingsIcon extends StatelessWidget {
  const _SettingsIcon({required this.alert, required this.selected});

  final bool alert;
  final bool selected;

  @override
  Widget build(BuildContext context) => Badge(
    isLabelVisible: alert,
    backgroundColor: C.flare,
    smallSize: 7,
    child: Icon(selected ? Icons.person : Icons.person_outline),
  );
}
