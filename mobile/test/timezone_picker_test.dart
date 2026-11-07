import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:linkdin_mobile/api/client.dart';
import 'package:linkdin_mobile/state/app_state.dart';
import 'package:linkdin_mobile/screens/onboarding_screen.dart';
import 'package:linkdin_mobile/screens/timetable_screen.dart';
import 'package:linkdin_mobile/timezones.dart';
import 'package:linkdin_mobile/theme.dart';
import 'package:linkdin_mobile/widgets/timezone_picker.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'onboarding_test.dart' show setupFixture;
import 'screens_test.dart' show statusFixture;

void main() {
  const channel = MethodChannel('flutter_timezone');
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (_) async => 'Asia/Kolkata');
  });
  tearDown(
    () => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null),
  );

  test(
    'full catalogue includes uncommon zones, aliases and correct fractional/DST offsets',
    () {
      expect(Timezones.all.length, greaterThan(500));
      for (final id in [
        'Asia/Kathmandu',
        'Asia/Calcutta',
        'Pacific/Chatham',
        'America/Argentina/Ushuaia',
        'UTC',
      ]) {
        expect(Timezones.all, contains(id));
      }
      expect(Timezones.offset('Asia/Kathmandu'), 'UTC+05:45');
      expect(
        Timezones.offset('America/New_York', at: DateTime.utc(2026, 1, 15)),
        'UTC-05:00',
      );
      expect(
        Timezones.offset('America/New_York', at: DateTime.utc(2026, 7, 15)),
        'UTC-04:00',
      );
      expect(
        Timezones.offset('Pacific/Chatham', at: DateTime.utc(2026, 7, 15)),
        'UTC+12:45',
      );
    },
  );

  Future<void> mountPicker(
    WidgetTester tester,
    TextEditingController controller, {
    bool enabled = true,
  }) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ZoneField(controller: controller, enabled: enabled),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> openPicker(WidgetTester tester) async {
    await tester.tap(find.byType(ZoneField));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'timezone is selection-only; search supports city and offsets, Apply commits',
    (tester) async {
      final controller = TextEditingController(text: 'UTC');
      addTearDown(controller.dispose);
      await mountPicker(tester, controller);
      expect(find.byType(TextField), findsNothing);
      await openPicker(tester);
      expect(find.text('Use device timezone'), findsOneWidget);
      await tester.enterText(find.byType(TextField), 'Kathmandu');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('timezone:Asia/Kathmandu')));
      await tester.pump();
      expect(controller.text, 'UTC');
      await tester.tap(find.text('Apply'));
      await tester.pumpAndSettle();
      expect(controller.text, 'Asia/Kathmandu');
      await openPicker(tester);
      await tester.enterText(find.byType(TextField), 'UTC+05:45');
      await tester.pumpAndSettle();
      expect(
        find.byKey(const ValueKey('timezone:Asia/Kathmandu')),
        findsOneWidget,
      );
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'device shortcut is explicit and cancelling preserves the saved zone',
    (tester) async {
      final controller = TextEditingController(text: 'Europe/London');
      addTearDown(controller.dispose);
      await mountPicker(tester, controller);
      await openPicker(tester);
      await tester.tap(find.text('Use device timezone'));
      await tester.pump();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(controller.text, 'Europe/London');
      await openPicker(tester);
      await tester.tap(find.text('Use device timezone'));
      await tester.pump();
      await tester.tap(find.text('Apply'));
      await tester.pumpAndSettle();
      expect(controller.text, 'Asia/Kolkata');
    },
  );

  testWidgets(
    'device lookup failure still offers the complete offline list and empty search recovery',
    (tester) async {
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        channel,
        (_) async => throw PlatformException(code: 'unavailable'),
      );
      final controller = TextEditingController(text: 'UTC');
      addTearDown(controller.dispose);
      await mountPicker(tester, controller);
      await openPicker(tester);
      expect(
        find.text('Device timezone unavailable. Choose from the list.'),
        findsOneWidget,
      );
      await tester.enterText(find.byType(TextField), 'not-a-real-city');
      await tester.pumpAndSettle();
      expect(find.textContaining('No matching timezones'), findsOneWidget);
      await tester.tap(find.byTooltip('Clear search'));
      await tester.pumpAndSettle();
      expect(find.byType(ListTile), findsWidgets);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
    },
  );

  testWidgets('disabled timezone selector cannot open', (tester) async {
    final controller = TextEditingController(text: 'UTC');
    addTearDown(controller.dispose);
    await mountPicker(tester, controller, enabled: false);
    await tester.tap(find.byType(ZoneField));
    await tester.pumpAndSettle();
    expect(find.text('Choose timezone'), findsNothing);
  });

  for (final layout in [
    (390.0, 844.0, 1.0),
    (360.0, 800.0, 1.6),
    (1100.0, 800.0, 1.0),
  ]) {
    testWidgets('picker layout at ${layout.$1} with text scale ${layout.$3}', (
      tester,
    ) async {
      tester.view.physicalSize = Size(layout.$1, layout.$2);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await (FontLoader(
        'PlexSans',
      )..addFont(rootBundle.load('assets/fonts/IBMPlexSans.ttf'))).load();
      await (FontLoader('BarlowCondensed')..addFont(
            rootBundle.load('assets/fonts/BarlowCondensed-SemiBold.ttf'),
          ))
          .load();
      await (FontLoader(
        'MaterialIcons',
      )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
      final controller = TextEditingController(text: 'Asia/Kolkata');
      addTearDown(controller.dispose);
      final boundary = GlobalKey();
      await tester.pumpWidget(
        RepaintBoundary(
          key: boundary,
          child: MaterialApp(
            theme: buildTheme(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: TextScaler.linear(layout.$3)),
              child: child!,
            ),
            home: Scaffold(body: ZoneField(controller: controller)),
          ),
        ),
      );
      await openPicker(tester);
      await tester.enterText(find.byType(TextField), 'America');
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      if (Platform.environment['BYLINE_CAPTURE_UI'] == 'true') {
        final renderer =
            boundary.currentContext!.findRenderObject()
                as RenderRepaintBoundary;
        await tester.runAsync(() async {
          final image = await renderer.toImage();
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          File(
            '../.byline-local/timezone-picker-${layout.$1.toInt()}.png',
          ).writeAsBytesSync(bytes!.buffer.asUint8List());
          image.dispose();
        });
      }
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(controller.text, 'Asia/Kolkata');
    });
  }

  testWidgets(
    'small phone with keyboard keeps search, results and actions usable',
    (tester) async {
      tester.view.physicalSize = const Size(360, 740);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final controller = TextEditingController(text: 'UTC');
      addTearDown(controller.dispose);
      await mountPicker(tester, controller);
      await openPicker(tester);
      tester.view.viewInsets = const FakeViewPadding(bottom: 280);
      addTearDown(tester.view.resetViewInsets);
      await tester.enterText(find.byType(TextField), 'Tokyo');
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const ValueKey('timezone:Asia/Tokyo')));
      await tester.pump();
      await tester.tap(find.text('Apply'));
      await tester.pumpAndSettle();
      expect(controller.text, 'Asia/Tokyo');
    },
  );

  for (final revision in [0, 1]) {
    testWidgets(
      'setup revision $revision defaults only a new account and saves the chosen zone',
      (tester) async {
        var setup = {
          ...setupFixture(),
          'revision': revision,
          'accepted_revision': revision,
          'config': {
            ...setupFixture()['config'] as Map,
            'timezone': 'Europe/London',
          },
        };
        final writes = <Map>[];
        final api = await ApiClient.create(
          httpClient: MockClient((r) async {
            if (r.method == 'POST') writes.add(jsonDecode(r.body) as Map);
            return http.Response(
              jsonEncode(setup),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }),
        );
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: AppState(api),
            child: MaterialApp(
              home: OnboardingScreen(initial: setup, onComplete: () {}),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.scrollUntilVisible(
          find.byType(ZoneField),
          200,
          scrollable: find.byType(Scrollable).first,
        );
        await tester.pumpAndSettle();
        final field = tester.widget<ZoneField>(find.byType(ZoneField));
        expect(
          field.controller.text,
          revision == 0 ? 'Asia/Kolkata' : 'Europe/London',
        );
        await tester.ensureVisible(find.byType(ZoneField));
        await openPicker(tester);
        await tester.enterText(find.byType(TextField), 'Tokyo');
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey('timezone:Asia/Tokyo')));
        await tester.pump();
        await tester.tap(find.text('Apply'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Continue'));
        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Not now'));
        await tester.tap(find.text('Not now'));
        await tester.pumpAndSettle();
        expect(writes.last['timezone'], 'Asia/Tokyo');
      },
    );
  }

  testWidgets('late device detection never replaces a manual setup selection', (
    tester,
  ) async {
    final detection = Completer<String>();
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      channel,
      (_) => detection.future,
    );
    final setup = {...setupFixture(), 'revision': 0, 'accepted_revision': 0};
    final api = await ApiClient.create(
      httpClient: MockClient((_) async => http.Response('{}', 200)),
    );
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: AppState(api),
        child: MaterialApp(
          home: OnboardingScreen(initial: setup, onComplete: () {}),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(
      find.byType(ZoneField),
      200,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byType(ZoneField));
    await openPicker(tester);
    await tester.enterText(find.byType(TextField), 'Tokyo');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('timezone:Asia/Tokyo')));
    await tester.pump();
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();
    detection.complete('Asia/Kolkata');
    await tester.pumpAndSettle();
    expect(
      tester.widget<ZoneField>(find.byType(ZoneField)).controller.text,
      'Asia/Tokyo',
    );
  });

  testWidgets(
    'Settings timetable uses the same picker and saves the IANA identifier',
    (tester) async {
      final writes = <Map>[];
      final status = statusFixture();
      final api = await ApiClient.create(
        httpClient: MockClient((r) async {
          if (r.method == 'PATCH') {
            final body = jsonDecode(r.body) as Map;
            writes.add(body);
            (status['agent'] as Map)['timezone'] = body['timezone'];
          }
          return http.Response(
            jsonEncode(status),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );
      final state = AppState(api);
      await state.refresh();
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: state,
          child: const MaterialApp(home: TimetableScreen()),
        ),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.text('Timezone'),
        200,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Timezone'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'Chatham');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('timezone:Pacific/Chatham')));
      await tester.pump();
      await tester.tap(find.text('Apply'));
      await tester.pumpAndSettle();
      expect(writes.single['timezone'], 'Pacific/Chatham');
    },
  );
}
