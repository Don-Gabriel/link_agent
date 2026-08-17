/// The signed-in shell: four tabs behind a bottom navigation bar.
///
/// Bottom nav rather than a drawer because all four destinations are used
/// constantly and a drawer costs a tap plus a gesture to reach any of them.
/// The queue is first because approving drafts is the recurring job; everything
/// else is something you do once and revisit.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import '../theme.dart';
import 'composer_screen.dart';
import 'queue_screen.dart';
import 'status_screen.dart';
import 'voice_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _index = 0;
  int _seenComposeRequest = 0;

  static const _titles = ['Queue', 'Compose', 'Voice', 'Status'];
  static const _composeTab = 1;

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final pending = state.status?.queue.where((p) => p.isDraft).length ?? 0;

    // "Edit this draft" is raised by the queue and lands here: the composer is
    // a sibling tab, so something above both has to bring it forward.
    if (state.composeRequest != _seenComposeRequest) {
      _seenComposeRequest = state.composeRequest;
      if (_index != _composeTab) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) setState(() => _index = _composeTab);
        });
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[_index]),
        actions: [
          if (state.loading)
            const Padding(
              padding: EdgeInsets.only(right: S.x4),
              child: Center(
                child: SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)),
              ),
            )
          else
            IconButton(
              onPressed: state.refresh,
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh',
            ),
        ],
        bottom: const PreferredSize(
          preferredSize: Size.fromHeight(1),
          child: Divider(height: 1, color: C.border),
        ),
      ),
      // IndexedStack keeps each tab's scroll position and half-typed text alive
      // across switches — losing a composer draft to a stray tap would be the
      // most annoying possible bug here.
      body: SafeArea(
        child: IndexedStack(
          index: _index,
          children: const [
            QueueScreen(),
            ComposerScreen(),
            VoiceScreen(),
            StatusScreen(),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          NavigationDestination(
            icon: Badge(
              isLabelVisible: pending > 0,
              label: Text('$pending'),
              backgroundColor: C.accent,
              textColor: C.bg,
              child: const Icon(Icons.inbox_outlined),
            ),
            selectedIcon: Badge(
              isLabelVisible: pending > 0,
              label: Text('$pending'),
              backgroundColor: C.accent,
              textColor: C.bg,
              child: const Icon(Icons.inbox),
            ),
            label: 'Queue',
          ),
          const NavigationDestination(
            icon: Icon(Icons.edit_outlined),
            selectedIcon: Icon(Icons.edit),
            label: 'Compose',
          ),
          const NavigationDestination(
            icon: Icon(Icons.tune_outlined),
            selectedIcon: Icon(Icons.tune),
            label: 'Voice',
          ),
          const NavigationDestination(
            icon: Icon(Icons.monitor_heart_outlined),
            selectedIcon: Icon(Icons.monitor_heart),
            label: 'Status',
          ),
        ],
      ),
    );
  }
}
