/// Design preview entrypoint — the whole app, seeded with fixture data, with no
/// backend.
///
/// Every screen in this app sits behind a login and a populated database, which
/// makes "look at the change you just made" a five-minute round trip through
/// the server. This runs the real widgets against a canned status payload so a
/// layout can be judged in seconds:
///
///   flutter run -t lib/main_preview.dart -d chrome
///   flutter run -t lib/main_preview.dart          (on a device or emulator)
///
/// It imports the real screens — not copies — so it cannot drift from what
/// ships. Network actions will fail here by design; this is for looking, not
/// for exercising the API.
///
/// The payload is deliberately AWKWARD. The comfortable case never finds layout
/// bugs, so this one carries a post that crosses the fold, a failed send, a long
/// display name, an expiring token, a slot that chose silence, and a deadline
/// close enough to watch tick.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'api/client.dart';
import 'api/models.dart';
import 'screens/composer_screen.dart';
import 'screens/home_screen.dart';
import 'screens/settings_screen.dart';
import 'screens/timetable_screen.dart';
import 'screens/voice_screen.dart';
import 'state/app_state.dart';
import 'theme.dart';

/// Times are computed against the moment the preview starts, so the countdown
/// on the Desk is genuinely live and the day's rail has a real past and future.
Map<String, dynamic> buildPreviewStatus(DateTime now) {
  String iso(Duration offset) => now.add(offset).toUtc().toIso8601String();
  String hhmm(Duration offset) {
    final t = now.add(offset);
    return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  }

  final today = '${now.year.toString().padLeft(4, '0')}-'
      '${now.month.toString().padLeft(2, '0')}-'
      '${now.day.toString().padLeft(2, '0')}';

  return <String, dynamic>{
    'initialized': true,
    'agent': {
      'agentId': 'preview',
      'name': 'A Working Engineer',
      'domain': 'music technology and emerging tech',
      'categories': ['music-tech-software', 'emerging-tech'],
      'timezone': 'Asia/Kolkata',
      'postTimeLocal': '09:30',
      'autoPublish': false,
      'autoPublishCap': 2,
      'paused': false,
      'corpus': [
        'Shipped a firmware fix at 2am that turned out to be a units bug — the '
            'radio was being told to wait 500 microseconds where the datasheet '
            'meant milliseconds. Three weeks of "intermittent" was one letter.',
      ],
      'editNotes': 'Cuts the wind-up. Prefers a measured number in the first two '
          'lines and drops adjectives before nouns that already carry weight.',
      'style': {
        'structure': 'prose',
        'emoji': 'none',
        'hook': 'sharp',
        'cta': 'none',
        'minWords': 120,
        'maxWords': 220,
        'hashtagCount': 2,
        'register': 'practitioner',
        'signature': {
          'source': 'Marvel films',
          'maxWords': 12,
          'budgetPerFive': 1,
          'banned': ['With great power comes great responsibility', 'I am Iron Man'],
        },
        'customRules': <String>[],
        'bannedPhrases': ["Here's the thing", 'Let that sink in', 'Thoughts?'],
      },
    },
    'account': {
      'connected': true,
      'memberName': 'A Working Engineer',
      'daysRemaining': 12,
      'expiringSoon': true,
      'needsReauth': false,
    },
    'config': {
      'liveMode': false,
      'maxAutoCap': 3,
      'maxHashtags': 5,
      'categories': [
        {'id': 'music-tech-software', 'label': 'Music tech — software', 'blurb': ''},
        {'id': 'music-tech-hardware', 'label': 'Music tech — hardware', 'blurb': ''},
        {'id': 'emerging-tech', 'label': 'Emerging tech', 'blurb': ''},
        {'id': 'ai-ml', 'label': 'AI & ML engineering', 'blurb': ''},
        {'id': 'dev-tooling', 'label': 'Developer tooling', 'blurb': ''},
        {'id': 'hardware-embedded', 'label': 'Hardware & embedded', 'blurb': ''},
        {'id': 'compute-silicon', 'label': 'Compute & silicon', 'blurb': ''},
      ],
      'presets': [
        {'id': 'practitioner', 'label': 'Practitioner', 'blurb': 'Restrained prose.', 'style': {}},
        {
          'id': 'builder',
          'label': 'Builder',
          'blurb': 'Lead then bullets.',
          'style': {'structure': 'mixed', 'emoji': 'sparing', 'cta': 'soft', 'hashtagCount': 3},
        },
        {
          'id': 'operator',
          'label': 'Operator',
          'blurb': 'Short punchy lines.',
          'style': {
            'structure': 'short-lines',
            'emoji': 'expressive',
            'hook': 'bold',
            'cta': 'direct',
            'hashtagCount': 4,
          },
        },
        {
          'id': 'explainer',
          'label': 'Explainer',
          'blurb': 'Teaching voice.',
          'style': {'structure': 'bullets', 'register': 'accessible', 'hashtagCount': 3},
        },
      ],
    },
    'schedule': {'nextRunLocal': 'Tomorrow, 09:30', 'cycleCount': 23},
    'scheduler': {'healthy': true, 'minutesSince': 4, 'staleAfterMinutes': 16},
    'watchdog': {'minutesSince': 11},
    'slotLimits': {
      'maxSlots': 5,
      'minLeadMinutes': 10,
      'maxLeadMinutes': 720,
      'missedAfterMinutes': 45,
    },
    'slots': [
      {
        'id': 'slot-morning',
        'localTime': '09:30',
        'daysMask': 0x3E,
        'daysLabel': 'Weekdays',
        'leadMinutes': 45,
        'autoPublish': false,
        'categories': ['music-tech-software'],
        'enabled': true,
        'position': 0,
        'nextRunLocal': 'Tomorrow, 09:30',
      },
      {
        'id': 'slot-evening',
        'localTime': '18:45',
        'daysMask': 0x7F,
        'daysLabel': 'Every day',
        'leadMinutes': 90,
        'autoPublish': true,
        'categories': <String>[],
        'enabled': true,
        'position': 1,
        'nextRunLocal': 'Today, 18:45',
      },
    ],
    'timeline': [
      {
        'slotId': 'slot-morning',
        'localTime': '09:30',
        'runDate': today,
        'outcome': 'published',
        'postSeq': 9,
        'detail': 'A quieter week for hardware, so it led with the DSP piece.',
      },
      {
        'slotId': 'slot-midday',
        'localTime': '13:00',
        'runDate': today,
        'outcome': 'silent',
        'postSeq': null,
        'detail': 'Best candidate scored 5.8 — under the 6.5 bar.',
      },
      {
        'slotId': 'slot-evening',
        'localTime': hhmm(const Duration(hours: 2, minutes: 14)),
        'runDate': today,
        'outcome': 'drafted',
        'postSeq': 12,
        'detail': null,
      },
    ],
    'queue': [
      {
        'id': 'p12',
        'seq': 12,
        'text': 'Ableton 12.2 ships MIDI generators, and the cost is not where the '
            'announcement suggests. I ran four of them across a live set on an M1 Air '
            'and watched the CPU meter rather than the feature list.\n\n'
            'They evaluate per armed clip, not per track, so the overhead scales with '
            'how much of the session is live at once. Sixteen armed clips put me at 38 '
            'percent before a single plugin loaded. On a laptop that is the difference '
            'between a set that runs and a set that stutters in the second chorus.\n\n'
            'Useful feature. Just budget for it like you would a reverb, not like a '
            'piece of UI.',
        'hook': 'Ableton 12.2 ships MIDI generators, and the cost is not where the '
            'announcement suggests.',
        'rationale': 'This beat two model releases because it is something I actually '
            'measured, and the number is specific enough to argue with.',
        'status': 'draft',
        'kind': 'auto',
        'category': 'music-tech-software',
        'scores': {
          'persona_fit': 9,
          'category_fit': 9,
          'novelty': 7,
          'timeliness': 8,
          'non_duplication': 10,
          'total': 8.6,
        },
        'sources': ['https://cdm.link/example'],
        'hashtags': ['MusicTech', 'AudioDev'],
        'usedQuote': false,
        'createdAt': iso(const Duration(hours: -4)),
        'scheduledFor': iso(const Duration(hours: 2, minutes: 14)),
        'slotId': 'slot-evening',
      },
      {
        'id': 'p13',
        'seq': 13,
        'text': 'Three weeks of "intermittent" radio dropouts turned out to be one '
            'letter in the datasheet: the delay was specified in milliseconds and the '
            'firmware was waiting microseconds. Every retry landed inside the previous '
            'transmission window.',
        'hook': 'Three weeks of "intermittent" turned out to be one letter.',
        'rationale': 'Written by you.',
        'status': 'draft',
        'kind': 'custom',
        'hashtags': <String>[],
        'usedQuote': false,
        'createdAt': iso(const Duration(hours: -1)),
      },
      {
        'id': 'p11',
        'seq': 11,
        'text': 'A short custom post that failed to send.',
        'rationale': 'Written by you.',
        'status': 'failed',
        'kind': 'custom',
        'hashtags': <String>[],
        'createdAt': iso(const Duration(days: -1)),
      },
    ],
    'history': [
      {
        'id': 'p09',
        'seq': 9,
        'text': 'Every DSP tutorial starts with a biquad and stops before the part that '
            'bites: coefficient interpolation. Sweep a filter cutoff in a naive '
            'implementation and the coefficients jump between blocks, which is a step '
            'discontinuity in the transfer function — and a step is broadband. That is '
            'the zipper noise, and no amount of oversampling removes it.',
        'hook': 'Every DSP tutorial starts with a biquad and stops before the part that '
            'bites.',
        'rationale': '',
        'status': 'published',
        'kind': 'auto',
        'category': 'music-tech-software',
        'hashtags': ['AudioDev'],
        'usedQuote': false,
        'createdAt': iso(const Duration(days: -1, hours: -2)),
        'publishedAt': iso(const Duration(hours: -9)),
      },
    ],
    'rejections': [
      {
        'title': 'Google Play adds Venmo as a payment option',
        'url': 'https://example.com/venmo',
        'reason': 'Zero engineering substance and nothing to do with the categories '
            'this agent covers. Scored 3.1.',
      },
      {
        'title': 'Another large language model tops a benchmark leaderboard',
        'url': 'https://example.com/benchmark',
        'reason': 'Timely but not novel — the same story ran twice this month, and '
            'there is nothing here you have measured yourself. Scored 5.8.',
      },
    ],
    'llm': [
      {'model': 'gemini-2.5-flash', 'calls': 34, 'cap': 250},
      {'model': 'gemini-2.5-flash-lite', 'calls': 12, 'cap': 1000},
      {'model': 'gemini-2.0-flash', 'calls': 3, 'cap': 200},
    ],
    'budget': {
      'autoUsed': 1,
      'autoCap': 2,
      'manualUsed': 3,
      'manualCap': 40,
      'linkedinDailyRequests': 150,
    },
    'ambiguous': <Map<String, dynamic>>[],
  };
}

/// Which screen to open on, from `?screen=` in the URL.
///
/// Every screen below the three destinations is a pushed route, which on a
/// canvas-rendered web build cannot be reached by a synthetic click. Naming
/// them in the URL makes each one directly addressable — for looking at a
/// layout, and for screenshotting the whole app in one pass.
///
///   ?screen=desk | archive | settings
///   ?screen=timetable | voice | topics | linkedin | diagnostics | compose
const _destinations = {'desk': 0, 'archive': 1, 'settings': 2};

Widget? _routeFor(String? name) => switch (name) {
      'timetable' => const TimetableScreen(),
      'voice' => const VoiceScreen(),
      'topics' => const TopicsScreen(),
      'linkedin' => const LinkedInScreen(),
      'diagnostics' => const DiagnosticsScreen(),
      'compose' => const ComposerScreen(),
      _ => null,
    };

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(systemChrome);

  // Real SharedPreferences, not the test mock: this entrypoint runs on a real
  // device, where the plugin works normally. Seeding the state directly below
  // is what keeps it offline — no stored session is read or needed.
  final state = AppState(await ApiClient.create())
    ..status = AppStatus.fromJson(buildPreviewStatus(DateTime.now()))
    ..phase = AuthPhase.signedIn;

  final screen = Uri.base.queryParameters['screen'];
  // Settings is the sensible backdrop for a pushed settings page: closing one
  // should land somewhere that makes sense rather than on the Desk.
  final index = _destinations[screen] ?? (_routeFor(screen) == null ? 0 : 2);
  final route = _routeFor(screen);

  runApp(
    ChangeNotifierProvider<AppState>.value(
      value: state,
      child: MaterialApp(
        title: 'LinkdIn preview',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        home: _Preview(index: index, route: route),
      ),
    ),
  );
}

class _Preview extends StatefulWidget {
  const _Preview({required this.index, required this.route});

  final int index;
  final Widget? route;

  @override
  State<_Preview> createState() => _PreviewState();
}

class _PreviewState extends State<_Preview> {
  @override
  void initState() {
    super.initState();
    final route = widget.route;
    if (route == null) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        Navigator.of(context).push(MaterialPageRoute(builder: (_) => route));
      }
    });
  }

  @override
  Widget build(BuildContext context) => HomeScreen(initialIndex: widget.index);
}
