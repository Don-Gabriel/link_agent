/// LinkdIn mobile — the Flutter client for the posting agent.
///
/// The Next.js app stays the backend: it holds the Postgres state, runs the
/// daily cron whether or not this phone is awake, owns the LinkedIn OAuth
/// redirect, and keeps the token-encryption key off the device. This app is
/// the control surface for it, not a reimplementation of it.
library;

import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'api/client.dart';
import 'push.dart';
import 'screens/welcome_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/home_screen.dart';
import 'state/app_state.dart';
import 'theme.dart';
import 'widgets/experience.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(systemChrome);

  // Before anything reads FirebaseMessaging.instance. Wrapped because a missing
  // or malformed google-services.json throws here, and an app that will not
  // start is a far worse outcome than one without notifications — the whole
  // control surface would be gone over a feature that only sends reminders.
  try {
    const firebaseId = String.fromEnvironment('FIREBASE_APP_ID');
    await Firebase.initializeApp(
      options: firebaseId.isEmpty
          ? null
          : const FirebaseOptions(
              apiKey: String.fromEnvironment('FIREBASE_API_KEY'),
              appId: firebaseId,
              messagingSenderId: String.fromEnvironment('FIREBASE_SENDER_ID'),
              projectId: String.fromEnvironment('FIREBASE_PROJECT_ID'),
            ),
    );
  } catch (err) {
    debugPrint(
      '[push] Firebase did not initialise, continuing without it: $err',
    );
  }

  final api = await ApiClient.create();
  final state = AppState(api);
  // Restores an existing session before the first frame, so a signed-in user
  // never sees the gate flash past on launch.
  await state.bootstrap();

  runApp(ChangeNotifierProvider.value(value: state, child: const LinkdInApp()));
}

class LinkdInApp extends StatelessWidget {
  const LinkdInApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ByLine',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      builder: (context, child) => ColoredBox(
        color: C.ink,
        child: ReadingWidth(
          width: 1320,
          child: child ?? const SizedBox.shrink(),
        ),
      ),
      home: const _Root(),
    );
  }
}

/// The signed-in shell, plus the one-time push setup behind it.
class _SignedIn extends StatefulWidget {
  const _SignedIn();

  @override
  State<_SignedIn> createState() => _SignedInState();
}

class _SignedInState extends State<_SignedIn> {
  late final AppState _state;
  String? _notificationKey;

  @override
  void initState() {
    super.initState();
    _state = context.read<AppState>();
    _state.addListener(_syncNotifications);
    // Deferred past the first frame so a slow permission dialog cannot hold up
    // the UI the user just signed in to see.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _syncNotifications();
    });
  }

  void _syncNotifications() {
    if (!mounted ||
        _state.phase != AuthPhase.signedIn ||
        _state.agent == null) {
      return;
    }
    final native = _state.api.isNativeSession;
    final preference = native
        ? ((_state.reviewDelivery?['config'] as Map?)?['notifications']
              as String?)
        : 'legacy';
    // Status may arrive after setup. Wait for it instead of silently skipping
    // notification registration for the rest of this launch.
    if (preference == null) return;
    final key = '${_state.agent!.agentId}:$preference';
    if (key == _notificationKey) return;
    _notificationKey = key;
    if (preference == 'enabled' || !native) {
      startPush(_state, askPermission: !native);
    } else {
      stopPush();
    }
  }

  @override
  void dispose() {
    _state.removeListener(_syncNotifications);
    stopPush();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => const PushListener(child: HomeScreen());
}

class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final phase = context.select<AppState, AuthPhase>((s) => s.phase);
    return switch (phase) {
      AuthPhase.unknown => const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      ),
      AuthPhase.signedOut => const WelcomeScreen(),
      // Push starts INSIDE the signed-in branch: registering a device attaches
      // it to the agent, and that request needs the session cookie. Asking for
      // notification permission on the gate screen would also be the first
      // thing a new user saw, before the app had shown them anything worth
      // being notified about.
      AuthPhase.signedIn =>
        context.read<AppState>().api.isNativeSession
            ? const _NativeRoot()
            : const _SignedIn(),
    };
  }
}

class _NativeRoot extends StatefulWidget {
  const _NativeRoot();
  @override
  State<_NativeRoot> createState() => _NativeRootState();
}

class _NativeRootState extends State<_NativeRoot> {
  late Future<dynamic> _setup;
  @override
  void initState() {
    super.initState();
    _setup = context.read<AppState>().api.get('/api/onboarding');
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<dynamic>(
    future: _setup,
    builder: (context, snapshot) {
      if (snapshot.hasError) {
        return Scaffold(
          body: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('Could not load setup. ${snapshot.error}'),
                TextButton(
                  onPressed: () => setState(() {
                    _setup = context.read<AppState>().api.get(
                      '/api/onboarding',
                    );
                  }),
                  child: const Text('Retry'),
                ),
                TextButton(
                  onPressed: () => context.read<AppState>().signOut(),
                  child: const Text('Sign out'),
                ),
              ],
            ),
          ),
        );
      }
      if (!snapshot.hasData) {
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      }
      final data = Map<String, dynamic>.from(snapshot.data as Map);
      if (data['completed_at'] != null) return const _SignedIn();
      return OnboardingScreen(
        initial: data,
        onComplete: () {
          context.read<AppState>().refresh();
          setState(() {
            _setup = context.read<AppState>().api.get('/api/onboarding');
          });
        },
      );
    },
  );
}
