/// Render tests for every screen, at real phone sizes.
///
/// These exist because Flutter's most common UI defect — a RenderFlex overflow
/// — is not a crash and not a compile error. It is a yellow stripe you only
/// see if you happen to look at that screen at that width. Pumping each screen
/// at 360x640 (a small-but-common Android viewport) turns that into a test
/// failure, since the test binding reports overflows as exceptions.
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:linkdin_mobile/api/client.dart';
import 'package:linkdin_mobile/api/models.dart';
import 'package:linkdin_mobile/screens/archive_screen.dart';
import 'package:linkdin_mobile/screens/composer_screen.dart';
import 'package:linkdin_mobile/screens/desk_screen.dart';
import 'package:linkdin_mobile/screens/gate_screen.dart';
import 'package:linkdin_mobile/screens/settings_screen.dart';
import 'package:linkdin_mobile/screens/timetable_screen.dart';
import 'package:linkdin_mobile/screens/voice_screen.dart';
import 'package:linkdin_mobile/state/app_state.dart';
import 'package:linkdin_mobile/theme.dart';
import 'package:linkdin_mobile/widgets/day_rail.dart';
import 'package:linkdin_mobile/widgets/form_select.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// A populated status payload — the busy case, where overflows actually happen.
Map<String, dynamic> statusFixture({
  bool connected = true,
  bool liveMode = true,
  bool needsReauth = false,
}) => {
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
      {
        'id': 'practitioner',
        'label': 'Practitioner',
        'blurb': 'x',
        'style': {},
      },
      {
        'id': 'builder',
        'label': 'Builder',
        'blurb': 'x',
        'style': {'emoji': 'sparing'},
      },
      {
        'id': 'operator',
        'label': 'Operator',
        'blurb': 'x',
        'style': {'cta': 'direct'},
      },
      {
        'id': 'explainer',
        'label': 'Explainer',
        'blurb': 'x',
        'style': {'structure': 'bullets'},
      },
    ],
  },
  'schedule': {'nextRunLocal': 'Tue 12 Aug, 09:30', 'cycleCount': 23},
  'queue': <Map<String, dynamic>>[
    {
      'id': 'p12',
      'seq': 12,
      'text':
          'Ableton 12.2 ships MIDI generators, and the interesting part is not the '
          'feature list but the CPU cost of running four of them on a live set. '
          'I measured it on an M1 Air and the overhead was not where I expected.\n\n'
          'The generators run per-clip rather than per-track, so the cost scales with '
          'how many clips are armed, not how many tracks exist.',
      'hook':
          'Ableton 12.2 ships MIDI generators, and the interesting part is not the feature list',
      'rationale':
          'This beat two model releases because it is something I actually tested.',
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
  'slots': <Map<String, dynamic>>[
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
  'timeline': <Map<String, dynamic>>[
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
  'scheduler': {
    'lastTickAt': '2026-08-20T13:00:00.000Z',
    'minutesSince': 2,
    'healthy': true,
    'staleAfterMinutes': 16,
  },
  'slotLimits': {
    'maxSlots': 5,
    'minLeadMinutes': 10,
    'maxLeadMinutes': 720,
    'missedAfterMinutes': 45,
  },
};

/// The Desk filters today's rail by local date, so the fixture has to be
/// stamped with the machine's today rather than a frozen date.
String _todayLocal() {
  final now = DateTime.now();
  return '${now.year.toString().padLeft(4, '0')}-'
      '${now.month.toString().padLeft(2, '0')}-'
      '${now.day.toString().padLeft(2, '0')}';
}

Future<AppState> buildState(Map<String, dynamic>? status) async {
  if (status != null) return buildStateWithApi(status, status);
  SharedPreferences.setMockInitialValues({});
  return AppState(await ApiClient.create());
}

/// Same, wired to a transport that answers every call with [response].
/// Needed by anything that presses a button which actually talks to the server.
Future<AppState> buildStateWithApi(
  Map<String, dynamic>? status,
  Map<String, dynamic> response,
) async {
  SharedPreferences.setMockInitialValues({
    'session_cookie': 'lc_session=abc',
    'base_url': 'http://test.local',
  });
  final client = MockClient(
    (_) async => http.Response(
      jsonEncode(response),
      200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    ),
  );
  final state = AppState(await ApiClient.create(httpClient: client));
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

  Future<void> pumpScreen(
    WidgetTester tester,
    Widget screen,
    AppState state,
  ) async {
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

  // ------------------------------------------------------------------ gate

  testWidgets('GateScreen renders without overflow', (tester) async {
    final state = await buildState(null);
    await pumpScreen(tester, const GateScreen(), state);
    expect(find.text('Sign in'), findsOneWidget);
    // The emulator hint is load-bearing: without it the first run fails on a
    // connection error nobody can diagnose.
    expect(find.textContaining('10.0.2.2'), findsWidgets);
  });

  // ------------------------------------------------------------------ desk

  testWidgets('DeskScreen renders a populated desk without overflow', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const DeskScreen(), state);
    // Only the real draft is publishable; the failed one is stranded below.
    await scrollTo(tester, find.textContaining('Ableton 12.2'));
    expect(find.textContaining('Ableton 12.2'), findsWidgets);
    expect(
      find.text('see more'),
      findsOneWidget,
    ); // the long post crosses the fold
  });

  // Dry run is deliberately a masthead chip rather than a banner: it is a
  // standing condition, and as a banner it was permanently the first thing on
  // the screen, above the thing with a deadline.
  testWidgets(
    'DeskScreen states dry run and a dead token without burying the desk',
    (tester) async {
      final state = await buildState(
        statusFixture(liveMode: false, needsReauth: true),
      );
      await pumpScreen(tester, const DeskScreen(), state);
      expect(find.text('DRY RUN'), findsOneWidget);
      expect(find.textContaining('LinkedIn access expired'), findsOneWidget);
    },
  );

  // The regression this guards: the countdown used to live on a different tab
  // from the draft it applied to, so the same post was rendered twice in two
  // shapes. The next post due IS the first card here, wearing its own clock.
  testWidgets(
    'DeskScreen leads with the next post due, wearing its countdown',
    (tester) async {
      final fixture = statusFixture();
      (fixture['queue'] as List)[0] = {
        ...(fixture['queue'] as List)[0] as Map<String, dynamic>,
        'scheduledFor': DateTime.now()
            .add(const Duration(hours: 2, minutes: 14))
            .toUtc()
            .toIso8601String(),
        'slotId': 's2',
      };
      final state = await buildState(fixture);
      await pumpScreen(tester, const DeskScreen(), state);

      expect(find.text('NEXT OUT'), findsOneWidget);
      // Two formats, so 2 hours 13 minutes cannot be read as 2 minutes 13
      // seconds. The colon form only ever means minutes and seconds.
      expect(find.textContaining('2h13m'), findsOneWidget);
      expect(find.textContaining('TO REVIEW'), findsOneWidget);
      // And the post it belongs to is right underneath it, not a tab away.
      await scrollTo(tester, find.textContaining('Ableton 12.2'));
      expect(find.textContaining('Ableton 12.2'), findsWidgets);
    },
  );

  testWidgets('a cleared post cools to the send clock', (tester) async {
    final fixture = statusFixture();
    (fixture['queue'] as List)[0] = {
      ...(fixture['queue'] as List)[0] as Map<String, dynamic>,
      'status': 'approved',
      'scheduledFor': DateTime.now()
          .add(const Duration(minutes: 40))
          .toUtc()
          .toIso8601String(),
      'clearedAt': DateTime.now().toUtc().toIso8601String(),
    };
    final state = await buildState(fixture);
    await pumpScreen(tester, const DeskScreen(), state);

    expect(find.text('SCHEDULED'), findsOneWidget);
    expect(find.textContaining('TO SEND'), findsOneWidget);
    expect(find.text('NEXT OUT'), findsNothing);
  });

  testWidgets('DeskScreen shows the day rail, silence included', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const DeskScreen(), state);
    await scrollTo(tester, find.byType(DayRail));

    // The state the rail exists for: a slot that judged its candidates and
    // chose silence. Rendered as a gap it is indistinguishable from a dead cron.
    expect(find.text('Stayed quiet'), findsOneWidget);
    expect(find.textContaining('best was 5.8'), findsOneWidget);
    expect(find.text('Published'), findsOneWidget);
  });

  testWidgets('DeskScreen makes a stranded approved post actionable again', (
    tester,
  ) async {
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
    await pumpScreen(tester, const DeskScreen(), state);

    await scrollTo(
      tester,
      find.textContaining('approved but never actually sent'),
    );
    expect(
      find.textContaining('approved but never actually sent'),
      findsOneWidget,
    );
    // The stranded card carries a Publish of its own. Asserting a COUNT here
    // would be counting the viewport rather than the screen: the draft above
    // has already been unmounted by the scroll that got us here.
    expect(find.text('Publish now'), findsWidgets);
  });

  testWidgets('DeskScreen leaves an ambiguous send inert', (tester) async {
    final fixture = statusFixture();
    (fixture['queue'] as List)[1] = {
      'id': 'p11',
      'seq': 11,
      'text': 'A send that LinkedIn never confirmed one way or the other.',
      'status': 'unknown',
      'hashtags': <String>[],
    };
    final state = await buildState(fixture);
    await pumpScreen(tester, const DeskScreen(), state);

    // 'never confirmed' appears in BOTH the post body and the explanation above
    // it, and scrollUntilVisible needs exactly one match. The heading is unique.
    await scrollTo(tester, find.text('Needs a hand'));
    // Republishing a send LinkedIn never confirmed is how you post twice to a
    // real audience, so this card offers nothing at all. Asserted here rather
    // than by counting: the draft above has been unmounted by the scroll.
    expect(find.widgetWithText(FilledButton, 'Publish'), findsNothing);
    expect(find.textContaining('LinkedIn never confirmed'), findsWidgets);
  });

  testWidgets('DeskScreen invites action rather than showing a blank page', (
    tester,
  ) async {
    final fixture = statusFixture()..['queue'] = <Map<String, dynamic>>[];
    final state = await buildState(fixture);
    await pumpScreen(tester, const DeskScreen(), state);
    expect(find.text('NOTHING ON THE DESK'), findsOneWidget);
    expect(find.text('Ask it to write one now'), findsOneWidget);
  });

  testWidgets('DeskScreen shouts when the scheduler has stopped', (
    tester,
  ) async {
    final fixture = statusFixture();
    fixture['scheduler'] = {
      'lastTickAt': '2026-08-20T02:00:00.000Z',
      'minutesSince': 680,
      'healthy': false,
      'staleAfterMinutes': 16,
    };
    final state = await buildState(fixture);
    await pumpScreen(tester, const DeskScreen(), state);

    await scrollTo(tester, find.textContaining('The scheduler stopped'));
    expect(find.textContaining('The scheduler stopped'), findsOneWidget);
  });

  testWidgets('DeskScreen distinguishes never-started from stopped', (
    tester,
  ) async {
    final fixture = statusFixture();
    fixture['scheduler'] = {
      'minutesSince': null,
      'healthy': false,
      'staleAfterMinutes': 16,
    };
    final state = await buildState(fixture);
    await pumpScreen(tester, const DeskScreen(), state);

    expect(find.textContaining('The scheduler never started'), findsOneWidget);
  });

  testWidgets('DeskScreen says nothing when the scheduler is healthy', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const DeskScreen(), state);
    expect(find.textContaining('scheduler'), findsNothing);
  });

  // --------------------------------------------------------------- archive

  testWidgets('Archive reaches published history and what was passed over', (
    tester,
  ) async {
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
        'reason':
            'Consumer payment integration news, zero engineering substance.',
      },
    ];
    final state = await buildState(fixture);
    await pumpScreen(tester, const ArchiveScreen(), state);

    // Defaults to what went out.
    expect(find.textContaining('already went out to LinkedIn'), findsOneWidget);
    // The only thing still worth doing with a post that is out.
    expect(find.text('Write a follow-up'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.keyboard_arrow_down).first);
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Passed over (').last);
    await tester.pumpAndSettle();
    await scrollTo(
      tester,
      find.text('Google Play adds Venmo as a payment option'),
    );
    expect(
      find.text('Google Play adds Venmo as a payment option'),
      findsOneWidget,
    );
    expect(find.textContaining('zero engineering substance'), findsOneWidget);
  });

  testWidgets('Archive shelves have their own empty states', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const ArchiveScreen(), state);

    expect(find.text('NOTHING PUBLISHED YET'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.keyboard_arrow_down).first);
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Passed over (').last);
    await tester.pumpAndSettle();
    expect(find.text('NOTHING PASSED OVER'), findsOneWidget);
  });

  // A follow-up to something unpublished is a rewrite, and the composer
  // already does that.
  testWidgets('a draft is never offered a follow-up', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const DeskScreen(), state);
    expect(find.text('Write a follow-up'), findsNothing);
  });

  // -------------------------------------------------------------- composer

  testWidgets('ComposerScreen renders without overflow', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const ComposerScreen(), state);
    expect(find.text('Save draft'), findsOneWidget);
    expect(find.text('Publish now'), findsOneWidget);
  });

  testWidgets('the composer picks up a follow-up and consumes it', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    // What AppState.followUp leaves behind once the writer answers.
    state.composeSeed =
        'The follow-up the writer produced, long enough to be a real post.';
    state.composeSeedHashtags = ['DSP'];

    await pumpScreen(tester, const ComposerScreen(), state);
    expect(
      find.textContaining('The follow-up the writer produced'),
      findsOneWidget,
    );
    await scrollTo(tester, find.text('#DSP'));
    expect(find.text('#DSP'), findsOneWidget);

    // Consumed on the way in. Otherwise leaving and coming back would resurrect
    // it over whatever had been typed since.
    expect(state.composeSeed, isNull);
    expect(state.takeComposeSeed(), isNull);
  });

  testWidgets('a follow-up is a NEW post, not an edit of the original', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    // Edit mode is left behind by followUp() deliberately: arriving in a
    // composer still bound to the original would overwrite the post being
    // followed up the moment it was saved.
    state.startEditing(state.status!.queue.first);
    state.editing = null;
    state.composeSeed =
        'A follow-up that must not be bound to the post it follows.';

    await pumpScreen(tester, const ComposerScreen(), state);
    expect(find.textContaining('must not be bound'), findsOneWidget);
    // "Editing p12" is the title shown when a real post is loaded.
    expect(find.textContaining('Editing'), findsNothing);
  });

  testWidgets(
    'ComposerScreen offers rewrite on a NEW post, gated on enough text',
    (tester) async {
      final state = await buildState(statusFixture());
      await pumpScreen(tester, const ComposerScreen(), state);

      final rewrite = find.widgetWithText(
        OutlinedButton,
        'Rewrite in my voice',
      );
      await scrollTo(tester, rewrite);
      expect(tester.widget<OutlinedButton>(rewrite).onPressed, isNull);

      // By key, not by position: scrolling down unmounts the body field, and
      // `find.byType(TextField).first` would then be the hashtag input.
      await tester.scrollUntilVisible(
        find.byKey(const Key('composer-body')),
        -120,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.enterText(
        find.byKey(const Key('composer-body')),
        'A post long enough to be worth rewriting properly.',
      );
      await tester.pumpAndSettle();
      await scrollTo(tester, rewrite);
      expect(tester.widget<OutlinedButton>(rewrite).onPressed, isNotNull);
    },
  );

  testWidgets('ComposerScreen disables sending an empty draft', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const ComposerScreen(), state);

    final save = find.widgetWithText(FilledButton, 'Save draft');
    expect(tester.widget<FilledButton>(save).onPressed, isNull);
  });

  testWidgets('ComposerScreen in edit mode pre-fills the draft and its tags', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    state.editing = state.status!.queue.first;
    await pumpScreen(tester, const ComposerScreen(), state);

    expect(find.text('Editing p12'), findsOneWidget);
    expect(
      find.textContaining('Ableton 12.2 ships MIDI generators'),
      findsWidgets,
    );
    // Sending an empty tag list on every edit silently stripped the tags the
    // writer chose.
    await scrollTo(tester, find.text('#MusicTech'));
    expect(find.text('#MusicTech'), findsOneWidget);
    expect(find.text('#AudioDev'), findsOneWidget);

    await scrollTo(tester, find.text('Save changes'));
    expect(find.text('Save changes'), findsOneWidget);
    expect(find.text('Save draft'), findsNothing);
  });

  testWidgets(
    'ComposerScreen warns when the voice changed under an existing draft',
    (tester) async {
      final state = await buildState(statusFixture());
      state.editing = state.status!.queue.first;
      await pumpScreen(tester, const ComposerScreen(), state);
      expect(find.text('Your voice changed'), findsNothing);

      // Compared against the FULL voice, not style.summary: changing the register
      // or a banned phrase moves the real voice and used to leave this silent.
      final changed = statusFixture();
      (changed['agent'] as Map<String, dynamic>)['style'] = {
        'structure': 'bullets',
        'emoji': 'expressive',
      };
      state.status = AppStatus.fromJson(changed);
      state.notifyListeners();
      await tester.pumpAndSettle();

      expect(find.text('Your voice changed'), findsOneWidget);
      await scrollTo(tester, find.byKey(const Key('composer-body')));
      // And the text somebody typed is still theirs — nothing was regenerated.
      expect(
        find.textContaining('Ableton 12.2 ships MIDI generators'),
        findsWidgets,
      );
    },
  );

  testWidgets(
    'ComposerScreen shows the assembled post before anything is saved',
    (tester) async {
      final state = await buildState(statusFixture());
      state.editing = state.status!.queue.first;
      await pumpScreen(tester, const ComposerScreen(), state);

      await tester.tap(find.text('Save changes'));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));

      // The text box shows the BODY alone; the tags and the truncation are where
      // posts actually go wrong, so nothing leaves without them being seen.
      expect(find.text('THIS IS WHAT GOES OUT'), findsOneWidget);
      expect(find.text('2 TAGS'), findsOneWidget);
      // Assembled with the same fold the reader will meet — which on a post this
      // long means the tags start out below it, exactly as on LinkedIn.
      expect(find.text('see more'), findsWidgets);
      await tester.tap(find.text('see more').last);
      await tester.pump(const Duration(seconds: 1));
      expect(find.textContaining('#MusicTech'), findsWidgets);
    },
  );

  testWidgets('the preview can be backed out of without saving', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    state.editing = state.status!.queue.first;
    await pumpScreen(tester, const ComposerScreen(), state);

    await tester.tap(find.text('Save changes'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
    await tester.tap(find.text('Back'));
    await tester.pumpAndSettle();

    expect(find.text('THIS IS WHAT GOES OUT'), findsNothing);
    expect(find.text('Editing p12'), findsOneWidget);
  });

  // Closing with typed text asks first. The composer is a route now, so
  // leaving it is a real exit rather than a tab switch.
  testWidgets('ComposerScreen asks before dropping typed text', (tester) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const ComposerScreen(), state);

    await tester.enterText(
      find.byKey(const Key('composer-body')),
      'Half a thought.',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();

    expect(find.text('Discard this post?'), findsOneWidget);
    expect(find.text('Keep writing'), findsOneWidget);
  });

  testWidgets('ComposerScreen protects hashtag-only edits when closing', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    state.editing = state.status!.queue.first;
    await pumpScreen(tester, const ComposerScreen(), state);
    await scrollTo(tester, find.text('#MusicTech'));
    final chip = tester.widget<InputChip>(find.byType(InputChip).first);
    chip.onDeleted!();
    await tester.pumpAndSettle();
    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();
    expect(find.text('Leave without saving?'), findsOneWidget);
    expect(
      find.textContaining('hashtags, attachments and schedule'),
      findsOneWidget,
    );
  });

  // ----------------------------------------------------------------- voice

  testWidgets('VoiceScreen renders every control without overflow', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const VoiceScreen(), state);

    await scrollTo(tester, find.text('Fine-tune your writing'));
    await tester.tap(find.text('Fine-tune your writing'));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Paragraphs'));
    expect(find.text('Paragraphs'), findsOneWidget);
    await tester.tap(find.text('Paragraphs').last);
    await tester.pumpAndSettle();
    expect(find.text('Bullets'), findsWidgets);
    await tester.tap(find.text('Bullets').last);
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Emoji'));
    expect(find.text('Emoji'), findsOneWidget);
    await scrollTo(tester, find.text('Opening line'));
    expect(find.text('Opening line'), findsOneWidget);

    await scrollTo(tester, find.byType(RangeSlider));
    expect(find.byType(RangeSlider), findsOneWidget);
    expect(find.text('Hashtags'), findsOneWidget);
  });

  // The commit bar is pinned, so it is reachable without scrolling back past
  // six sections of controls.
  testWidgets('VoiceScreen keeps Save in reach and stages changes locally', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const VoiceScreen(), state);

    expect(find.text('Saved'), findsOneWidget);

    await scrollTo(tester, find.text('Fine-tune your writing'));
    await tester.tap(find.text('Fine-tune your writing'));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Paragraphs'));
    await tester.tap(find.text('Paragraphs').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bullets').last);
    await tester.pumpAndSettle();

    // Without scrolling anywhere: the bar is pinned.
    expect(find.text('Save'), findsOneWidget);
    expect(find.text('UNSAVED'), findsOneWidget);
  });

  testWidgets('VoiceScreen invites writing samples when there are none', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const VoiceScreen(), state);

    await scrollTo(tester, find.text('How you write'));
    expect(find.text('How you write'), findsOneWidget);
    expect(
      find.textContaining('Paste a few posts you are happy with'),
      findsOneWidget,
    );
    await scrollTo(tester, find.textContaining('At least 80 characters'));
    expect(find.textContaining('At least 80 characters'), findsOneWidget);
  });

  testWidgets('VoiceScreen will not add a sample too short to carry a voice', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const VoiceScreen(), state);

    await scrollTo(tester, find.byKey(const Key('voice-sample')));
    await tester.enterText(find.byKey(const Key('voice-sample')), 'Too short.');
    await tester.pumpAndSettle();

    // A short paste teaches a model nothing and the server drops it silently,
    // so the threshold is stated rather than left to look like a broken button.
    await scrollTo(tester, find.textContaining('more characters needed'));
    expect(find.textContaining('more characters needed'), findsOneWidget);
  });

  testWidgets('VoiceScreen lists stored samples and what it learned', (
    tester,
  ) async {
    final fixture = statusFixture();
    (fixture['agent'] as Map<String, dynamic>)['corpus'] = [
      'A sample post long enough to be worth studying, with a measured number '
          'open on the number rather than a wind-up.',
    ];
    (fixture['agent'] as Map<String, dynamic>)['editNotes'] =
        'Cuts the wind-up.';
    final state = await buildState(fixture);
    await pumpScreen(tester, const VoiceScreen(), state);

    await scrollTo(tester, find.textContaining('open on the number'));
    expect(find.textContaining('open on the number'), findsOneWidget);
    expect(find.text('WHAT IT LEARNED FROM YOUR EDITS'), findsOneWidget);
  });

  // ------------------------------------------------------------- timetable

  testWidgets('TimetableScreen renders the timetable without overflow', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const TimetableScreen(), state);

    await scrollTo(tester, find.text('Mon-Fri'));
    expect(find.text('Mon-Fri'), findsOneWidget);
    await scrollTo(tester, find.text('Every day'));
    expect(find.text('Every day'), findsOneWidget);
    await scrollTo(tester, find.text('Add a posting time'));
    expect(find.text('Add a posting time'), findsOneWidget);
  });

  // Two controls that used to share the label "Publish without me" — same
  // words, different reach — which made the screen impossible to reason about.
  testWidgets(
    'TimetableScreen distinguishes a slot switch from the master one',
    (tester) async {
      final state = await buildState(statusFixture());
      await pumpScreen(tester, const TimetableScreen(), state);

      await scrollTo(
        tester,
        find.textContaining('Waits for you to choose Schedule post'),
      );
      expect(
        find.textContaining('Waits for you to choose Schedule post'),
        findsOneWidget,
      );
      expect(
        find.textContaining('whether or not you have read it'),
        findsOneWidget,
      );
      await scrollTo(tester, find.text('Publish without me'));
      expect(find.text('Publish without me'), findsOneWidget);
    },
  );

  testWidgets(
    'TimetableScreen refuses auto-publish without a usable connection',
    (tester) async {
      final state = await buildState(statusFixture(connected: false));
      await pumpScreen(tester, const TimetableScreen(), state);

      await scrollTo(tester, find.text('Publish without me'));
      expect(
        find.textContaining('Connect LinkedIn before enabling'),
        findsOneWidget,
      );
      expect(
        tester
            .widgetList<Switch>(find.byType(Switch))
            .any((s) => s.onChanged == null),
        isTrue,
      );
    },
  );

  testWidgets('TimetableScreen shows both publishing budgets separately', (
    tester,
  ) async {
    final fixture = statusFixture();
    fixture['budget'] = {
      'autoUsed': 1,
      'autoCap': 1,
      'manualUsed': 6,
      'manualCap': 40,
      'linkedinDailyRequests': 150,
    };
    final state = await buildState(fixture);
    await pumpScreen(tester, const TimetableScreen(), state);

    await scrollTo(tester, find.text('Advanced publishing limits'));
    await tester.tap(find.text('Advanced publishing limits'));
    await tester.pumpAndSettle();
    await scrollTo(tester, find.text('Agent published'));
    expect(find.text('1 / 1'), findsOneWidget);
    expect(find.text('You published'), findsOneWidget);
    expect(find.text('6 / 40'), findsOneWidget);
  });

  testWidgets('TimetableScreen refuses to clear the last enabled day', (
    tester,
  ) async {
    final fixture = statusFixture();
    (fixture['slots'] as List).removeLast();
    (fixture['slots'] as List)[0] = {
      ...(fixture['slots'] as List)[0] as Map<String, dynamic>,
      'daysMask': 2, // Monday only
      'daysLabel': 'Mon',
    };
    final state = await buildState(fixture);
    await pumpScreen(tester, const TimetableScreen(), state);

    // An empty mask is a posting time that can never fire, and a schedule that
    // silently never runs is the worst outcome available here.
    await scrollTo(tester, find.text('Days of the week'));
    await tester.tap(find.byType(MultiSelectField).first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(CheckboxListTile, 'Monday'));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Apply'))
          .onPressed,
      isNull,
    );
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(
      find.text('Mon'),
      findsOneWidget,
      reason: 'the mask must be unchanged',
    );
  });

  // ------------------------------------------------------------- settings

  testWidgets('SettingsScreen answers most questions without being opened', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const SettingsScreen(), state);

    // Every row carries a live summary — that is the whole point of collapsing
    // three permanent tabs into one index.
    expect(
      find.text('Someone With A Fairly Long Display Name'),
      findsOneWidget,
    );
    await scrollTo(tester, find.textContaining('Asia/Kolkata'));
    expect(find.textContaining('Asia/Kolkata'), findsOneWidget);
    await scrollTo(tester, find.textContaining('12 days of access left'));
    expect(find.textContaining('12 days of access left'), findsOneWidget);
    await scrollTo(tester, find.text('Sign out'));
    expect(find.text('Sign out'), findsOneWidget);
  });

  testWidgets('SettingsScreen says so when the scheduler has stopped', (
    tester,
  ) async {
    final fixture = statusFixture();
    fixture['scheduler'] = {
      'lastTickAt': '2026-08-20T02:00:00.000Z',
      'minutesSince': 680,
      'healthy': false,
      'staleAfterMinutes': 16,
    };
    final state = await buildState(fixture);
    await pumpScreen(tester, const SettingsScreen(), state);

    await scrollTo(tester, find.textContaining('The scheduler stopped'));
    expect(find.textContaining('The scheduler stopped'), findsOneWidget);
  });

  testWidgets('LinkedInScreen offers a reconnect rather than a dead end', (
    tester,
  ) async {
    final state = await buildState(statusFixture());
    await pumpScreen(tester, const LinkedInScreen(), state);

    // "Connect" when something is already connected reads as though it would
    // replace nothing.
    expect(find.text('Reconnect'), findsOneWidget);
    expect(find.text('Disconnect'), findsOneWidget);
    expect(
      find.textContaining('Access valid for 12 more days'),
      findsOneWidget,
    );
  });

  testWidgets('TopicsScreen will not let the last topic be removed', (
    tester,
  ) async {
    final fixture = statusFixture();
    (fixture['agent'] as Map<String, dynamic>)['categories'] = [
      'emerging-tech',
    ];
    final state = await buildState(fixture);
    await pumpScreen(tester, const TopicsScreen(), state);

    // An agent with no topics discovers nothing and looks exactly like a broken
    // cron, so the last one cannot be turned off.
    await scrollTo(tester, find.textContaining('Keep at least one subject'));
    expect(find.textContaining('Keep at least one subject'), findsOneWidget);
  });
}
