import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:linkdin_mobile/api/client.dart';
import 'package:linkdin_mobile/state/app_state.dart';
import 'package:linkdin_mobile/screens/home_screen.dart';
import 'screens_test.dart' show statusFixture;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'a suspended connection retries reads but never repeats a mutation',
    () async {
      SharedPreferences.setMockInitialValues({});
      var gets = 0, posts = 0;
      final api = await ApiClient.create(
        httpClient: MockClient((r) async {
          if (r.method == 'POST') {
            posts++;
            throw http.ClientException('connection closed');
          }
          if (++gets == 1) throw http.ClientException('stale pooled socket');
          return http.Response('{"ok":true}', 200);
        }),
      );
      expect(await api.get('/api/status'), {'ok': true});
      expect(gets, 2);
      await expectLater(
        api.post('/api/posts/1', {'action': 'publish'}),
        throwsA(isA<ApiException>()),
      );
      expect(posts, 1);
    },
  );

  test('an unauthorized read is not retried', () async {
    SharedPreferences.setMockInitialValues({});
    var calls = 0;
    final api = await ApiClient.create(
      httpClient: MockClient((r) async {
        calls++;
        return http.Response('{"error":"unauthorized"}', 401);
      }),
    );
    await expectLater(api.get('/api/status'), throwsA(isA<ApiException>()));
    expect(calls, 1);
  });

  testWidgets(
    'returning to My posts clears stale connection errors and shows job failure',
    (tester) async {
      SharedPreferences.setMockInitialValues({
        'session_cookie': 'lc_session=test',
      });
      final fixture = statusFixture()..['queue'] = [];
      fixture['generation'] = {
        'id': 'job',
        'state': 'working',
        'stage': 'writing',
      };
      var reads = 0;
      final api = await ApiClient.create(
        httpClient: MockClient((r) async {
          reads++;
          return http.Response(
            jsonEncode(fixture),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      final state = AppState(api);
      await state.bootstrap();
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: state,
          child: const MaterialApp(home: HomeScreen(initialIndex: 1)),
        ),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('Writing in your voice'), 180,
          scrollable: find.byType(Scrollable).first);
      expect(find.text('Writing in your voice'), findsOneWidget);
      expect(find.text('Ask it to write one now'), findsNothing);
      final before = reads;
      tester.binding.handleAppLifecycleStateChanged(
        AppLifecycleState.paused,
      );
      state.error = 'We could not connect to ByLine.';
      fixture['generation'] = {
        'id': 'job',
        'state': 'failed',
        'error': 'The draft needs another pass.',
      };
      tester.binding.handleAppLifecycleStateChanged(
        AppLifecycleState.resumed,
      );
      await tester.pumpAndSettle();
      expect(reads, greaterThan(before));
      expect(state.error, isNull);
      expect(find.text('Draft preparation could not finish'), findsOneWidget);
      expect(find.text('The draft needs another pass.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
