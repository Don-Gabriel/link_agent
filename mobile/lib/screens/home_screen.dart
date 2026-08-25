/// The signed-in shell: three destinations, and writing as a task rather than
/// a place.
///
/// The shell this replaces carried five: Queue, Schedule, Compose, Voice,
/// Status. Three of those were things you set once and revisit, each holding a
/// permanent seat in the bottom bar, and the two that mattered daily were split
/// so that the countdown lived one tab away from the list of drafts it applied
/// to — the same post rendered twice, in two shapes, on two screens.
///
///   DESK      the deadline, what is waiting on you, today, anything broken.
///   ARCHIVE   what went out, and what was passed over. Read-only.
///   SETTINGS  timetable, voice, topics, connection, diagnostics — one index,
///             each row carrying a live summary so most questions are answered
///             without opening anything.
///
/// Compose is a full-screen route reached from the write button in each
/// screen's header. Writing has a beginning and an end; a tab makes it ambient
/// and keeps stale state alive forever. Editing a draft pushes the same route
/// with the post loaded, which also removes the cross-tab "bring the composer
/// forward" hack the old shell needed to exist at all.
///
/// There is deliberately NO floating action button. Every draft on the Desk
/// ends in its own row of buttons, and a control floating in the bottom-right
/// corner sits permanently on top of them — it covered "Send now" on the one
/// card with a deadline. It was also a lie about what this app is for: the
/// recurring job is DECIDING on what the agent wrote, not writing your own, and
/// a FAB claims to be the main action on the screen.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../state/app_state.dart';
import '../theme.dart';
import 'archive_screen.dart';
import 'composer_screen.dart';
import 'desk_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, this.initialIndex = 0});

  /// Which destination to open on. Exists for the design preview and for tests,
  /// which otherwise have to reach a screen by tapping through a canvas.
  final int initialIndex;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late int _index = widget.initialIndex;
  int _seenComposeRequest = 0;
  int _seenTabRequest = 0;

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

    return Scaffold(
      // IndexedStack keeps each destination's scroll position alive across
      // switches. There is no half-typed text to lose here any more: that went
      // with the composer when it stopped being a tab.
      body: SafeArea(
        bottom: false,
        child: IndexedStack(
          index: _index,
          children: const [DeskScreen(), ArchiveScreen(), SettingsScreen()],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          NavigationDestination(
            icon: _DeskIcon(pending: state.onTheDesk, selected: _index == 0),
            label: 'Desk',
          ),
          const NavigationDestination(
            icon: Icon(Icons.inventory_2_outlined),
            selectedIcon: Icon(Icons.inventory_2),
            label: 'Archive',
          ),
          NavigationDestination(
            icon: _SettingsIcon(alert: state.needsAttention, selected: _index == 2),
            label: 'Settings',
          ),
        ],
      ),
    );
  }
}

/// The Desk icon, badged with what needs a DECISION — not with what merely
/// exists. A cleared draft is still in the queue but is no longer asking
/// anything of you, and a badge that never clears is a badge people learn to
/// ignore.
class _DeskIcon extends StatelessWidget {
  const _DeskIcon({required this.pending, required this.selected});

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
        child: Icon(selected ? Icons.settings : Icons.settings_outlined),
      );
}
