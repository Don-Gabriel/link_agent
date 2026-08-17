/// Design preview entrypoint — the whole app, seeded with fixture data, with
/// no backend.
///
/// Every UI screen in this app sits behind a login and a populated database,
/// which makes "look at the change you just made" a five-minute round trip
/// through the server. This runs the real widgets against a canned status
/// payload so a layout can be judged in seconds:
///
///   flutter run -t lib/main_preview.dart -d chrome
///   flutter run -t lib/main_preview.dart          (on a device or emulator)
///
/// It imports the real screens — not copies — so it cannot drift from what
/// ships. Network actions will fail here by design; this is for looking, not
/// for exercising the API.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import 'api/client.dart';
import 'api/models.dart';
import 'screens/home_screen.dart';
import 'state/app_state.dart';
import 'theme.dart';

/// A deliberately awkward payload: a post that crosses the fold, a failed one,
/// a long display name, an expiring token. The comfortable case never finds
/// layout bugs.
final previewStatus = <String, dynamic>{
  'initialized': true,
  'agent': {
    'agentId': 'preview',
    'name': 'A Working Engineer',
    'domain': 'music technology and emerging tech',
    'categories': ['music-tech-software', 'emerging-tech'],
    'timezone': 'Asia/Kolkata',
    'postTimeLocal': '09:30',
    'autoPublish': false,
    'paused': false,
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
    'presets': [
      {'id': 'practitioner', 'label': 'Practitioner', 'blurb': 'Restrained prose.', 'style': {}},
      {'id': 'builder', 'label': 'Builder', 'blurb': 'Lead then bullets.', 'style': {'structure': 'mixed', 'emoji': 'sparing', 'cta': 'soft', 'hashtagCount': 3}},
      {'id': 'operator', 'label': 'Operator', 'blurb': 'Short punchy lines.', 'style': {'structure': 'short-lines', 'emoji': 'expressive', 'hook': 'bold', 'cta': 'direct', 'hashtagCount': 4}},
      {'id': 'explainer', 'label': 'Explainer', 'blurb': 'Teaching voice.', 'style': {'structure': 'bullets', 'register': 'accessible', 'hashtagCount': 3}},
    ],
  },
  'schedule': {'nextRunLocal': 'Tue 12 Aug 2026, 09:30', 'cycleCount': 23},
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
      'hook': 'Ableton 12.2 ships MIDI generators, and the cost is not where the announcement suggests.',
      'rationale': 'This beat two model releases because it is something I actually measured, '
          'and the number is specific enough to argue with.',
      'status': 'draft',
      'kind': 'auto',
      'category': 'music-tech-software',
      'scores': {
        'persona_fit': 9,
        'category_fit': 9,
        'novelty': 7,
        'timeliness': 8,
        'non_duplication': 10,
      },
      'sources': ['https://cdm.link/example'],
      'hashtags': ['MusicTech', 'AudioDev'],
      'usedQuote': false,
      'createdAt': '2026-08-11T04:00:00.000Z',
    },
    {
      'id': 'p11',
      'seq': 11,
      'text': 'A short custom post that failed to send.',
      'rationale': 'Written by you.',
      'status': 'failed',
      'kind': 'custom',
      'hashtags': <String>[],
      'createdAt': '2026-08-10T04:00:00.000Z',
    },
  ],
  'history': <Map<String, dynamic>>[],
  'ambiguous': <Map<String, dynamic>>[],
};

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(systemChrome);

  // Real SharedPreferences, not the test mock: this entrypoint runs on a real
  // device, where the plugin works normally. Seeding the state directly below
  // is what keeps it offline — no stored session is read or needed.
  final state = AppState(await ApiClient.create())
    ..status = AppStatus.fromJson(previewStatus)
    ..phase = AuthPhase.signedIn;

  runApp(
    ChangeNotifierProvider<AppState>.value(
      value: state,
      child: MaterialApp(
        title: 'LinkdIn preview',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        home: const HomeScreen(),
      ),
    ),
  );
}
