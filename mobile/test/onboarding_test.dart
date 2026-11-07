import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:linkdin_mobile/main.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:linkdin_mobile/api/client.dart';
import 'package:linkdin_mobile/api/models.dart';
import 'package:linkdin_mobile/state/app_state.dart';
import 'package:linkdin_mobile/screens/onboarding_screen.dart';
import 'package:linkdin_mobile/screens/today_screen.dart';
import 'screens_test.dart' show statusFixture;

Map<String, dynamic> setupFixture() => {
  'revision': 1,
  'testMode': true,
  'account': {'connected': false},
  'accepted_revision': null,
  'config': {
    'industry': 'tech',
    'topics': ['AI', 'Software', 'Products'],
    'voice': 'professional',
    'samples': [],
    'time': '09:00',
    'timezone': 'Asia/Kolkata',
  },
  'voices': ['professional', 'conversational', 'storyteller', 'punchy'],
  'industries': [
    {
      'id': 'tech',
      'label': 'Technology',
      'topics': ['AI', 'Software', 'Products'],
    },
  ],
  'preview': {
    'text':
        'A source-backed post to review before you activate your daily schedule.',
    'sources': <String>[],
  },
};
void main() {
  for (final interruption in ['none', 'connection', 'server']) {
    testWidgets(
      'sign-in resumes after $interruption without opening consent again',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final secure = <String, String>{};
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
          (call) async {
            final args = Map<String, dynamic>.from(call.arguments as Map);
            if (call.method == 'write') {
              secure[args['key'] as String] = args['value'] as String;
            }
            if (call.method == 'read') return secure[args['key']];
            if (call.method == 'delete') secure.remove(args['key']);
            return null;
          },
        );
        final requests = <http.Request>[];
        var polls = 0;
        final fixture = statusFixture()..['queue'] = [];
        final transport = MockClient((r) async {
          requests.add(r);
          if (r.method == 'POST' &&
              r.url.path == '/api/native-auth' &&
              ++polls == 1) {
            if (interruption == 'connection') {
              throw http.ClientException('Network suspended');
            }
            if (interruption == 'server') {
              return http.Response('{"error":"unavailable"}', 503);
            }
          }
          final dynamic value = r.url.path == '/api/native-auth'
              ? (r.method == 'GET'
                    ? {'linkedin': true}
                    : {'token': 'recovered-session'})
              : r.url.path == '/api/onboarding'
              ? {...setupFixture(), 'completed_at': '2026-09-06T12:00:00Z'}
              : fixture;
          return http.Response(
            jsonEncode(value),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        });
        final before = await ApiClient.create(httpClient: transport);
        await before.savePendingSignIn({
          'id': 'flow-id',
          'provider': 'linkedin',
          'verifier': 'saved-verifier',
          'url': 'https://www.linkedin.com/oauth/v2/authorization',
          'startedAt': DateTime.now().millisecondsSinceEpoch,
        });
        final restored = await ApiClient.create(httpClient: transport);
        final state = AppState(restored);
        await state.bootstrap();
        await tester.pumpWidget(
          ChangeNotifierProvider.value(value: state, child: const LinkdInApp()),
        );
        for (var i = 0; i < 8; i++) {
          await tester.pump(const Duration(seconds: 1));
        }
        await tester.pumpAndSettle();
        expect(find.text('Your writing day'), findsOneWidget);
        final exchange = requests
            .where(
              (r) => r.method == 'POST' && r.url.path == '/api/native-auth',
            )
            .toList();
        expect(exchange, hasLength(interruption == 'none' ? 1 : 2));
        expect(
          exchange.every((r) => jsonDecode(r.body)['action'] == 'poll'),
          isTrue,
        );
        expect(await restored.pendingSignIn(), isNull);
      },
    );
  }
  testWidgets('completed setup opens the daily screen without restarting', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
      (_) async => null,
    );
    var setup = {...setupFixture(), 'accepted_revision': 1};
    final status = statusFixture();
    status['queue'] = [];
    final api = await ApiClient.create(
      httpClient: MockClient((r) async {
        if (r.url.path == '/api/onboarding' && r.method == 'POST') {
          final body = jsonDecode(r.body) as Map;
          if (body['action'] == 'finish') {
            setup = {...setup, 'completed_at': '2026-09-06T12:00:00Z'};
          }
        }
        return http.Response(
          jsonEncode(r.url.path == '/api/onboarding' ? setup : status),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    await api.saveNativeSession('test-session');
    final state = AppState(api);
    await state.bootstrap();
    await tester.pumpWidget(
      ChangeNotifierProvider.value(value: state, child: const LinkdInApp()),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Continue'),
      150,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Not now'));
    await tester.pumpAndSettle();
    expect(find.text('You’re ready'), findsOneWidget);
    await tester.tap(find.text('Open ByLine'));
    await tester.pumpAndSettle();
    expect(find.text('Your writing day'), findsOneWidget);
    expect(find.text('You’re ready'), findsNothing);
  });
  testWidgets(
    'sample acceptance persists before the time step, at phone width',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final calls = <Map<String, dynamic>>[];
      final api = await ApiClient.create(
        httpClient: MockClient((r) async {
          calls.add(jsonDecode(r.body) as Map<String, dynamic>);
          return http.Response(
            jsonEncode({...setupFixture(), 'accepted_revision': 1}),
            200,
          );
        }),
      );
      final state = AppState(api);
      tester.view.physicalSize = const Size(360, 740);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: state,
          child: MaterialApp(
            home: OnboardingScreen(initial: setupFixture(), onComplete: () {}),
          ),
        ),
      );
      expect(find.text('This sounds like me'), findsOneWidget);
      await tester.scrollUntilVisible(
        find.text('This sounds like me'),
        150,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('This sounds like me'));
      await tester.pumpAndSettle();
      expect(calls.single['action'], 'accept');
      expect(calls.single['revision'], 1);
      expect(find.text('When should we bring your post?'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('failed acceptance keeps the reviewed sample visible', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final api = await ApiClient.create(
      httpClient: MockClient(
        (_) async => http.Response(
          jsonEncode({'error': 'setup_failed', 'detail': 'Please retry.'}),
          400,
        ),
      ),
    );
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: AppState(api),
        child: MaterialApp(
          home: OnboardingScreen(initial: setupFixture(), onComplete: () {}),
        ),
      ),
    );
    await tester.scrollUntilVisible(
      find.text('This sounds like me'),
      150,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('This sounds like me'));
    await tester.pumpAndSettle();
    expect(find.text('Your first sample'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.textContaining('Please retry.'),
      -150,
      scrollable: find.byType(Scrollable).first,
    );
    expect(find.textContaining('Please retry.'), findsOneWidget);
  });
  testWidgets('daily publishing confirms and uses the existing publish route', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final fixture = statusFixture();
    for (final p in fixture['queue'] as List) {
      p['scheduledFor'] = null;
    }
    final calls = <http.Request>[];
    final api = await ApiClient.create(
      httpClient: MockClient((r) async {
        calls.add(r);
        return http.Response(
          jsonEncode(
            r.url.path == '/api/review-delivery'
                ? {
                    'entries': [
                      {
                        'time': '09:00',
                        'post': (fixture['queue'] as List).first,
                      },
                    ],
                  }
                : r.method == 'GET'
                ? fixture
                : {'ok': true},
          ),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
      (_) async => null,
    );
    await api.saveNativeSession('test-session');
    final state = AppState(api)..status = AppStatus.fromJson(fixture);
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: state,
        child: const MaterialApp(home: Scaffold(body: TodayScreen())),
      ),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.text('Publish now'),
      150,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Publish now'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);
    expect(calls.where((r) => r.method == 'PATCH'), isEmpty);
    await tester.tap(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.text('Publish now'),
      ),
    );
    await tester.pumpAndSettle();
    final writes = calls.where((r) => r.method == 'PATCH').toList();
    expect(writes.length, 1);
    expect(jsonDecode(writes.single.body)['action'], 'publish');
    expect(find.byType(AlertDialog), findsNothing);
  });
}
