import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:linkdin_mobile/api/client.dart';
import 'package:linkdin_mobile/screens/onboarding_screen.dart';
import 'package:linkdin_mobile/screens/welcome_screen.dart';
import 'package:linkdin_mobile/state/app_state.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'onboarding_test.dart' show setupFixture;
import 'screens_test.dart' show statusFixture;

void main() {
  const browser = MethodChannel('byline/auth_browser');
  const storage = MethodChannel('plugins.it_nomads.com/flutter_secure_storage');
  final secure = <String, String>{};
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    secure.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(storage, (call) async {
          final args = Map<String, dynamic>.from(call.arguments as Map);
          if (call.method == 'write') secure[args['key']] = args['value'];
          if (call.method == 'read') return secure[args['key']];
          if (call.method == 'delete') secure.remove(args['key']);
          return null;
        });
  });
  tearDown(() {
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(storage, null);
    messenger.setMockMethodCallHandler(browser, null);
  });
  http.Response jsonResponse(Object body, [int status = 200]) => http.Response(
    jsonEncode(body),
    status,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );
  Future<void> tap(WidgetTester tester, String text) async {
    final button = find.descendant(
      of: find.byWidgetPredicate((widget) => widget is ButtonStyleButton),
      matching: find.text(text),
    );
    await tester.scrollUntilVisible(
      button,
      180,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  Future<void> mount(WidgetTester tester, ApiClient api, Widget child) async {
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: AppState(api),
        child: MaterialApp(home: child),
      ),
    );
    await tester.pumpAndSettle();
  }

  for (final canOpen in [true, false]) {
    testWidgets('fresh LinkedIn sign-in with browser available=$canOpen', (
      tester,
    ) async {
      final requests = <Map<String, dynamic>>[];
      final launched = <String>[];
      final setup = {
        ...setupFixture(),
        'preview': null,
        'testMode': false,
        'account': {'connected': true},
      };
      final api = await ApiClient.create(
        httpClient: MockClient((r) async {
          if (r.url.path == '/api/native-auth') {
            if (r.method == 'GET') return jsonResponse({'linkedin': true});
            final body = jsonDecode(r.body) as Map<String, dynamic>;
            requests.add(body);
            return jsonResponse(
              body['action'] == 'poll'
                  ? {'token': 'fresh-session'}
                  : {
                      'id': 'fresh-flow',
                      'url':
                          'https://www.linkedin.com/oauth/v2/authorization?state=preserve-me',
                    },
            );
          }
          return jsonResponse(
            r.url.path == '/api/onboarding' ? setup : statusFixture(),
          );
        }),
      );
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(browser, (
        call,
      ) async {
        expect(await api.pendingSignIn(), isNotNull);
        launched.add((call.arguments as Map)['url']);
        return canOpen;
      });
      await mount(tester, api, const WelcomeScreen());
      await tap(tester, 'Continue with LinkedIn');
      expect(launched.single, endsWith('state=preserve-me'));
      if (canOpen) {
        await tester.pump(const Duration(seconds: 2));
        await tester.pumpAndSettle();
        expect(requests, hasLength(2));
        expect(requests.last['verifier'], requests.first['verifier']);
        expect(requests.last['id'], 'fresh-flow');
        expect(secure.values, contains('fresh-session'));
      } else {
        expect(requests, hasLength(1));
        expect(
          find.textContaining('No browser could open sign-in'),
          findsOneWidget,
        );
        expect(
          tester
              .widget<FilledButton>(
                find.widgetWithText(FilledButton, 'Continue with LinkedIn'),
              )
              .onPressed,
          isNotNull,
        );
      }
      expect(await api.pendingSignIn(), isNull);
      await tester.pumpWidget(const SizedBox());
    });
  }

  for (final defaultVoice in [true, false]) {
    testWidgets(
      'fresh setup completes with ${defaultVoice ? 'default voice and notifications skipped' : 'custom voice and notifications unavailable'}',
      (tester) async {
        final writes = <Map<String, dynamic>>[];
        var setup = {
          ...setupFixture(),
          'preview': null,
          'testMode': false,
          'account': {'connected': true},
        };
        var previewAttempts = 0;
        var complete = false;
        final api = await ApiClient.create(
          httpClient: MockClient((r) async {
            final body = jsonDecode(r.body) as Map<String, dynamic>;
            writes.add(body);
            switch (body['action']) {
              case 'save':
                setup = {...setup, 'revision': 2, 'config': body['config']};
              case 'preview':
                if (++previewAttempts == 1) {
                  return jsonResponse({
                    'error': 'generation_failed',
                    'detail': 'Please retry the sample.',
                  }, 503);
                }
                setup = {...setup, 'preview': setupFixture()['preview']};
              case 'accept':
                setup = {...setup, 'accepted_revision': 2};
              case 'finish':
                setup = {
                  ...setup,
                  'completed_at': '2026-11-07T12:00:00Z',
                  'config': {
                    ...setup['config'] as Map,
                    'notifications': body['notifications'],
                  },
                };
            }
            return jsonResponse(setup);
          }),
        );
        tester.view.physicalSize = const Size(360, 740);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await mount(
          tester,
          api,
          OnboardingScreen(initial: setup, onComplete: () => complete = true),
        );
        await tester.enterText(
          find.widgetWithText(TextField, 'Add a topic'),
          'Mobile engineering',
        );
        await tester.tap(find.byIcon(Icons.add));
        await tap(tester, 'Continue');
        if (!defaultVoice) {
          await tester.enterText(
            find.widgetWithText(TextField, 'Describe your voice (optional)'),
            'Warm and practical.',
          );
        }
        await tap(
          tester,
          defaultVoice ? 'Use default voice' : 'Show my sample',
        );
        expect(find.text('Your first sample'), findsOneWidget);
        expect(find.text('This sounds like me'), findsNothing);
        await tap(tester, 'Generate sample');
        await tap(tester, 'This sounds like me');
        expect(find.text('When should we bring your post?'), findsOneWidget);
        await tap(tester, 'Continue');
        await tap(tester, defaultVoice ? 'Not now' : 'Enable notifications');
        expect(find.text('You’re ready'), findsOneWidget);
        await tap(tester, 'Open ByLine');
        expect(complete, isTrue);
        expect(writes.map((b) => b['action']), [
          'save',
          'preview',
          'preview',
          'accept',
          'finish',
        ]);
        final config = writes.first['config'] as Map;
        expect(config['topics'], contains('Mobile engineering'));
        expect(config['voiceNotes'], defaultVoice ? '' : 'Warm and practical.');
        expect(writes.skip(1).every((b) => b['revision'] == 2), isTrue);
        expect(writes.last['time'], '09:00');
        expect(writes.last['timezone'], 'Asia/Kolkata');
        expect(
          writes.last['notifications'],
          defaultVoice ? 'later' : 'unavailable',
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  testWidgets(
    'LinkedIn connection survives a network interruption and refreshes on resume without overlapping requests',
    (tester) async {
      final setup = {...setupFixture(), 'preview': null, 'testMode': false};
      final response = Completer<http.Response>();
      var checks = 0;
      var launches = 0;
      final api = await ApiClient.create(
        httpClient: MockClient((r) async {
          if (r.url.path == '/api/linkedin/connect') {
            return jsonResponse({
              'url':
                  'https://www.linkedin.com/oauth/v2/authorization?state=connect',
            });
          }
          checks++;
          if (checks <= 2) throw http.ClientException('Network suspended');
          return response.future;
        }),
      );
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(browser, (
        _,
      ) async {
        launches++;
        return true;
      });
      await mount(
        tester,
        api,
        OnboardingScreen(initial: setup, onComplete: () {}),
      );
      await tap(tester, 'Connect LinkedIn');
      await tester.pump(const Duration(seconds: 3));
      expect(checks, 2); // The API retries one failed GET before yielding.
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      await tester.pump(const Duration(seconds: 6));
      expect(checks, 3);
      response.complete(
        jsonResponse({
          ...setup,
          'account': {'connected': true, 'memberName': 'New member'},
        }),
      );
      await tester.pumpAndSettle();
      expect(find.text('Connected as New member'), findsOneWidget);
      await tap(tester, 'Continue');
      expect(find.text('What do you talk about?'), findsOneWidget);
      await tester.pump(const Duration(seconds: 6));
      expect(checks, 3);
      expect(launches, 1);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
