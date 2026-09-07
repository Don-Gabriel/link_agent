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
import 'package:linkdin_mobile/screens/onboarding_screen.dart';
import 'package:linkdin_mobile/state/app_state.dart';
import 'package:linkdin_mobile/theme.dart';
import 'package:linkdin_mobile/widgets/form_select.dart';
import 'package:linkdin_mobile/widgets/writing_preferences.dart';
import 'onboarding_test.dart' show setupFixture;

void main() {
  test('errors explain recovery without exposing service internals', () {
    expect(
      ApiException(
        0,
        'timeout',
        detail: 'http://10.0.2.2 adb reverse',
      ).toString(),
      isNot(contains('adb')),
    );
    expect(
      ApiException(
        500,
        'gemini_missing_key',
        detail: 'GEMINI_API_KEY',
      ).toString(),
      contains('temporarily unavailable'),
    );
    expect(
      ApiException(
        400,
        'setup_failed',
        detail: 'Choose a valid timezone.',
      ).toString(),
      'Choose a valid timezone.',
    );
  });

  testWidgets('large catalogue search retains choices and cancels safely', (
    tester,
  ) async {
    var selected = ['subject-1'];
    final options = {
      for (var i = 0; i < 1100; i++) 'subject-$i': 'Specialist subject $i',
      'solar': 'Solar energy · Energy & utilities',
    };
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(),
        home: Scaffold(
          body: StatefulBuilder(
            builder: (context, set) => MultiSelectField(
              label: 'Subjects',
              options: options,
              values: selected,
              max: 12,
              onChanged: (v) => set(() => selected = v),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.byType(MultiSelectField));
    await tester.pumpAndSettle();
    expect(
      find.byType(CheckboxListTile).evaluate().length,
      lessThan(30),
      reason: 'the catalogue is rendered lazily',
    );
    await tester.enterText(find.byType(TextField), 'energy solar');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Solar energy · Energy & utilities'));
    await tester.tap(find.text('Apply'));
    await tester.pumpAndSettle();
    expect(selected, ['subject-1', 'solar']);
    await tester.tap(find.byType(MultiSelectField));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'zzzz');
    await tester.pumpAndSettle();
    expect(find.textContaining('No matching options'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(selected, ['subject-1', 'solar']);
  });

  for (final defaults in [false, true]) {
    testWidgets(
      defaults
          ? 'voice setup can be skipped with defaults'
          : 'setup sends the selected subjects and fine-tuned voice',
      (tester) async {
        SharedPreferences.setMockInitialValues({});
        tester.view.physicalSize = const Size(390, 844);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final initial = setupFixture()
          ..['preview'] = null
          ..['account'] = {'connected': true};
        (initial['config'] as Map)['categories'] = ['solar'];
        (initial['config'] as Map)['topics'] = ['Solar energy'];
        initial['categories'] = [
          {
            'id': 'solar',
            'label': 'Solar energy',
            'groupLabel': 'Energy & utilities',
          },
          ...List.generate(
            1100,
            (i) => {'id': 's$i', 'label': 'Specialist subject $i'},
          ),
        ];
        final calls = <Map<String, dynamic>>[];
        final api = await ApiClient.create(
          httpClient: MockClient((r) async {
            final body = jsonDecode(r.body) as Map<String, dynamic>;
            calls.add(body);
            return http.Response(
              jsonEncode({
                ...initial,
                'revision': 2,
                'preview': body['action'] == 'preview'
                    ? {
                        'text': 'A reviewed sample about solar energy.',
                        'sources': [],
                      }
                    : null,
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }),
        );
        await tester.runAsync(() async {
          await (FontLoader(
            'PlexSans',
          )..addFont(rootBundle.load('assets/fonts/IBMPlexSans.ttf'))).load();
          await (FontLoader('MaterialIcons')
                ..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf')))
              .load();
        });
        final boundary = GlobalKey();
        await tester.pumpWidget(
          ChangeNotifierProvider.value(
            value: AppState(api),
            child: MaterialApp(
              theme: buildTheme(),
              home: RepaintBoundary(
                key: boundary,
                child: OnboardingScreen(initial: initial, onComplete: () {}),
              ),
            ),
          ),
        );
        Future<void> reveal(Finder f) async {
          await tester.scrollUntilVisible(
            f,
            180,
            scrollable: find.byType(Scrollable).first,
          );
          await tester.pumpAndSettle();
        }

        await reveal(find.text('Continue'));
        await tester.tap(find.text('Continue'));
        await tester.pumpAndSettle();
        expect(find.text('Make it sound like you'), findsOneWidget);
        if (!defaults) {
          await reveal(find.text('Fine-tune your writing'));
          await tester.tap(find.text('Fine-tune your writing'));
          await tester.pumpAndSettle();
          await reveal(find.byType(WritingPreferences));
          final prefs = tester.widget<WritingPreferences>(
            find.byType(WritingPreferences),
          );
          prefs.onChanged!(
            prefs.value.copyWith(
              structure: 'bullets',
              minWords: 80,
              maxWords: 160,
              hashtagCount: 0,
              register: 'accessible',
            ),
          );
          await tester.pumpAndSettle();
          expect(tester.takeException(), isNull);
          // Reviewable rendering from the real setup screen at phone width.
          await tester.runAsync(() async {
            final image =
                await (boundary.currentContext!.findRenderObject()
                        as RenderRepaintBoundary)
                    .toImage();
            final bytes = await image.toByteData(
              format: ui.ImageByteFormat.png,
            );
            final file = File('../.byline-local/voice-setup-390.png');
            await file.writeAsBytes(bytes!.buffer.asUint8List());
            image.dispose();
          });
        }
        final button = find.text(
          defaults ? 'Use default voice' : 'Show my sample',
        );
        await reveal(button);
        await tester.tap(button);
        await tester.pumpAndSettle();
        final saved =
            calls.firstWhere((c) => c['action'] == 'save')['config'] as Map;
        expect(saved['categories'], ['solar']);
        expect(saved['topics'], ['Solar energy']);
        if (defaults) {
          expect(saved['voice'], 'professional');
          expect(saved['style'], isNull);
          expect(saved['samples'], isEmpty);
        } else {
          expect(saved['style']['structure'], 'bullets');
          expect(saved['style']['minWords'], 80);
          expect(saved['style']['maxWords'], 160);
          expect(saved['style']['hashtagCount'], 0);
        }
        expect(calls.last['action'], 'preview');
        expect(tester.takeException(), isNull);
      },
    );
  }
}
