import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../state/app_state.dart';
import '../auth_return.dart';
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
  final _invite = TextEditingController();
  @override
  void dispose() {
    _attempt++;
    _invite.dispose();
    super.dispose();
  }

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
              'Cannot reach ByLine. Check your internet connection and try again. The server may take a moment to wake up.',
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
                  'inviteCode': _invite.text.trim(),
                  'returnUri': ?returnUri,
                })
                as Map,
      );
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
            !await launchUrl(
              Uri.parse(result['url'] as String),
              mode: LaunchMode.externalApplication,
            )) {
          throw Exception('Could not open sign-in.');
        }
        final id = result['id'];
        for (var n = 0; n < 300; n++) {
          await Future<void>.delayed(const Duration(seconds: 2));
          if (!mounted || attempt != _attempt) return;
          result = Map<String, dynamic>.from(
            await state.api.post('/api/native-auth', {
                  'action': 'poll',
                  'id': id,
                  'verifier': verifier,
                })
                as Map,
          );
          if (result['token'] != null) break;
        }
      }
      if (result['token'] is! String) {
        throw Exception('Sign-in expired. Please try again.');
      }
      if (!mounted || attempt != _attempt) return;
      await state.api.saveNativeSession(result['token'] as String);
      await state.bootstrap();
    } catch (e) {
      if (e.toString().contains('sign_in_failed')) {
        await state.api.clearPendingSignIn();
      }
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted && attempt == _attempt) setState(() => _busy = false);
    }
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
                  if (_providers?['invitationRequired'] == true) ...[
                    TextField(
                      controller: _invite,
                      enabled: !_busy,
                      autocorrect: false,
                      decoration: const InputDecoration(
                        labelText: 'Invitation code',
                        helperText:
                            'Required for new accounts. Existing clients can leave this blank.',
                      ),
                    ),
                    const SizedBox(height: 20),
                  ],
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
                  if (_providers?['legacyLogin'] != false)
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
