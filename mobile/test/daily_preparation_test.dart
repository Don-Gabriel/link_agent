import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:linkdin_mobile/api/client.dart';
import 'package:linkdin_mobile/api/models.dart';
import 'package:linkdin_mobile/state/app_state.dart';
import 'package:linkdin_mobile/theme.dart';
import 'package:linkdin_mobile/screens/today_screen.dart';
import 'package:linkdin_mobile/screens/home_screen.dart';
import 'package:linkdin_mobile/widgets/form_select.dart';
import 'screens_test.dart' show statusFixture;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
          (_) async => null,
        );
  });
  for (final outcome in [
    'draft',
    'published',
    'rejected',
    'approved',
    'failure',
  ]) {
    testWidgets('preparation handles $outcome through the timetable API', (
      tester,
    ) async {
      SharedPreferences.setMockInitialValues({});
      final fixture = statusFixture();
      final post = {
        ...(fixture['queue'] as List).first as Map<String, dynamic>,
        'status': outcome,
        'scheduledFor': null,
      };
      fixture['queue'] = [];
      var prepares = 0;
      final api = await ApiClient.create(
        httpClient: MockClient((r) async {
          if (r.method == 'POST') {
            expect(r.url.path, '/api/review-delivery');
            expect(jsonDecode(r.body)['action'], 'generate');
            prepares++;
            return http.Response(
              jsonEncode(
                outcome == 'failure' ? {'error': 'unavailable'} : {'ok': true},
              ),
              outcome == 'failure' ? 503 : 200,
            );
          }
          final ready = prepares > 0 && outcome != 'failure';
          return http.Response(
            jsonEncode(
              r.url.path == '/api/review-delivery'
                  ? {
                      'timezone': 'UTC',
                      'entries': [
                        {
                          'slotId': 's1',
                          'time': '09:00',
                          'canPrepare': !ready,
                          'progress': {'state': 'idle'},
                          'post': ready ? post : null,
                        },
                      ],
                    }
                  : fixture,
            ),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      await api.saveNativeSession('test-session');
      final state = AppState(api)..status = AppStatus.fromJson(fixture);
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: state,
          child: MaterialApp(
            theme: buildTheme(),
            home: const Scaffold(body: TodayScreen()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Prepare today’s posts'));
      await tester.pumpAndSettle();
      expect(prepares, 1);
      if (outcome == 'failure') {
        expect(find.textContaining('temporarily unavailable'), findsOneWidget);
        expect(find.text('Prepare today’s posts'), findsOneWidget);
      } else if (outcome == 'rejected') {
        expect(
          find.textContaining('Ableton 12.2 ships MIDI generators'),
          findsNothing,
        );
        expect(find.textContaining('Planned post'), findsNothing);
      } else {
        expect(find.text('Prepare today’s posts'), findsNothing);
        await tester.scrollUntilVisible(
          find.textContaining('Ableton 12.2 ships MIDI generators'),
          180,
          scrollable: find.byType(Scrollable).first,
        );
        expect(
          find.textContaining('Ableton 12.2 ships MIDI generators'),
          findsWidgets,
        );
      }
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    });
  }

  for (final scheduled in [true, false]) {
    testWidgets(
      'discard hides ${scheduled ? "scheduled" : "manual"} Home draft even with stale polling and failed refresh',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        final fixture = statusFixture();
        final post = Map<String, dynamic>.from(
          (fixture['queue'] as List).first as Map,
        );
        var deleted = false;
        final api = await ApiClient.create(
          httpClient: MockClient((r) async {
            if (r.method == 'PATCH') {
              deleted = true;
              return http.Response('{"ok":true}', 200);
            }
            if (r.url.path == '/api/status' && deleted) {
              return http.Response('{"error":"refresh failed"}', 400);
            }
            return http.Response(
              jsonEncode(
                r.url.path == '/api/review-delivery'
                    ? {
                        'timezone': 'UTC',
                        'entries': scheduled
                            ? [
                                {
                                  'slotId': 's1',
                                  'time': '09:00',
                                  'post': post,
                                  'canPrepare': false,
                                  'progress': {
                                    'state': 'ready',
                                    'completed': 4,
                                  },
                                },
                              ]
                            : [],
                        'posts': scheduled ? [] : [post],
                      }
                    : fixture,
              ),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }),
        );
        await api.saveNativeSession('test-session');
        final state = AppState(api)..status = AppStatus.fromJson(fixture);
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: state,
            child: MaterialApp(
              theme: buildTheme(),
              home: const Scaffold(body: TodayScreen()),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final card = find.byKey(ValueKey('home-${post['seq']}'));
        await tester.scrollUntilVisible(
          card,
          180,
          scrollable: find.byType(Scrollable).first,
        );
        expect(card, findsOneWidget);
        await state.discard(post['seq'] as int);
        await tester.pumpAndSettle();
        expect(card, findsNothing);
        expect(state.status!.queue.any((p) => p.seq == post['seq']), isFalse);
        expect(find.textContaining('Planned post'), findsNothing);
        expect(find.textContaining('Preparation paused'), findsNothing);
        await tester.pump(const Duration(seconds: 16));
        await tester.pumpAndSettle();
        expect(card, findsNothing);
        await tester.pumpWidget(const SizedBox());
        state.dispose();
      },
    );
  }

  testWidgets(
    'multi-select searches, cancels safely and applies checked choices',
    (tester) async {
      List<String> selected = ['ai'];
      await tester.pumpWidget(
        MaterialApp(
          theme: buildTheme(),
          home: Scaffold(
            body: StatefulBuilder(
              builder: (context, update) => MultiSelectField(
                label: 'Topics',
                options: const {
                  'ai': 'Artificial intelligence',
                  'design': 'Product design',
                },
                values: selected,
                onChanged: (v) => update(() => selected = v),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byType(MultiSelectField));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'design');
      await tester.pumpAndSettle();
      expect(
        find.widgetWithText(CheckboxListTile, 'Artificial intelligence'),
        findsNothing,
      );
      await tester.tap(find.widgetWithText(CheckboxListTile, 'Product design'));
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(selected, ['ai']);
      await tester.tap(find.byType(MultiSelectField));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(CheckboxListTile, 'Product design'));
      await tester.tap(find.text('Apply'));
      await tester.pumpAndSettle();
      expect(selected, ['ai', 'design']);
    },
  );

  testWidgets('desktop dropdown works with keyboard arrows and Enter', (
    tester,
  ) async {
    String selected = 'a';
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: Scaffold(
          body: FormSelect<String>(
            value: selected,
            label: 'Tone',
            options: const {'a': 'Professional', 'b': 'Conversational'},
            onChanged: (v) => selected = v,
          ),
        ),
      ),
    );
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowDown);
    await tester.sendKeyEvent(LogicalKeyboardKey.enter);
    await tester.pumpAndSettle();
    expect(selected, 'b');
  });

  testWidgets('draft badge belongs to My posts on phone and desktop', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final fixture = statusFixture();
    final api = await ApiClient.create(
      httpClient: MockClient(
        (_) async => http.Response(jsonEncode(fixture), 200),
      ),
    );
    final state = AppState(api)..status = AppStatus.fromJson(fixture);
    addTearDown(state.dispose);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: state,
        child: MaterialApp(theme: buildTheme(), home: const HomeScreen()),
      ),
    );
    await tester.pumpAndSettle();
    final home = find.ancestor(
      of: find.text('Home'),
      matching: find.byType(NavigationDestination),
    );
    final posts = find.ancestor(
      of: find.text('My posts'),
      matching: find.byType(NavigationDestination),
    );
    expect(
      find.descendant(of: home, matching: find.byType(Badge)),
      findsNothing,
    );
    final badge = tester.widget<Badge>(
      find.descendant(of: posts, matching: find.byType(Badge)),
    );
    expect(badge.isLabelVisible, true);
    expect((badge.label as Text).data, '${state.onTheDesk}');
    tester.view.physicalSize = const Size(1280, 900);
    await tester.pumpAndSettle();
    final desktopPosts = find.ancestor(
      of: find.text('My posts').first,
      matching: find.byType(TextButton),
    );
    expect(
      find.descendant(of: desktopPosts, matching: find.byType(Badge)),
      findsOneWidget,
    );
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('selected navigation survives desktop-to-phone resize', (
    tester,
  ) async {
    SharedPreferences.setMockInitialValues({});
    final fixture = statusFixture();
    final api = await ApiClient.create(
      httpClient: MockClient(
        (_) async => http.Response(jsonEncode(fixture), 200),
      ),
    );
    final state = AppState(api)..status = AppStatus.fromJson(fixture);
    tester.view.physicalSize = const Size(1280, 900);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: state,
        child: MaterialApp(
          theme: buildTheme(),
          home: const HomeScreen(initialIndex: 2),
        ),
      ),
    );
    await tester.pumpAndSettle();
    tester.view.physicalSize = const Size(390, 844);
    await tester.pumpAndSettle();
    expect(
      tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
      2,
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
    state.dispose();
  });
}
