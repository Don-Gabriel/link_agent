import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:linkdin_mobile/api/client.dart';
import 'package:linkdin_mobile/state/app_state.dart';
import 'package:linkdin_mobile/screens/gemini_screen.dart';

const fixture = {
  'connected': false,
  'model': 'gemini-3.5-flash-lite',
  'models': ['gemini-3.5-flash-lite'],
};
void main() {
  testWidgets(
    'key test requires acknowledgement, clears input and stores only status',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final requests = <http.Request>[];
      final api = await ApiClient.create(
        httpClient: MockClient((r) async {
          requests.add(r);
          return http.Response(
            jsonEncode({...fixture, 'connected': true, 'keyHint': '0001'}),
            200,
          );
        }),
      );
      final state = AppState(api);
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: state,
          child: const MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: GeminiConnectionForm(initial: fixture),
              ),
            ),
          ),
        ),
      );
      expect(
        tester.widget<TextField>(find.byType(TextField)).obscureText,
        true,
      );
      await tester.enterText(
        find.byType(TextField),
        'fake-test-key-000000000001',
      );
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Test and save connection'),
            )
            .onPressed,
        isNull,
      );
      await tester.ensureVisible(find.byType(CheckboxListTile));
      await tester.tap(find.byType(CheckboxListTile));
      await tester.pump();
      await tester.ensureVisible(find.text('Test and save connection'));
      await tester.tap(find.text('Test and save connection'));
      await tester.pumpAndSettle();
      expect(requests.length, 1);
      expect(requests.single.url.path, '/api/ai');
      final body = jsonDecode(requests.single.body);
      expect(body['apiKey'], 'fake-test-key-000000000001');
      expect(body['acceptedTerms'], true);
      expect(
        tester.widget<TextField>(find.byType(TextField)).controller!.text,
        isEmpty,
      );
      expect(state.aiConnection?['keyHint'], '0001');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getKeys(), isEmpty);
      expect(
        find.textContaining('Connected · key ending 0001'),
        findsOneWidget,
      );
      state.dispose();
    },
  );
  testWidgets(
    'rejected replacement preserves the connected account and shows safe error',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final api = await ApiClient.create(
        httpClient: MockClient(
          (r) async => http.Response(
            jsonEncode({
              'error': 'ai_key_invalid',
              'detail':
                  'Your Gemini key was rejected. Replace it in Settings → Gemini.',
            }),
            400,
          ),
        ),
      );
      final state = AppState(api);
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: state,
          child: const MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: GeminiConnectionForm(
                  initial: {
                    'model': 'gemini-3.5-flash-lite',
                    'models': ['gemini-3.5-flash-lite'],
                    'connected': true,
                    'keyHint': 'old1',
                  },
                ),
              ),
            ),
          ),
        ),
      );
      await tester.enterText(
        find.byType(TextField),
        'fake-replacement-000000000002',
      );
      await tester.ensureVisible(find.byType(CheckboxListTile));
      await tester.tap(find.byType(CheckboxListTile));
      await tester.pump();
      await tester.ensureVisible(find.text('Test and save connection'));
      await tester.tap(find.text('Test and save connection'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Your Gemini key was rejected'),
        findsOneWidget,
      );
      expect(
        find.textContaining('Connected · key ending old1'),
        findsOneWidget,
      );
      state.dispose();
    },
  );
}
