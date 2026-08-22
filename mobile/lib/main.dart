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
import 'screens/gate_screen.dart';
import 'screens/home_screen.dart';
import 'state/app_state.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(systemChrome);

  // Before anything reads FirebaseMessaging.instance. Wrapped because a missing
  // or malformed google-services.json throws here, and an app that will not
  // start is a far worse outcome than one without notifications — the whole
  // control surface would be gone over a feature that only sends reminders.
  try {
    await Firebase.initializeApp();
  } catch (err) {
    debugPrint('[push] Firebase did not initialise, continuing without it: $err');
  }

  final api = await ApiClient.create();
  final state = AppState(api);
  // Restores an existing session before the first frame, so a signed-in user
  // never sees the gate flash past on launch.
  await state.bootstrap();

  runApp(
    ChangeNotifierProvider.value(
      value: state,
      child: const LinkdInApp(),
    ),
  );
}

class LinkdInApp extends StatelessWidget {
  const LinkdInApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'LinkdIn',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
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
  @override
  void initState() {
    super.initState();
    // Deferred past the first frame so a slow permission dialog cannot hold up
    // the UI the user just signed in to see.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) startPush(context.read<AppState>());
    });
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
      AuthPhase.unknown => const Scaffold(body: Center(child: CircularProgressIndicator())),
      AuthPhase.signedOut => const GateScreen(),
      // Push starts INSIDE the signed-in branch: registering a device attaches
      // it to the agent, and that request needs the session cookie. Asking for
      // notification permission on the gate screen would also be the first
      // thing a new user saw, before the app had shown them anything worth
      // being notified about.
      AuthPhase.signedIn => const _SignedIn(),
    };
  }
}
