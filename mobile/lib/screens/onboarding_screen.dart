import 'dart:async';
import 'package:flutter/material.dart';
import '../timezones.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api/client.dart';
import '../auth_browser.dart';
import '../api/models.dart';
import '../state/app_state.dart';
import '../push.dart';
import '../theme.dart';
import '../widgets/experience.dart';
import '../widgets/form_select.dart';
import '../widgets/editorial.dart';
import '../widgets/writing_preferences.dart';

class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({
    super.key,
    required this.initial,
    required this.onComplete,
  });
  final Map<String, dynamic> initial;
  final VoidCallback onComplete;
  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen>
    with WidgetsBindingObserver {
  late Map<String, dynamic> _data;
  late Map<String, dynamic> _config;
  final _samples = List.generate(3, (_) => TextEditingController());
  final _voiceNotes = TextEditingController();
  final _bannedPhrases = TextEditingController();
  final _topic = TextEditingController();
  final _zone = TextEditingController();
  int _step = 0;
  Future<void>? _localZoneReady;
  bool _zoneChosen = false;
  bool _busy = false;
  String? _error;
  Timer? _poll;
  bool _checkingConnection = false;
  DateTime? _connectionDeadline;
  bool get _test => _data['testMode'] == true;
  bool get _connected =>
      (_data['account'] as Map?)?['connected'] == true &&
      (_data['account'] as Map?)?['needsReauth'] != true;
  List<String> get _topics => List<String>.from(_config['topics'] as List);
  StyleConfig get _style => StyleConfig.fromJson({
    'signature': null,
    'register': _config['voice'] == 'professional' ? 'practitioner' : 'peer',
    'structure': _config['voice'] == 'punchy' ? 'short-lines' : 'prose',
    'minWords': _config['voice'] == 'punchy' ? 60 : 100,
    'maxWords': _config['voice'] == 'punchy' ? 140 : 200,
    ...Map<String, dynamic>.from((_config['style'] as Map?) ?? {}),
  });
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _data = widget.initial;
    _config = Map<String, dynamic>.from(_data['config'] as Map);
    final samples = List<String>.from(_config['samples'] as List);
    for (var i = 0; i < samples.length; i++) {
      _samples[i].text = samples[i];
    }
    _voiceNotes.text = _config['voiceNotes'] as String? ?? '';
    _bannedPhrases.text = _style.bannedPhrases.join('\n');
    _zone.text = _config['timezone'] as String;
    if (_data['accepted_revision'] != null) {
      _step = 4;
    } else if (_data['preview'] != null) {
      _step = 3;
    } else if (_connected) {
      _step = 1;
    }
    if (_data['revision'] == 0) {
      _localZoneReady = Timezones.device().then((zone) {
        if (mounted && !_zoneChosen && zone != null) {
          setState(() {
            _zone.text = zone;
            _config['timezone'] = zone;
          });
        }
      });
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _voiceNotes.dispose();
    _bannedPhrases.dispose();
    _topic.dispose();
    _zone.dispose();
    for (final s in _samples) {
      s.dispose();
    }
    super.dispose();
  }

  Future<bool> _action(
    String action, [
    Map<String, dynamic> extra = const {},
  ]) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final response = await context.read<AppState>().api.post(
        '/api/onboarding',
        {'action': action, 'revision': _data['revision'], ...extra},
        kWriterTimeout,
      );
      if (mounted) {
        setState(() => _data = Map<String, dynamic>.from(response as Map));
      }
      return true;
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _connect() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final url = await context.read<AppState>().linkedInConsentUrl();
      if (url == null) {
        throw Exception(
          'Could not start LinkedIn connection. Please try again.',
        );
      }
      if (!await openAuthBrowser(Uri.parse(url))) {
        throw Exception(
          'No browser could open sign-in. Enable a web browser on this phone and try again.',
        );
      }
      if (!mounted) return;
      _poll?.cancel();
      _connectionDeadline = DateTime.now().add(const Duration(minutes: 10));
      _poll = Timer.periodic(
        const Duration(seconds: 3),
        (_) => _refreshConnection(),
      );
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && !_connected) {
      _refreshConnection();
    }
  }

  Future<void> _refreshConnection() async {
    if (!mounted || _checkingConnection || _busy) return;
    _checkingConnection = true;
    try {
      final value = await context.read<AppState>().api.get('/api/onboarding');
      if (!mounted) return;
      // A late connection check must not roll back a concurrently saved setup.
      setState(() => _data = {..._data, 'account': (value as Map)['account']});
      if (_connected) {
        _poll?.cancel();
        _connectionDeadline = null;
        setState(() => _error = null);
      } else if (_connectionDeadline?.isBefore(DateTime.now()) == true) {
        _poll?.cancel();
        _connectionDeadline = null;
        setState(
          () => _error =
              'LinkedIn connection expired. Tap Connect LinkedIn to try again.',
        );
      }
    } catch (_) {
      // A backgrounded Android browser flow can temporarily suspend networking.
      // Keep the connection attempt available for the next poll or resume.
      if (_connectionDeadline?.isBefore(DateTime.now()) == true && mounted) {
        _poll?.cancel();
        _connectionDeadline = null;
        setState(
          () => _error =
              'Could not confirm the connection. Check your internet connection and try again.',
        );
      }
    } finally {
      _checkingConnection = false;
    }
  }

  Future<void> _voiceContinue() async {
    if (_busy) return;
    setState(() => _busy = true);
    await _localZoneReady;
    if (!mounted) return;
    _config['voiceNotes'] = _voiceNotes.text.trim();
    _config['samples'] = _samples
        .map((s) => s.text.trim())
        .where((s) => s.isNotEmpty)
        .toList();
    _config['timezone'] = _zone.text;
    if (await _action('save', {'config': _config}) && mounted) {
      setState(() => _step = 3);
      await _action('preview');
    }
  }

  Future<void> _defaultVoice() async {
    _voiceNotes.clear();
    _bannedPhrases.clear();
    for (final sample in _samples) {
      sample.clear();
    }
    setState(() {
      _config['voice'] = 'professional';
      _config.remove('style');
    });
    await _voiceContinue();
  }

  Future<void> _finish(bool ask) async {
    if (_busy) return;
    setState(() => _busy = true);
    String permission = 'later';
    if (ask) {
      permission = await startPush(context.read<AppState>());
    }
    if (!mounted) return;
    if (await _action('finish', {
          'time': _config['time'],
          'timezone': _zone.text,
          'notifications': permission,
        }) &&
        mounted) {
      setState(() => _step = 6);
    }
  }

  Widget _button(String label, VoidCallback f) => Padding(
    padding: const EdgeInsets.only(top: 16),
    child: FilledButton(onPressed: _busy ? null : f, child: Text(label)),
  );
  @override
  Widget build(BuildContext context) {
    final titles = [
      'Connect LinkedIn',
      'What do you talk about?',
      'Make it sound like you',
      'Your first sample',
      'When should we bring your post?',
      'One small daily habit',
      'You’re ready',
    ];
    final industries = List<Map<String, dynamic>>.from(
      (_data['industries'] as List).map(
        (v) => Map<String, dynamic>.from(v as Map),
      ),
    );
    final industry = industries.firstWhere(
      (i) => i['id'] == _config['industry'],
    );
    final catalogue = List<Map<String, dynamic>>.from(
      ((_data['categories'] as List?) ?? []).map(
        (v) => Map<String, dynamic>.from(v as Map),
      ),
    );
    final selectedCategories = List<String>.from(
      (_config['categories'] as List?) ??
          (industry['categories'] as List?) ??
          [],
    );

    return Scaffold(
      appBar: AppBar(
        title: const ByLineMark(),
        leading: _step > 0 && _step < 6
            ? IconButton(
                onPressed: _busy ? null : () => setState(() => _step--),
                icon: const Icon(Icons.arrow_back),
              )
            : null,
        actions: [
          TextButton(
            onPressed: () => context.read<AppState>().signOut(),
            child: const Text('Sign out'),
          ),
        ],
      ),
      body: SafeArea(
        child: SetupFrame(
          step: _step,
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              if (_step < 6) ...[
                Text('Step ${_step + 1} of 6', style: T.small),
                const SizedBox(height: 12),
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: LinearProgressIndicator(
                    value: (_step + 1) / 6,
                    minHeight: 6,
                  ),
                ),
              ],
              const SizedBox(height: 24),
              StudioBanner(
                compact: true,
                title: titles[_step],
                eyebrow: _step == 6
                    ? 'WELCOME TO YOUR WRITING SPACE'
                    : 'MAKE BYLINE YOURS',
                caption: const [
                  'Your next chapter starts with a connection.',
                  'Follow the subjects that make you curious.',
                  'Bring your personality to the page.',
                  'See your ideas take shape.',
                  'Build a rhythm that works for you.',
                  'A small nudge. The final word is yours.',
                  'One thoughtful post at a time.',
                ][_step],
                scene: switch (_step) {
                  1 => StudioScene.ideas,
                  2 => StudioScene.voice,
                  4 || 5 => StudioScene.routine,
                  6 => StudioScene.celebrate,
                  _ => StudioScene.writing,
                },
              ),
              const SizedBox(height: 20),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Text(
                    _error!,
                    style: const TextStyle(color: Color(0xFF805200)),
                  ),
                ),
              if (_test)
                const Padding(
                  padding: EdgeInsets.only(bottom: 16),
                  child: Text(
                    'Local test • sample content • publishing disabled',
                  ),
                ),
              if (_step == 0) ...[
                const Text(
                  'Connect your personal profile. New drafts wait for you to choose Schedule post or Publish now.',
                ),
                if (_connected)
                  ListTile(
                    leading: const Icon(
                      Icons.check_circle,
                      color: Colors.green,
                    ),
                    title: Text(
                      'Connected as ${(_data['account'] as Map)['memberName'] ?? 'you'}',
                    ),
                  ),
                if (!_connected) _button('Connect LinkedIn', _connect),
                if (_connected || _test)
                  _button(
                    _test && !_connected
                        ? 'Continue with test account'
                        : 'Continue',
                    () => setState(() => _step = 1),
                  ),
              ],
              if (_step == 1) ...[
                if (_connected)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 20),
                    child: Text(
                      '✓ Connected as ${(_data['account'] as Map)['memberName'] ?? 'you'}',
                      style: T.small.copyWith(color: C.daylight),
                    ),
                  ),
                MultiSelectField(
                  label: 'Industry',
                  values: [_config['industry'] as String],
                  min: 1,
                  max: 1,
                  options: {
                    for (final i in industries)
                      i['id'] as String: i['label'] as String,
                  },
                  onChanged: _busy
                      ? null
                      : (values) => setState(() {
                          final v = values.single;
                          _config['industry'] = v;
                          _config.remove('categories');
                          _config['topics'] = List<String>.from(
                            industries.firstWhere((i) => i['id'] == v)['topics']
                                as List,
                          ).take(3).toList();
                        }),
                ),
                const SizedBox(height: 20),
                Text(
                  catalogue.isEmpty
                      ? 'Choose 1–12 topics. Add your own if you like.'
                      : 'Explore ${catalogue.length} subjects across every industry. Choose up to 12, then add any personal focus below.',
                ),
                const SizedBox(height: 16),
                if (catalogue.isNotEmpty)
                  MultiSelectField(
                    label: 'Subjects',
                    options: {
                      for (final c in catalogue)
                        c['id'] as String:
                            '${c['label']}${c['groupLabel'] == null ? '' : ' · ${c['groupLabel']}'}',
                    },
                    values: selectedCategories,
                    min: 1,
                    max: 12,
                    onChanged: _busy
                        ? null
                        : (ids) => setState(() {
                            _config['categories'] = ids;
                            _config['topics'] = ids
                                .map(
                                  (id) =>
                                      catalogue.firstWhere(
                                            (c) => c['id'] == id,
                                          )['label']
                                          as String,
                                )
                                .toList();
                          }),
                  ),
                const SizedBox(height: 16),
                MultiSelectField(
                  label: 'Editorial focus',
                  options: {
                    for (final t in {
                      ...List<String>.from(industry['topics'] as List),
                      ..._topics,
                    })
                      t: t,
                  },
                  values: _topics,
                  min: 1,
                  max: 12,
                  onChanged: _busy
                      ? null
                      : (v) => setState(() => _config['topics'] = v),
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: _topic,
                  maxLength: 80,
                  decoration: InputDecoration(
                    labelText: 'Add a topic',
                    suffixIcon: IconButton(
                      icon: const Icon(Icons.add),
                      onPressed: () {
                        final t = _topic.text.trim();
                        if (t.length > 1 &&
                            _topics.length < 12 &&
                            !_topics.any(
                              (v) => v.toLowerCase() == t.toLowerCase(),
                            )) {
                          setState(() {
                            _config['topics'] = [..._topics, t];
                            _topic.clear();
                          });
                        }
                      },
                    ),
                  ),
                ),
                _button('Continue', () {
                  if (_topics.isEmpty) {
                    setState(() => _error = 'Choose at least one topic.');
                  } else {
                    if (catalogue.isNotEmpty) {
                      _config['categories'] = selectedCategories;
                    }
                    setState(() => _step = 2);
                  }
                }),
              ],
              if (_step == 2) ...[
                const Text(
                  'This step is optional. Use a starting tone, describe your voice, or adjust the details. You can change everything later in Voice.',
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: _voiceNotes,
                  minLines: 3,
                  maxLines: 6,
                  maxLength: 1200,
                  decoration: const InputDecoration(
                    labelText: 'Describe your voice (optional)',
                    hintText:
                        'Warm, direct and practical. Explain ideas simply. Avoid sales language.',
                  ),
                ),
                const SizedBox(height: 12),
                FormSelect<String>(
                  label: 'Tone',
                  value: _config['voice'] as String,
                  options: {
                    for (final v in List<String>.from(_data['voices'] as List))
                      v: '${v[0].toUpperCase()}${v.substring(1)}',
                  },
                  onChanged: _busy
                      ? null
                      : (v) => setState(() => _config['voice'] = v),
                ),
                const SizedBox(height: 20),
                ExpansionTile(
                  title: const Text('Fine-tune your writing'),
                  subtitle: const Text(
                    'Length, structure, audience, openings and more',
                  ),
                  children: [
                    WritingPreferences(
                      value: _style,
                      onChanged: _busy
                          ? null
                          : (v) => setState(() {
                              // Store only the controls shown here; retain server defaults
                              // for unedited rules and phrase exclusions.
                              _config['style'] = {
                                ...Map<String, dynamic>.from(
                                  (_config['style'] as Map?) ?? {},
                                ),
                                'structure': v.structure,
                                'register': v.register,
                                'emoji': v.emoji,
                                'hook': v.hook,
                                'cta': v.cta,
                                'minWords': v.minWords,
                                'maxWords': v.maxWords,
                                'hashtagCount': v.hashtagCount,
                              };
                            }),
                    ),
                    TextField(
                      controller: _bannedPhrases,
                      maxLines: 4,
                      maxLength: 1200,
                      decoration: const InputDecoration(
                        labelText: 'Phrases to avoid (optional)',
                        helperText: 'One per line, up to 80 characters each.',
                      ),
                      onChanged: _busy
                          ? null
                          : (v) => setState(() {
                              _config['style'] = {
                                ...Map<String, dynamic>.from(
                                  (_config['style'] as Map?) ?? {},
                                ),
                                'bannedPhrases': v
                                    .split('\n')
                                    .map((s) => s.trim())
                                    .where((s) => s.isNotEmpty)
                                    .toList(),
                              };
                            }),
                    ),
                  ],
                ),
                ExpansionTile(
                  title: const Text('Use my past posts'),
                  subtitle: const Text(
                    'Optional examples of how you like to write',
                  ),
                  initiallyExpanded: false,
                  children: [
                    for (var i = 0; i < 3; i++)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 12),
                        child: TextField(
                          controller: _samples[i],
                          minLines: 3,
                          maxLines: 7,
                          maxLength: 2400,
                          decoration: InputDecoration(
                            labelText: 'Past post ${i + 1} (optional)',
                          ),
                        ),
                      ),
                  ],
                ),
                _button('Show my sample', _voiceContinue),
                TextButton(
                  onPressed: _busy ? null : _defaultVoice,
                  child: const Text('Use default voice'),
                ),
              ],
              if (_step == 3) ...[
                if (_data['preview'] != null) ...[
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: SelectableText(
                        (_data['preview'] as Map)['text'] as String,
                        style: T.copy,
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  for (final link
                      in (_data['preview'] as Map)['sources'] as List)
                    TextButton(
                      onPressed: () => launchUrl(
                        Uri.parse(link as String),
                        mode: LaunchMode.externalApplication,
                      ),
                      child: const Text('Read the source'),
                    ),
                  _button('This sounds like me', () async {
                    if (await _action('accept') && mounted) {
                      setState(() => _step = 4);
                    }
                  }),
                ],
                TextButton(
                  onPressed: _busy ? null : () => _action('preview'),
                  child: Text(
                    _data['preview'] == null ? 'Generate sample' : 'Regenerate',
                  ),
                ),
                TextButton(
                  onPressed: _busy ? null : () => setState(() => _step = 2),
                  child: const Text('Edit voice'),
                ),
              ],
              if (_step == 4) ...[
                const Text(
                  'This creates your first posting time in Timetable. A draft is prepared beforehand. You choose Schedule post or Publish now.',
                ),
                const SizedBox(height: 20),
                TimeChoice(
                  value: _config['time'] as String,
                  onChanged: _busy
                      ? null
                      : (v) => setState(() => _config['time'] = v),
                ),
                const SizedBox(height: 24),
                ZoneField(
                  controller: _zone,
                  enabled: !_busy,
                  onChanged: (_) => _zoneChosen = true,
                ),
                const SizedBox(height: 16),
                const Text(
                  'Multiple posting slots remain available in Settings after setup.',
                ),
                _button('Continue', () => setState(() => _step = 5)),
              ],
              if (_step == 5) ...[
                const Text(
                  'We’ll notify you when each timetable draft is ready. Open it to publish, edit, schedule or skip.',
                ),
                _button('Enable notifications', () => _finish(true)),
                TextButton(
                  onPressed: _busy ? null : () => _finish(false),
                  child: const Text('Not now'),
                ),
              ],
              if (_step == 6) ...[
                Text(
                  'Your first timetable entry is ${_data['nextDeliveryLabel'] ?? _config['time']}. Add more times in Timetable whenever you want.',
                ),
                if ((_data['config'] as Map)['notifications'] != 'enabled')
                  const Text(
                    'Notifications are not enabled. Open ByLine to review your post.',
                  ),
                _button('Open ByLine', widget.onComplete),
              ],
              if (_busy) ...[
                const SizedBox(height: 20),
                const LinearProgressIndicator(),
                Text(
                  _step == 3
                      ? 'Preparing a sample around your subjects and voice…'
                      : 'Saving your progress…',
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
