/// Render tests for every screen, at real phone sizes.
///
/// These exist because Flutter's most common UI defect — a RenderFlex overflow
/// — is not a crash and not a compile error. It is a yellow stripe you only
/// see if you happen to look at that screen at that width. Pumping each screen
/// at 360x640 (a small-but-common Android viewport) turns that into a test
/// failure, since the test binding reports overflows as exceptions.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:linkdin_mobile/api/client.dart';
import 'package:linkdin_mobile/api/models.dart';
import 'package:linkdin_mobile/screens/composer_screen.dart';
import 'package:linkdin_mobile/screens/gate_screen.dart';
import 'package:linkdin_mobile/screens/queue_screen.dart';
import 'package:linkdin_mobile/screens/schedule_screen.dart';
import 'package:linkdin_mobile/screens/status_screen.dart';
import 'package:linkdin_mobile/screens/voice_screen.dart';
import 'package:linkdin_mobile/state/app_state.dart';
import 'package:linkdin_mobile/theme.dart';
import 'package:linkdin_mobile/widgets/day_rail.dart';
import 'package:linkdin_mobile/widgets/panel.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A populated status payload — the busy case, where overflows actually happen.
Map<String, dynamic> statusFixture({
  bool connected = true,
  bool liveMode = true,
  bool needsReauth = false,
}) =>
    {
      'initialized': true,
      'agent': {
        'agentId': 'a1',
        'name': 'A Working Engineer',
        'domain': 'music technology and emerging tech',
        'categories': ['music-tech-software', 'emerging-tech'],
        'timezone': 'Asia/Kolkata',
        'postTimeLocal': '09:30',
        'autoPublish': false,
        'paused': false,
        'autoPublishCap': 1,
        'style': {'structure': 'prose', 'hashtagCount': 2},
      },
      'account': {
        'connected': connected,
        'memberName': 'Someone With A Fairly Long Display Name',
        'daysRemaining': 12,
        'expiringSoon': true,
        'needsReauth': needsReauth,
      },
      'config': {
        'liveMode': liveMode,
        'presets': [
          {'id': 'practitioner', 'label': 'Practitioner', 'blurb': 'x', 'style': {}},
          {'id': 'builder', 'label': 'Builder', 'blurb': 'x', 'style': {'emoji': 'sparing'}},
          {'id': 'operator', 'label': 'Operator', 'blurb': 'x', 'style': {'cta': 'direct'}},
          {'id': 'explainer', 'label': 'Explainer', 'blurb': 'x', 'style': {'structure': 'bullets'}},
        ],
      },
      'schedule': {'nextRunLocal': 'Tue 12 Aug, 09:30', 'cycleCount': 23},
      'queue': [
        {
          'id': 'p12',
          'seq': 12,
          'text': 'Ableton 12.2 ships MIDI generators, and the interesting part is not the '
              'feature list but the CPU cost of running four of them on a live set. '
              'I measured it on an M1 Air and the overhead was not where I expected.\n\n'
              'The generators run per-clip rather than per-track, so the cost scales with '
              'how many clips are armed, not how many tracks exist.',
          'hook': 'Ableton 12.2 ships MIDI generators, and the interesting part is not the feature list',
          'rationale': 'This beat two model releases because it is something I actually tested.',
          'status': 'draft',
          'kind': 'auto',
          'category': 'music-tech-software',
          'scores': {
            'persona_fit': 9,
            'category_fit': 8,
            'novelty': 7,
            'timeliness': 9,
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
          'text': 'A short one.',
          'status': 'failed',
          'kind': 'custom',
          'hashtags': <String>[],
        },
      ],
      'history': [],
      'ambiguous': [],
      'slots': [
        {
          'id': 's1',
          'localTime': '09:30',
          'daysMask': 62,
          'daysLabel': 'Mon-Fri',
          'leadMinutes': 15,
          'autoPublish': false,
          'categories': ['music-tech-software'],
          'enabled': true,
          'position': 0,
          'nextRunLocal': 'Tue 18 Aug, 09:30',
        },
        {
          'id': 's2',
          'localTime': '18:00',
          'daysMask': 127,
          'daysLabel': 'Every day',
          'leadMinutes': 30,
          'autoPublish': true,
          'categories': <String>[],
          'enabled': true,
          'position': 1,
          'nextRunLocal': 'Mon 17 Aug, 18:00',
        },
      ],
      'timeline': [
        {
          'slotId': 's1',
          'localTime': '09:30',
          'runDate': _todayLocal(),
          'scheduledFor': '2026-08-17T04:00:00.000Z',
          'outcome': 'published',
          'postSeq': 12,
        },
        {
          'slotId': 's2',
          'localTime': '18:00',
          'runDate': _todayLocal(),
          'scheduledFor': '2026-08-17T12:30:00.000Z',
          'outcome': 'silent',
          'detail': 'Nothing cleared 6.5 — best was 5.8 across 24 candidates.',
        },
      ],
      'slotLimits': {
        'maxSlots': 5,
        'minLeadMinutes': 10,
        'maxLeadMinutes': 720,
        'missedAfterMinutes': 45,
      },
    };

/// The schedule screen filters today's timeline by local date, so the fixture
/// has to be stamped with the machine's today rather than a frozen date.
String _todayLocal() {
  final now = DateTime.now();
  return '${now.year.toString().padLeft(4, '0')}-'
      '${now.month.toString().padLeft(2, '0')}-'
      '${now.day.toString().padLeft(2, '0')}';
}

Future<AppState> buildState(Map<String, dynamic>? status) async {
  SharedPreferences.setMockInitialValues({});
  final state = AppState(await ApiClient.create());
  if (status != null) {
    state.status = AppStatus.fromJson(status);
    state.phase = AuthPhase.signedIn;
  }
  return state;
}

void main() {
  // A small-but-common Android viewport. Anything that overflows will overflow
  // here first.
  const phone = Size(360, 640);

  Future<void> pumpScreen(WidgetTester tester, Widget screen, AppState state) async {
    tester.view.physicalSize = phone;
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ChangeNotifierProvider<AppState>.value(
        value: state,
        child: MaterialApp(
          theme: buildTheme(),
          home: Scaffold(body: SafeArea(child: screen)),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  /// Scroll a lazily-built ListView until [finder] is mounted.
  ///
  /// Needed because these screens are taller than a phone: a widget below the
  /// fold does not exist yet, so asserting on it without scrolling tests the
  /// viewport height rather than the screen.
  Future<void> scrollTo(WidgetTester tester, Finder finder) async {
    await tester.scrollUntilVisible(
      finder,
      120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
  }

  testWidgets('GateScreen renders without overflow', (tester) async {
    final state = await buildState(null);
    await pumpScreen(tester, const GateScreen(), state);
    expect(find.text('Sign in'), findsOneWidget);
    // The emulator hint is load-bearing: without it the first run fails on a
    // connection error nobody can diagnose.
    expect(find.textContaining('10.0.2.2'), findsWidgets);
  });

  testWidgets('QueueScreen renders a populated queue without overflow', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const QueueScreen(), state);
    expect(find.text('Publish'), findsOneWidget); // only the draft is actionable
    expect(find.text('see more'), findsOneWidget); // long post crosses the fold
  });

  testWidgets('QueueScreen surfaces dry run and reauth notices', (tester) async {
    final state = await buildState(statusFixture(liveMode: false, needsReauth: true));
    await pumpScreen(tester, const QueueScreen(), state);
    expect(find.text('Dry run'), findsOneWidget);
    expect(find.text('LinkedIn needs reconnecting'), findsOneWidget);
  });

  testWidgets('QueueScreen segments reach published history and rejections', (tester) async {
    final fixture = statusFixture();
    fixture['history'] = [
      {
        'id': 'p1',
        'seq': 1,
        'text': 'A post that already went out to LinkedIn some time ago.',
        'status': 'published',
        'hashtags': ['DSP'],
        'publishedAt': '2026-08-10T09:30:00.000Z',
      },
    ];
    fixture['rejections'] = [
      {
        'title': 'Google Play adds Venmo as a payment option',
        'url': 'https://example.com/venmo',
        'reason': 'Consumer payment integration news, zero engineering substance.',
      },
    ];
    final state = await buildState(fixture);
    await pumpScreen(tester, const QueueScreen(), state);

    // Defaults to the queue.
    expect(find.textContaining('Ableton 12.2'), findsWidgets);

    await tester.tap(find.text('Published'));
    await tester.pumpAndSettle();
    expect(find.textContaining('already went out to LinkedIn'), findsOneWidget);

    await tester.tap(find.text('Passed over'));
    await tester.pumpAndSettle();
    expect(find.text('Google Play adds Venmo as a payment option'), findsOneWidget);
    expect(find.textContaining('zero engineering substance'), findsOneWidget);
  });

  testWidgets('QueueScreen segments have their own empty states', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const QueueScreen(), state);

    await tester.tap(find.text('Published'));
    await tester.pumpAndSettle();
    expect(find.text('Nothing published yet'), findsOneWidget);

    await tester.tap(find.text('Passed over'));
    await tester.pumpAndSettle();
    expect(find.text('Nothing passed over'), findsOneWidget);
  });

  testWidgets('QueueScreen makes a stranded approved post actionable again', (tester) async {
    // A publish that fails on the daily cap leaves the post 'approved'. If that
    // card renders read-only it can never be retried or dropped.
    final fixture = statusFixture();
    (fixture['queue'] as List)[1] = {
      'id': 'p11',
      'seq': 11,
      'text': 'A post that was approved but never actually sent anywhere.',
      'status': 'approved',
      'kind': 'custom',
      'hashtags': <String>[],
    };
    final state = await buildState(fixture);
    await pumpScreen(tester, const QueueScreen(), state);

    await scrollTo(tester, find.textContaining('Approved but never sent'));
    expect(find.textContaining('Approved but never sent'), findsOneWidget);
    // Two publishable cards now: the draft and the stranded one.
    expect(find.text('Publish'), findsNWidgets(2));
  });

  testWidgets('QueueScreen leaves an ambiguous send inert', (tester) async {
    final fixture = statusFixture();
    (fixture['queue'] as List)[1] = {
      'id': 'p11',
      'seq': 11,
      'text': 'A send that LinkedIn never confirmed one way or the other.',
      'status': 'unknown',
      'hashtags': <String>[],
    };
    final state = await buildState(fixture);
    await pumpScreen(tester, const QueueScreen(), state);

    await scrollTo(tester, find.textContaining('never confirmed'));
    // Only the real draft is publishable — republishing an ambiguous send is
    // how you post twice to a real audience.
    expect(find.text('Publish'), findsOneWidget);
  });

  testWidgets('QueueScreen shows an empty state rather than a blank page', (tester) async {
    final fixture = statusFixture()..['queue'] = <Map<String, dynamic>>[];
    final state = await buildState(fixture);
    await pumpScreen(tester, const QueueScreen(), state);
    expect(find.text('Nothing waiting'), findsOneWidget);
  });

  testWidgets('ComposerScreen renders without overflow', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const ComposerScreen(), state);
    expect(find.text('Save to queue'), findsOneWidget);
    expect(find.text('Publish now'), findsOneWidget);
  });

  testWidgets('ComposerScreen offers rewrite on a NEW post, gated on enough text', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const ComposerScreen(), state);

    await scrollTo(tester, find.text('Rewrite with AI'));
    final button = tester.widget<OutlinedButton>(
      find.ancestor(of: find.text('Rewrite with AI'), matching: find.byType(OutlinedButton)),
    );
    // Present even with no draft loaded — but inert until there is something
    // worth rewriting, since the endpoint rejects under 20 characters.
    expect(button.onPressed, isNull);

    await tester.enterText(
      find.byType(TextField).first,
      'A sentence long enough to be worth rewriting properly.',
    );
    await tester.pumpAndSettle();

    await scrollTo(tester, find.text('Rewrite with AI'));
    final enabled = tester.widget<OutlinedButton>(
      find.ancestor(of: find.text('Rewrite with AI'), matching: find.byType(OutlinedButton)),
    );
    expect(enabled.onPressed, isNotNull);
  });

  testWidgets('ComposerScreen disables sending an empty draft', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const ComposerScreen(), state);
    final button = tester.widget<FilledButton>(
      find.ancestor(of: find.text('Save to queue'), matching: find.byType(FilledButton)),
    );
    expect(button.onPressed, isNull);
  });

  testWidgets('ComposerScreen in edit mode pre-fills the draft and offers a rewrite', (tester) async {
    final state = await buildState(statusFixture());
    state.startEditing(state.status!.queue.first);

    await pumpScreen(tester, const ComposerScreen(), state);

    expect(find.text('Editing p12'), findsOneWidget);
    expect(find.textContaining('Ableton 12.2 ships MIDI generators'), findsWidgets);

    await scrollTo(tester, find.text('Rewrite with AI'));
    expect(find.text('Rewrite with AI'), findsOneWidget);
    // The label must change too — "Save to queue" on an existing draft would
    // read as creating a second post.
    expect(find.text('Save changes'), findsOneWidget);
    expect(find.text('Save to queue'), findsNothing);
  });

  testWidgets('ComposerScreen warns when the voice changed under an existing draft', (tester) async {
    final state = await buildState(statusFixture());
    state.startEditing(state.status!.queue.first);
    await pumpScreen(tester, const ComposerScreen(), state);

    expect(find.text('Your voice changed'), findsNothing);

    // Simulate the user switching to the Voice tab and changing the style.
    final fixture = statusFixture();
    (fixture['agent'] as Map<String, dynamic>)['style'] = {
      'structure': 'bullets',
      'emoji': 'expressive',
    };
    state.status = AppStatus.fromJson(fixture);
    state.notifyListeners();
    await tester.pumpAndSettle();

    // A banner offering a rewrite — NOT a silent regeneration of text the user
    // may have typed by hand.
    expect(find.text('Your voice changed'), findsOneWidget);
    expect(find.textContaining('Ableton 12.2 ships MIDI generators'), findsWidgets);
  });

  testWidgets('ComposerScreen loads the draft hashtags instead of dropping them', (tester) async {
    final state = await buildState(statusFixture());
    state.startEditing(state.status!.queue.first);
    await pumpScreen(tester, const ComposerScreen(), state);

    // p12 carries MusicTech and AudioDev. Editing used to send an empty list,
    // which silently stripped whatever the writer had chosen.
    await scrollTo(tester, find.text('#MusicTech'));
    expect(find.text('#MusicTech'), findsOneWidget);
    expect(find.text('#AudioDev'), findsOneWidget);
    expect(find.text('HASHTAGS (2/2)'), findsOneWidget);
  });

  testWidgets('ComposerScreen shows a preview before anything is saved', (tester) async {
    final state = await buildState(statusFixture());
    state.startEditing(state.status!.queue.first);
    await pumpScreen(tester, const ComposerScreen(), state);

    await scrollTo(tester, find.text('Save changes'));
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();

    // A preview sheet, not a save. The assembled text includes the hashtags,
    // which the composer's own text box never shows.
    expect(find.text('PREVIEW'), findsOneWidget);
    expect(find.text('This is what goes out.'), findsOneWidget);
    expect(find.textContaining('#MusicTech'), findsWidgets);
    expect(find.text('see more'), findsOneWidget);
  });

  testWidgets('ComposerScreen preview can be backed out of without saving', (tester) async {
    final state = await buildState(statusFixture());
    state.startEditing(state.status!.queue.first);
    await pumpScreen(tester, const ComposerScreen(), state);

    await scrollTo(tester, find.text('Save changes'));
    await tester.tap(find.text('Save changes'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();

    expect(find.text('PREVIEW'), findsNothing);
    // Still editing — backing out of a preview must not discard the session.
    expect(state.editing, isNotNull);
  });

  testWidgets('ComposerScreen leaves edit mode when editing is cancelled', (tester) async {
    final state = await buildState(statusFixture());
    state.startEditing(state.status!.queue.first);
    await pumpScreen(tester, const ComposerScreen(), state);
    expect(find.text('Editing p12'), findsOneWidget);

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    expect(find.text('Editing p12'), findsNothing);
    expect(find.text('Save to queue'), findsOneWidget);
  });

  testWidgets('VoiceScreen renders every control without overflow', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const VoiceScreen(), state);

    // The writing-samples panel now sits above the knobs — deliberately, since
    // showing the writer real prose moves the voice further than any of them —
    // so the Shape controls start below the fold and have to be scrolled to.
    await scrollTo(tester, find.text('Paragraphs'));

    // Every option is visible as a chip rather than hidden in a dropdown —
    // that is the point of the screen, so it is worth asserting.
    expect(find.text('Paragraphs'), findsOneWidget);
    expect(find.text('Bullets'), findsOneWidget);
    expect(find.text('Sparing'), findsOneWidget);
    expect(find.text('Bold claim'), findsOneWidget);

    await scrollTo(tester, find.text('Minimum words'));
    expect(find.text('Minimum words'), findsOneWidget);
    expect(find.text('Hashtags'), findsOneWidget);

    // Save is inert until something actually changes.
    await scrollTo(tester, find.text('Saved'));
    final save = tester.widget<FilledButton>(
      find.ancestor(of: find.text('Saved'), matching: find.byType(FilledButton)),
    );
    expect(save.onPressed, isNull);
  });

  testWidgets('VoiceScreen stages a change locally and offers Save', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const VoiceScreen(), state);

    await scrollTo(tester, find.text('Bullets'));
    await tester.tap(find.text('Bullets'));
    await tester.pumpAndSettle();

    // Staged, not sent: the saved status is untouched until Save is pressed.
    await scrollTo(tester, find.text('Revert changes'));
    expect(find.text('Save'), findsOneWidget);
    expect(find.text('Revert changes'), findsOneWidget);
    expect(state.status!.agent!.style.structure, 'prose');
  });

  testWidgets('VoiceScreen header shows the staged style, not the saved one', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const VoiceScreen(), state);

    expect(find.text('CURRENT VOICE'), findsOneWidget);
    expect(find.textContaining('Paragraphs'), findsWidgets);

    await scrollTo(tester, find.text('Bullets'));
    await tester.tap(find.text('Bullets'));
    await tester.pumpAndSettle();

    // Back to the top: reaching the Shape chips scrolled the header out of the
    // lazy ListView, so it no longer exists to assert on. A negative delta
    // scrolls the other way.
    await tester.scrollUntilVisible(
      find.text('VOICE — UNSAVED'),
      -120,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    // The header used to keep showing the SAVED summary while the controls
    // below displayed something else, which reads as "my change did nothing".
    expect(find.text('VOICE — UNSAVED'), findsOneWidget);
    expect(find.text('UNSAVED'), findsOneWidget);
    expect(find.textContaining('Bullet list'), findsWidgets);
  });

  testWidgets('VoiceScreen text fields mark the config dirty', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const VoiceScreen(), state);

    await scrollTo(tester, find.text('BANNED PHRASES (ONE PER LINE)'));
    // The banned-phrases box is the first multi-line field in the Rules panel.
    await tester.enterText(find.byType(TextFormField).first, 'synergy\nleverage');
    await tester.pumpAndSettle();

    // Writing _draft without setState left _dirty stale, so Save stayed
    // disabled and these edits could never be saved at all.
    await scrollTo(tester, find.text('Save'));
    final save = tester.widget<FilledButton>(
      find.ancestor(of: find.text('Save'), matching: find.byType(FilledButton)),
    );
    expect(save.onPressed, isNotNull);
  });

  testWidgets('VoiceScreen steppers respect their bounds', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const VoiceScreen(), state);

    // Hashtags starts at 2; a third decrement would go below zero.
    final decrease = find.byTooltip('Decrease Hashtags');
    await scrollTo(tester, decrease);

    await tester.tap(decrease);
    await tester.pumpAndSettle();
    await tester.tap(decrease);
    await tester.pumpAndSettle();

    // byTooltip matches the Tooltip that IconButton builds internally, so walk
    // up to the button itself to read its enabled state.
    final button = tester.widget<IconButton>(
      find.ancestor(of: decrease, matching: find.byType(IconButton)),
    );
    expect(button.onPressed, isNull, reason: 'must not go below zero');
  });

  testWidgets('StatusScreen renders without overflow', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const StatusScreen(), state);

    expect(find.text('A Working Engineer'), findsOneWidget);
    await scrollTo(tester, find.textContaining('Access valid for 12 more days'));
    await scrollTo(tester, find.text('Sign out'));
    expect(find.text('Sign out'), findsOneWidget);
  });

  testWidgets('StatusScreen shows both publishing budgets separately', (tester) async {
    final fixture = statusFixture();
    fixture['budget'] = {
      'autoUsed': 1,
      'autoCap': 1,
      'manualUsed': 6,
      'manualCap': 40,
      'linkedinDailyRequests': 150,
    };
    final state = await buildState(fixture);
    await pumpScreen(tester, const StatusScreen(), state);

    await scrollTo(tester, find.text('Agent published'));
    // The whole point of the split: a spent agent allowance and six manual
    // posts are different numbers, and conflating them made a day of manual
    // posting look like the agent was out of budget.
    expect(find.text('1 / 1'), findsOneWidget);
    expect(find.text('You published'), findsOneWidget);
    expect(find.text('6 / 40'), findsOneWidget);
  });

  testWidgets('StatusScreen refuses auto-publish without a usable connection', (tester) async {
    final state = await buildState(statusFixture(connected: false));
    await pumpScreen(tester, const StatusScreen(), state);

    await scrollTo(tester, find.text('Publish automatically'));
    final row = find.ancestor(of: find.text('Publish automatically'), matching: find.byType(ToggleRow));
    final toggle = tester.widget<Switch>(
      find.descendant(of: row, matching: find.byType(Switch)),
    );

    // A disabled switch plus an explanation. Either alone is a worse UI: a dead
    // control with no reason, or a reason with a control that still fires.
    expect(toggle.onChanged, isNull);
    expect(find.textContaining('Connect LinkedIn before enabling'), findsOneWidget);
  });

  // The writing samples are the largest single lever on how the output sounds,
  // so the panel has to be reachable and has to explain itself when empty.
  testWidgets('VoiceScreen invites writing samples when there are none', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const VoiceScreen(), state);

    expect(find.text('HOW YOU WRITE'), findsOneWidget);
    expect(find.textContaining('Paste a few posts you are happy with'), findsOneWidget);
    expect(find.textContaining('At least 80 characters'), findsOneWidget);
  });

  // A short paste teaches a model nothing and the server drops it silently, so
  // the button must stay inert rather than appearing to work.
  testWidgets('VoiceScreen will not add a sample too short to carry a voice', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const VoiceScreen(), state);

    await tester.enterText(find.byType(TextField).first, 'too short');
    await tester.pumpAndSettle();

    final button = tester.widget<FilledButton>(
      find.ancestor(of: find.text('Add sample'), matching: find.byType(FilledButton)),
    );
    expect(button.onPressed, isNull);
    expect(find.textContaining('more characters needed'), findsOneWidget);
  });

  testWidgets('VoiceScreen lists stored samples and what it learned', (tester) async {
    final withCorpus = statusFixture();
    (withCorpus['agent'] as Map<String, dynamic>)['corpus'] = [
      'A real post of mine that is comfortably long enough to count as a writing sample for the writer to study.',
    ];
    (withCorpus['agent'] as Map<String, dynamic>)['editNotes'] =
        'Cut the scene-setting first sentence and open on the number.';

    final state = await buildState(withCorpus);
    await pumpScreen(tester, const VoiceScreen(), state);

    expect(find.textContaining('1 sample.'), findsOneWidget);
    expect(find.text('WHAT IT LEARNED FROM YOUR EDITS'), findsOneWidget);
    expect(find.textContaining('open on the number'), findsOneWidget);
  });

  testWidgets('ScheduleScreen renders the timetable without overflow', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const ScheduleScreen(), state);

    // Scrolling to the bottom control builds every row on the way, so an
    // overflow below the fold fails here rather than hiding until someone looks.
    // The target has to be unique: a time like "18:00" appears BOTH in today's
    // timeline and on its slot tile, and an ambiguous finder throws before it
    // ever scrolls.
    await scrollTo(tester, find.text('Add a posting time'));

    expect(find.text('Mon-Fri'), findsOneWidget);
    expect(find.text('Every day'), findsOneWidget);
  });

  // A slot that found nothing must SAY so, with the score. Rendered as a gap it
  // is indistinguishable from a broken cron, which is the anxiety this row
  // exists to remove — silence here is a judgment, not a failure.
  testWidgets('ScheduleScreen explains a silent slot instead of leaving a gap', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const ScheduleScreen(), state);

    expect(find.text('Stayed quiet'), findsOneWidget);
    expect(find.textContaining('best was 5.8'), findsOneWidget);
  });

  testWidgets('ScheduleScreen distinguishes hold-mode from publish-without-me', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const ScheduleScreen(), state);

    // s1 waits for a human, s2 does not, and the blurb has to say which.
    await scrollTo(tester, find.textContaining('Waits for you to clear it'));
    expect(find.textContaining('Waits for you to clear it'), findsOneWidget);
    expect(find.textContaining('whether or not you have read it'), findsOneWidget);
  });

  // The last remaining day cannot be turned off: an empty mask is a slot that
  // never fires, and a schedule that silently never runs is the worst outcome
  // this screen can produce. A single-slot fixture keeps the day chips
  // unambiguous — with two slots there are fourteen of them.
  // The rail is the signature element: time down the left, events hung off it.
  // A silent slot must still read as a decision rather than a gap.
  testWidgets('ScheduleScreen leads with the day rail', (tester) async {
    final withNext = statusFixture();
    (withNext['queue'] as List).insert(0, {
      'id': 'p20',
      'seq': 20,
      'text': 'A scheduled draft that is waiting for a decision from a human being.',
      'hook': 'A scheduled draft that is waiting for a decision.',
      'status': 'draft',
      'scheduledFor':
          DateTime.now().toUtc().add(const Duration(minutes: 11)).toIso8601String(),
    });

    final state = await buildState(withNext);
    await pumpScreen(tester, const ScheduleScreen(), state);

    // The one thing with a deadline, at full weight, with a live countdown.
    expect(find.text('NEXT UP'), findsOneWidget);
    expect(find.text('to review'), findsOneWidget);
    expect(find.text('THE DAY SO FAR'), findsOneWidget);
    expect(find.byType(DayRail), findsOneWidget);

    // And the day still explains itself, rail or not.
    expect(find.text('Stayed quiet'), findsOneWidget);
    expect(find.text('Published'), findsOneWidget);
  });

  // Cleared means the card stops asking anything of you — it cools from the
  // write clock to the send clock and the label changes with it.
  testWidgets('NextUpCard cools once the draft is cleared', (tester) async {
    final cleared = statusFixture();
    (cleared['queue'] as List).insert(0, {
      'id': 'p21',
      'seq': 21,
      'text': 'A draft that has already been cleared and is simply waiting for its time.',
      'hook': 'A draft that has already been cleared.',
      'status': 'approved',
      'scheduledFor':
          DateTime.now().toUtc().add(const Duration(minutes: 20)).toIso8601String(),
      'clearedAt': DateTime.now().toUtc().toIso8601String(),
    });

    final state = await buildState(cleared);
    await pumpScreen(tester, const ScheduleScreen(), state);

    expect(find.text('CLEARED'), findsOneWidget);
    expect(find.text('to send'), findsOneWidget);
    expect(find.text('NEXT UP'), findsNothing);
  });

  testWidgets('ScheduleScreen refuses to clear the last enabled day', (tester) async {
    final oneDay = statusFixture();
    oneDay['slots'] = [
      {
        ...(oneDay['slots'] as List).first as Map<String, dynamic>,
        'daysMask': 1 << 1, // Monday only
        'daysLabel': 'Mon',
      },
    ];
    final state = await buildState(oneDay);
    await pumpScreen(tester, const ScheduleScreen(), state);

    await scrollTo(tester, find.text('Add a posting time'));

    // Tapping the only selected day must change nothing and fire no request.
    await tester.tap(find.text('M'));
    await tester.pumpAndSettle();

    expect(state.error, isNull);
    expect(find.text('Mon'), findsOneWidget, reason: 'the mask must be unchanged');
  });
}
