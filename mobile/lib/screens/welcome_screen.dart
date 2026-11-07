import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../api/client.dart';
import '../auth_return.dart';
import '../auth_browser.dart';
import 'gate_screen.dart';
import '../theme.dart';
import '../widgets/experience.dart';
import '../widgets/editorial.dart';

class WelcomeScreen extends StatefulWidget {
  const WelcomeScreen({super.key});
  @override
  State<WelcomeScreen> createState() => _WelcomeScreenState();
}

class _WelcomeScreenState extends State<WelcomeScreen> {
  Map<String, dynamic>? _providers;
  String? _error;
  bool _busy = false;
  int _attempt = 0;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = context.read<AppState>().api;
    try {
      final v = await api.get('/api/native-auth');
      if (mounted) {
        setState(() => _providers = Map<String, dynamic>.from(v as Map));
      }
      final pending = await api.pendingSignIn();
      if (mounted && pending != null && !_busy) {
        await _signIn(pending['provider'] as String, pending: pending);
      }
    } catch (e) {
      if (mounted) {
        setState(
          () => _error =
              'Cannot reach ByLine. Check your internet connection and try again.',
        );
      }
    }
  }

  Future<void> _signIn(String provider, {Map<String, dynamic>? pending}) async {
    final state = context.read<AppState>();
    final attempt = ++_attempt;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final rng = Random.secure();
      final verifier =
          pending?['verifier'] as String? ??
          base64UrlEncode(
            List.generate(48, (_) => rng.nextInt(256)),
          ).replaceAll('=', '');
      final returnUri = pending == null
          ? await prepareDesktopAuthReturn()
          : null;
      var result = Map<String, dynamic>.from(
        pending ??
            await state.api.post('/api/native-auth', {
                  'provider': provider,
                  'verifier': verifier,
                  'returnUri': ?returnUri,
                })
                as Map,
      );
      if (!mounted || attempt != _attempt) return;
      if (result['url'] != null) {
        if (pending == null) {
          await state.api.savePendingSignIn({
            ...result,
            'provider': provider,
            'verifier': verifier,
            'startedAt': DateTime.now().millisecondsSinceEpoch,
          });
        }
        if (pending == null &&
            !await openAuthBrowser(Uri.parse(result['url'] as String))) {
          await state.api.clearPendingSignIn();
          throw Exception(
            'No browser could open sign-in. Enable a web browser on this phone and try again.',
          );
        }
        final id = result['id'];
        final deadline = DateTime.fromMillisecondsSinceEpoch(
          pending?['startedAt'] as int? ??
              DateTime.now().millisecondsSinceEpoch,
        ).add(const Duration(minutes: 10));
        while (DateTime.now().isBefore(deadline)) {
          await Future<void>.delayed(const Duration(seconds: 2));
          if (!mounted || attempt != _attempt) return;
          try {
            result = Map<String, dynamic>.from(
              await state.api.post('/api/native-auth', {
                    'action': 'poll',
                    'id': id,
                    'verifier': verifier,
                  })
                  as Map,
            );
          } on ApiException catch (e) {
            // Android may suspend networking while the sign-in browser is in
            // front. Keep the saved flow alive so returning to ByLine recovers.
            if (e.status == 0 || e.status == 429 || e.status >= 500) continue;
            rethrow;
          }
          if (result['token'] != null) break;
        }
      }
      if (!mounted || attempt != _attempt) return;
      if (result['token'] is! String) {
        await state.api.clearPendingSignIn();
        throw Exception('Sign-in expired. Please try again.');
      }
      if (!mounted || attempt != _attempt) return;
      await state.api.saveNativeSession(result['token'] as String);
      await state.bootstrap();
    } catch (e) {
      if (!mounted || attempt != _attempt) return;
      if (e is ApiException && e.error == 'sign_in_failed') {
        await state.api.clearPendingSignIn();
      }
      if (mounted && attempt == _attempt) {
        setState(() => _error = e.toString());
      }
    } finally {
      if (mounted && attempt == _attempt) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _attempt++;
    cancelDesktopAuthReturn();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const SizedBox(width: 144, child: ByLineMark())),
    body: SafeArea(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth >= 860;
          final signIn = Card(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Welcome to ByLine', style: T.title),
                  const SizedBox(height: 12),
                  const Text(
                    'Sign in to create your personal writing routine.',
                    style: T.body,
                  ),
                  const SizedBox(height: 28),
                  if (_providers?['google'] == true)
                    FilledButton(
                      onPressed: _busy ? null : () => _signIn('google'),
                      child: const Text('Continue with Google'),
                    ),
                  if (_providers?['linkedin'] == true)
                    FilledButton(
                      onPressed: _busy ? null : () => _signIn('linkedin'),
                      child: const Text('Continue with LinkedIn'),
                    ),
                  if (_providers?['localTest'] == true) ...[
                    FilledButton(
                      onPressed: _busy ? null : () => _signIn('local'),
                      child: const Text('Try local preview'),
                    ),
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 12),
                      child: Text(
                        'Test environment: sample content, no AI charges and no LinkedIn publishing.',
                      ),
                    ),
                  ],
                  if (_busy) ...[
                    const LinearProgressIndicator(),
                    const Text(
                      'Finish sign-in in your browser. ByLine will continue automatically.',
                    ),
                    TextButton(
                      onPressed: () {
                        _attempt++;
                        cancelDesktopAuthReturn();
                        context.read<AppState>().api.clearPendingSignIn();
                        setState(() => _busy = false);
                      },
                      child: const Text('Cancel'),
                    ),
                  ],
                  if (_error != null)
                    Text(
                      _error!,
                      style: const TextStyle(color: Color(0xFF805200)),
                    ),
                  if (_providers == null)
                    TextButton(
                      onPressed: _load,
                      child: const Text('Retry connection'),
                    ),
                  const SizedBox(height: 24),
                  const Text(
                    'A few minutes to make it yours. Your voice, your final say.',
                    style: T.small,
                    textAlign: TextAlign.center,
                  ),
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => const GateScreen(),
                            ),
                          ),
                    child: const Text('Existing installation'),
                  ),
                ],
              ),
            ),
          );
          return Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1040),
                child: wide
                    ? Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          const Expanded(
                            child: Padding(
                              padding: EdgeInsets.only(right: 64),
                              child: _WelcomeIntro(),
                            ),
                          ),
                          SizedBox(width: 440, child: signIn),
                        ],
                      )
                    : Column(
                        children: [
                          const _WelcomeIntro(compact: true),
                          const SizedBox(height: 28),
                          signIn,
                        ],
                      ),
              ),
            ),
          );
        },
      ),
    ),
  );
}

class _WelcomeIntro extends StatelessWidget {
  const _WelcomeIntro({this.compact = false});
  final bool compact;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      StudioArt(height: compact ? 120 : 220),
      const SizedBox(height: 20),
      Text(
        'Make your next\npost count.',
        style: T.display.copyWith(
          fontSize: 40,
          height: 1.15,
          color: C.filament,
        ),
      ),
      const SizedBox(height: 20),
      const Text(
        'Your ideas deserve a place in the conversation.',
        style: T.bodyStrong,
      ),
      const SizedBox(height: 12),
      const Text(
        'ByLine brings you a relevant story, writes a first draft in your voice, and leaves the final word to you.',
        style: T.body,
      ),
      if (!compact) ...[
        const SizedBox(height: 24),
        const ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(Icons.article_outlined, color: C.filament),
          title: Text('Grounded in real sources'),
          subtitle: Text('Always know where a story comes from.'),
        ),
        const ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(Icons.edit_note, color: C.filament),
          title: Text('Shaped by your voice'),
          subtitle: Text('Use your own instructions and past posts.'),
        ),
        const ListTile(
          contentPadding: EdgeInsets.zero,
          leading: Icon(Icons.check_circle_outline, color: C.filament),
          title: Text('Published on your terms'),
          subtitle: Text('Publish now, edit or skip. You decide.'),
        ),
      ],
    ],
  );
}
