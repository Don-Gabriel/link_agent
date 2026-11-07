import 'dart:async';
import 'dart:convert';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:linkdin_mobile/api/client.dart';
import 'package:linkdin_mobile/api/models.dart';
import 'package:linkdin_mobile/push.dart';
import 'package:linkdin_mobile/screens/archive_screen.dart';
import 'package:linkdin_mobile/screens/desk_screen.dart';
import 'package:linkdin_mobile/screens/draft_commands.dart';
import 'package:linkdin_mobile/screens/home_screen.dart';
import 'package:linkdin_mobile/screens/settings_screen.dart';
import 'package:linkdin_mobile/screens/today_screen.dart';
import 'package:linkdin_mobile/state/app_state.dart';
import 'package:linkdin_mobile/widgets/form_select.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'screens_test.dart' show statusFixture;

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
          (_) async => null,
        );
  });
  Future<AppState> stateFor({
    bool native = false,
    Future<http.Response> Function(http.Request)? respond,
  }) async {
    final fixture = statusFixture();
    final api = await ApiClient.create(
      httpClient: MockClient(
        respond ??
            (r) async => http.Response(
              jsonEncode(
                r.url.path == '/api/review-delivery'
                    ? {
                        'entries': [
                          for (var i = 0; i < 5; i++)
                            {
                              'slotId': 's$i',
                              'time': '09:0$i',
                              'canPrepare': false,
                              'post': (fixture['queue'] as List).first,
                            },
                        ],
                      }
                    : fixture,
              ),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            ),
      ),
    );
    if (native) await api.saveNativeSession('test-session');
    return AppState(api)..status = AppStatus.fromJson(fixture);
  }

  Future<void> mount(WidgetTester tester, AppState state, Widget child) async {
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: state,
        child: MaterialApp(home: child),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> dismissAfterTimeout(WidgetTester tester) async {
    await tester.pump(const Duration(seconds: 5));
    expect(find.byType(SnackBar), findsOneWidget);
    await tester.pump(const Duration(seconds: 2));
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byType(SnackBar), findsNothing);
  }

  for (final width in [390.0, 1100.0]) {
    for (final native in [false, true]) {
      testWidgets(
        'navigation resets scroll at width $width native=$native and preserves the archive view',
        (tester) async {
          tester.view.physicalSize = Size(width, 640);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          final state = await stateFor(native: native);
          addTearDown(state.dispose);
          await mount(tester, state, const HomeScreen());
          Future<void> select(String label) async {
            final button = width < 860
                ? find.descendant(
                    of: find.byType(NavigationBar),
                    matching: find.text(label),
                  )
                : find.widgetWithText(TextButton, label);
            await tester.tap(button);
            await tester.pumpAndSettle();
          }

          ScrollController controller(String label) => switch (label) {
            'Home' =>
              native
                  ? tester
                        .widget<TodayScreen>(find.byType(TodayScreen))
                        .scrollController!
                  : tester
                        .widget<DeskScreen>(find.byType(DeskScreen))
                        .scrollController!,
            'My posts' =>
              tester
                  .widget<DeskScreen>(find.byType(DeskScreen))
                  .scrollController!,
            _ =>
              tester
                  .widget<SettingsScreen>(find.byType(SettingsScreen))
                  .scrollController!,
          };
          for (final label in ['Home', 'My posts', 'Me']) {
            await select(label);
            final scroll = controller(label);
            expect(scroll.position.maxScrollExtent, greaterThan(100));
            scroll.jumpTo(100);
            await tester.pump();
            await select(label); // Reselecting the active tab resets too.
            expect(scroll.offset, 0);
            scroll.jumpTo(100);
            await select(label == 'Home' ? 'Me' : 'Home');
            await select(label);
            expect(scroll.offset, 0);
          }
          await select('My posts');
          tester
              .widget<FormSelect<String>>(find.byType(FormSelect<String>).first)
              .onChanged!('history');
          await tester.pumpAndSettle();
          final archive = tester.state(find.byType(ArchiveScreen));
          final history = tester
              .widget<ArchiveScreen>(find.byType(ArchiveScreen))
              .scrollController!;
          history.jumpTo(history.position.maxScrollExtent);
          await select('Me');
          await select('My posts');
          expect(tester.state(find.byType(ArchiveScreen)), same(archive));
          expect(history.offset, 0);
          // A notification destination also returns the visible content to its top.
          final drafts = tester
              .widget<DeskScreen>(
                find.byType(DeskScreen, skipOffstage: false).last,
              )
              .scrollController!;
          drafts.jumpTo(100);
          state.requestTab(1);
          await tester.pumpAndSettle();
          expect(drafts.offset, 0);
          expect(tester.takeException(), isNull);
          await tester.pumpWidget(const SizedBox());
        },
      );
    }
  }
  testWidgets(
    'foreground notification expires with Show and its action still works',
    (tester) async {
      final state = await stateFor();
      addTearDown(state.dispose);
      var opened = 0;
      late BuildContext context;
      await mount(
        tester,
        state,
        Scaffold(
          body: Builder(
            builder: (c) {
              context = c;
              return const SizedBox();
            },
          ),
        ),
      );
      void show() => ScaffoldMessenger.of(context).showSnackBar(
        inAppNotification(
          const RemoteMessage(
            notification: RemoteNotification(
              title: 'Draft ready',
              body: 'Review your new post.',
            ),
          ),
          onOpen: () => opened++,
        ),
      );
      show();
      await tester.pumpAndSettle();
      await dismissAfterTimeout(tester);
      expect(opened, 0);
      show();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Show'));
      await tester.pumpAndSettle();
      expect(opened, 1);
      expect(find.byType(SnackBar), findsNothing);
    },
  );
  testWidgets(
    'schedule confirmation expires with Undo and Undo remains functional',
    (tester) async {
      final writes = <String>[];
      final state = await stateFor(
        respond: (r) async {
          if (r.method == 'PATCH') writes.add(jsonDecode(r.body)['action']);
          return http.Response(
            jsonEncode(statusFixture()),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        },
      );
      addTearDown(state.dispose);
      late BuildContext context;
      await mount(
        tester,
        state,
        Scaffold(
          body: Builder(
            builder: (c) {
              context = c;
              return const SizedBox();
            },
          ),
        ),
      );
      final post = state.status!.queue.first;
      await clearForItsTime(context, post);
      await tester.pumpAndSettle();
      await dismissAfterTimeout(tester);
      await clearForItsTime(context, post);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Undo'));
      await tester.pumpAndSettle();
      expect(writes, ['clear', 'clear', 'unclear']);
    },
  );
  testWidgets(
    'follow-up notice expires during work without hiding a later notice on completion',
    (tester) async {
      final response = Completer<http.Response>();
      final state = await stateFor(respond: (_) => response.future);
      addTearDown(state.dispose);
      late BuildContext context;
      await mount(
        tester,
        state,
        Scaffold(
          body: Builder(
            builder: (c) {
              context = c;
              return const SizedBox();
            },
          ),
        ),
      );
      final work = followUp(context, 1);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      await dismissAfterTimeout(tester);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Another update')));
      await tester.pumpAndSettle();
      response.complete(
        http.Response('{"text":"New follow-up text","hashtags":[]}', 200),
      );
      await tester.pumpAndSettle();
      await work;
      expect(find.text('Another update'), findsOneWidget);
      expect(state.composeSeed, 'New follow-up text');
    },
  );
}
