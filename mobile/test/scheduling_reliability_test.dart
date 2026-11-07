import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:linkdin_mobile/api/client.dart';
import 'package:linkdin_mobile/api/models.dart';
import 'package:linkdin_mobile/state/app_state.dart';
import 'package:linkdin_mobile/screens/draft_commands.dart';
import 'package:linkdin_mobile/screens/onboarding_screen.dart';
import 'package:linkdin_mobile/timezones.dart';
import 'package:linkdin_mobile/widgets/draft_card.dart';
import 'package:linkdin_mobile/widgets/preparation_progress.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'screens_test.dart' show statusFixture;
import 'onboarding_test.dart' show setupFixture;

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));
  testWidgets(
    'setup retains a sample with clear preference notes and an explicit choice',
    (tester) async {
      final setup = setupFixture();
      (setup['preview'] as Map)['reviewNotes'] = [
        'This draft has 190 words; your preference is 200–300.',
      ];
      final api = await ApiClient.create(
        httpClient: MockClient((_) async => http.Response('{}', 200)),
      );
      final state = AppState(api);
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: state,
          child: MaterialApp(
            home: OnboardingScreen(initial: setup, onComplete: () {}),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Sample saved for your review.'),
        findsOneWidget,
      );
      await tester.scrollUntilVisible(
        find.text('Regenerate'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      expect(find.text('This sounds like me'), findsOneWidget);
      expect(find.text('Regenerate'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    },
  );
  test(
    'one-off send times use the selected zone and match server DST policy',
    () {
      final examples = [
        ['Asia/Kolkata', 9, 0, '2026-11-07T00:00:00Z', '2026-11-07T03:30:00Z'],
        [
          'Asia/Kathmandu',
          9,
          0,
          '2026-11-07T00:00:00Z',
          '2026-11-07T03:15:00Z',
        ],
        [
          'Pacific/Chatham',
          9,
          0,
          '2026-07-14T18:00:00Z',
          '2026-07-14T20:15:00Z',
        ],
        [
          'America/New_York',
          9,
          0,
          '2026-03-08T06:00:00Z',
          '2026-03-08T13:00:00Z',
        ],
        [
          'America/New_York',
          2,
          30,
          '2026-03-08T06:00:00Z',
          '2026-03-08T07:30:00Z',
        ],
        [
          'America/New_York',
          1,
          30,
          '2026-11-01T04:00:00Z',
          '2026-11-01T05:30:00Z',
        ],
        [
          'America/New_York',
          1,
          30,
          '2026-11-01T05:31:00Z',
          '2026-11-02T06:30:00Z',
        ],
        [
          'Australia/Lord_Howe',
          2,
          15,
          '2026-10-03T14:00:00Z',
          '2026-10-03T15:45:00Z',
        ],
      ];
      for (final e in examples) {
        expect(
          Timezones.nextTime(
            e[0] as String,
            e[1] as int,
            e[2] as int,
            now: DateTime.parse(e[3] as String),
          ),
          DateTime.parse(e[4] as String),
          reason: e.toString(),
        );
      }
    },
  );
  test(
    'send labels use the selected local date instead of the device date',
    () {
      expect(
        whenLabel(
          DateTime.parse('2026-11-07T15:30:00Z'),
          timezone: 'Asia/Tokyo',
          now: DateTime.parse('2026-11-07T14:00:00Z'),
        ),
        'tomorrow 00:30 · Asia/Tokyo',
      );
    },
  );
  testWidgets(
    'the one-post picker shows the selected zone and submits a UTC instant',
    (tester) async {
      final status = statusFixture();
      (status['agent'] as Map)['timezone'] = 'America/New_York';
      final writes = <Map>[];
      final api = await ApiClient.create(
        httpClient: MockClient((r) async {
          if (r.method == 'PATCH') writes.add(jsonDecode(r.body) as Map);
          return http.Response(
            jsonEncode(status),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      final state = AppState(api);
      await state.refresh();
      final raw = {
        ...(status['queue'] as List).first as Map<String, dynamic>,
        'scheduledFor': '2030-01-01T14:00:00Z',
      };
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: state,
          child: MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (context) => TextButton(
                  onPressed: () => pickSendTime(context, Post.fromJson(raw)),
                  child: const Text('Choose'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Choose'));
      await tester.pumpAndSettle();
      expect(find.text('SEND TIME · America/New_York'), findsOneWidget);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      final saved = DateTime.parse(writes.single['scheduledFor'] as String);
      expect(saved.isUtc, true);
      expect(saved.isAfter(DateTime.now()), true);
      expect(Timezones.at(saved, 'America/New_York').hour, 9);
      expect(Timezones.at(saved, 'America/New_York').minute, 0);
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    },
  );
  testWidgets(
    'retained drafts show their mismatch and remain readable on a small phone',
    (tester) async {
      tester.view.physicalSize = const Size(360, 740);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final post = Post.fromJson({
        'id': 'p1',
        'seq': 1,
        'text': 'This source-backed draft is saved for review.',
        'reviewNotes': [
          'This draft has 190 words; your preference is 200–300.',
        ],
      });
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: DraftCard(post: post, actions: const DraftActions()),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Draft saved · review needed'), findsOneWidget);
      expect(find.textContaining('200–300'), findsOneWidget);
      expect(find.textContaining('source-backed draft'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'an expired preparation does not claim another automatic attempt is coming',
    (tester) async {
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: PreparationProgress(
              progress: {
                'state': 'attention',
                'stage': 'writing',
                'completed': 2,
                'message': 'Tap Prepare this post to try again.',
              },
            ),
          ),
        ),
      );
      expect(find.text('Preparation needs attention'), findsOneWidget);
      expect(find.text('Waiting for another attempt'), findsNothing);
    },
  );
  test(
    'a delayed settings response cannot replace a different account',
    () async {
      final delayed = Completer<http.Response>();
      var status = statusFixture();
      final api = await ApiClient.create(
        httpClient: MockClient(
          (r) async => r.method == 'PATCH'
              ? delayed.future
              : http.Response(
                  jsonEncode(status),
                  200,
                  headers: {'content-type': 'application/json; charset=utf-8'},
                ),
        ),
      );
      final state = AppState(api);
      await state.refresh();
      final pending = state.mutateAgent(
        () => api.patch('/api/settings', {'paused': true}),
      );
      status = statusFixture();
      (status['agent'] as Map)['agentId'] = 'different-account';
      await state.refresh();
      delayed.complete(
        http.Response(jsonEncode({'agent': statusFixture()['agent']}), 200),
      );
      expect(await pending, contains('account changed'));
      expect(state.agent!.agentId, 'different-account');
      state.dispose();
    },
  );
}
