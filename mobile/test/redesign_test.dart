import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
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
import 'package:linkdin_mobile/screens/home_screen.dart';
import 'package:linkdin_mobile/screens/voice_screen.dart';
import 'package:linkdin_mobile/screens/welcome_screen.dart';
import 'package:linkdin_mobile/screens/onboarding_screen.dart';
import 'package:linkdin_mobile/screens/delivery_settings_screen.dart';
import 'package:linkdin_mobile/screens/settings_screen.dart';
import 'package:linkdin_mobile/screens/timetable_screen.dart';
import 'package:linkdin_mobile/widgets/experience.dart';
import 'screens_test.dart' show statusFixture;
import 'onboarding_test.dart' show setupFixture;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('light palette maintains readable text and control boundaries', () {
    double contrast(Color a, Color b) {
      final x = a.computeLuminance(), y = b.computeLuminance();
      return ((x > y ? x : y) + .05) / ((x > y ? y : x) + .05);
    }

    for (final bg in [C.ink, C.ink2, C.ink3]) {
      for (final fg in [
        C.paper,
        C.paperDim,
        C.paperFaint,
        C.filament,
        C.daylight,
        C.flare,
      ]) {
        expect(contrast(fg, bg), greaterThanOrEqualTo(4.5));
      }
    }
    expect(contrast(C.onFilament, C.filament), greaterThanOrEqualTo(4.5));
    expect(contrast(C.ruleStrong, C.ink2), greaterThanOrEqualTo(3));
  });

  Future<AppState> fixtureState() async {
    SharedPreferences.setMockInitialValues({});
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          const MethodChannel('plugins.it_nomads.com/flutter_secure_storage'),
          (_) async => null,
        );
    final fixture = statusFixture();
    final api = await ApiClient.create(
      httpClient: MockClient((r) async {
        final body = switch (r.url.path) {
          '/api/native-auth' => {
            'linkedin': true,
            'google': false,
            'localTest': false,
          },
          '/api/interests' => {
            'topics': ['AI in everyday work', 'Product design', 'Leadership'],
          },
          '/api/onboarding' => setupFixture(),
          _ => fixture,
        };
        return http.Response(
          jsonEncode(body),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    await api.saveNativeSession('design-fixture');
    return AppState(api)
      ..status = AppStatus.fromJson(fixture)
      ..phase = AuthPhase.signedIn;
  }

  final pages = <String, Widget Function()>{
    'welcome': () => const WelcomeScreen(),
    'interests-onboarding': () => OnboardingScreen(
      initial: {
        ...setupFixture(),
        'preview': null,
        'account': {'connected': true, 'memberName': 'Alex Morgan'},
      },
      onComplete: () {},
    ),
    'sample': () =>
        OnboardingScreen(initial: setupFixture(), onComplete: () {}),
    'daily': () => const HomeScreen(),
    'voice': () => const VoiceScreen(),
    'topics': () => const TopicsScreen(),
    'delivery': () => const DeliverySettingsScreen(),
    'timetable': () => const TimetableScreen(),
  };
  for (final size in [
    const Size(390, 844),
    const Size(900, 900),
    const Size(1280, 900),
  ]) {
    for (final page in pages.entries) {
      testWidgets('${page.key} adapts at ${size.width.toInt()}', (
        tester,
      ) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final loader = FontLoader('PlexSans')
          ..addFont(rootBundle.load('assets/fonts/IBMPlexSans.ttf'));
        await loader.load();
        await (FontLoader(
          'MaterialIcons',
        )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
        await (FontLoader(
              'PlexMono',
            )..addFont(rootBundle.load('assets/fonts/IBMPlexMono-Regular.ttf')))
            .load();
        final state = await fixtureState();
        final boundary = GlobalKey();
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: state,
            child: MaterialApp(
              theme: buildTheme(),
              home: RepaintBoundary(key: boundary, child: page.value()),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull);
        if (Platform.environment['BYLINE_CAPTURE_UI'] == 'true') {
          final renderer =
              boundary.currentContext!.findRenderObject()
                  as RenderRepaintBoundary;
          await tester.runAsync(() async {
            final image = await renderer.toImage();
            final bytes = await image.toByteData(
              format: ui.ImageByteFormat.png,
            );
            final dir = Directory('../reports/ui-preview')
              ..createSync(recursive: true);
            File(
              '${dir.path}/${page.key}-${size.width.toInt()}.png',
            ).writeAsBytesSync(bytes!.buffer.asUint8List());
            image.dispose();
          });
        }
        await tester.pumpWidget(const SizedBox());
        state.dispose();
      });
    }
  }
  for (final page in pages.entries) {
    testWidgets('${page.key} supports larger text on a small phone', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final state = await fixtureState();
      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: state,
          child: MaterialApp(
            theme: buildTheme(),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(1.6)),
              child: child!,
            ),
            home: page.value(),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      state.dispose();
    });
  }
  testWidgets('delivery allows a time outside quarter-hour presets', (
    tester,
  ) async {
    String? selected;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: Scaffold(
          body: TimeChoice(value: '09:07', onChanged: (v) => selected = v),
        ),
      ),
    );
    await tester.tap(
      find
          .descendant(
            of: find.byType(TimeChoice),
            matching: find.byType(InkWell),
          )
          .first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    expect(selected, '09:07');
  });
  testWidgets('voice instructions are directly editable and enable Save', (
    tester,
  ) async {
    final state = await fixtureState();
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: state,
        child: MaterialApp(theme: buildTheme(), home: const VoiceScreen()),
      ),
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Your own rules'),
      'Write warmly. Avoid jargon.',
    );
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'))
          .onPressed,
      isNotNull,
    );
  });
}
