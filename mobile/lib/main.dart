/// LinkdIn mobile — the Flutter client for the posting agent.
///
/// The Next.js app stays the backend: it holds the Postgres state, runs the
/// daily cron whether or not this phone is awake, owns the LinkedIn OAuth
/// redirect, and keeps the token-encryption key off the device. This app is
/// the control surface for it, not a reimplementation of it.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'api/client.dart';
import 'screens/gate_screen.dart';
import 'screens/home_screen.dart';
import 'state/app_state.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(systemChrome);

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

class _Root extends StatelessWidget {
  const _Root();

  @override
  Widget build(BuildContext context) {
    final phase = context.select<AppState, AuthPhase>((s) => s.phase);
    return switch (phase) {
      AuthPhase.unknown => const Scaffold(body: Center(child: CircularProgressIndicator())),
      AuthPhase.signedOut => const GateScreen(),
      AuthPhase.signedIn => const HomeScreen(),
    };
  }
}
