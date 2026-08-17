/// Tests for the parts that fail SILENTLY.
///
/// The model layer is deliberately total — every field falls back rather than
/// throwing — which means a decoding mistake does not crash, it just quietly
/// shows the wrong thing. That is exactly the failure mode worth testing.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:linkdin_mobile/api/models.dart';
import 'package:linkdin_mobile/theme.dart';
import 'package:linkdin_mobile/widgets/post_card.dart';

void main() {
  group('StyleConfig', () {
    test('a null payload is the house style', () {
      final s = StyleConfig.fromJson(null);
      expect(s.structure, 'prose');
      expect(s.emoji, 'none');
      expect(s.hashtagCount, 2);
    });

    test('missing fields fall back rather than throwing', () {
      final s = StyleConfig.fromJson({'structure': 'bullets'});
      expect(s.structure, 'bullets');
      expect(s.emoji, 'none');
      expect(s.minWords, 120);
    });

    test('wrong-typed fields fall back', () {
      final s = StyleConfig.fromJson({'hashtagCount': 'three', 'minWords': null});
      expect(s.hashtagCount, 2);
      expect(s.minWords, 120);
    });

    test('a round trip through JSON preserves every field', () {
      const original = StyleConfig(
        structure: 'mixed',
        emoji: 'sparing',
        hook: 'bold',
        cta: 'soft',
        minWords: 90,
        maxWords: 160,
        hashtagCount: 4,
        register: 'accessible',
        signature: SignatureConfig(source: 'F1 radio', maxWords: 10, budgetPerFive: 2, banned: ['x']),
        customRules: ['never name the client'],
        bannedPhrases: ['synergy'],
      );
      final back = StyleConfig.fromJson(original.toJson());
      expect(back.toJson().toString(), original.toJson().toString());
    });

    test('clearSignature removes the signature, and a plain copyWith keeps it', () {
      const withSig = StyleConfig(
        structure: 'prose',
        emoji: 'none',
        hook: 'sharp',
        cta: 'none',
        minWords: 120,
        maxWords: 220,
        hashtagCount: 2,
        register: 'practitioner',
        signature: SignatureConfig(source: 'Marvel films', maxWords: 12, budgetPerFive: 1, banned: []),
        customRules: [],
        bannedPhrases: [],
      );
      // Without the explicit flag, copyWith must not silently drop a nullable
      // field — that would turn "change the emoji setting" into "delete the
      // signature", which is unrecoverable from the UI.
      expect(withSig.copyWith(emoji: 'sparing').signature, isNotNull);
      expect(withSig.copyWith(clearSignature: true).signature, isNull);
    });

    test('the summary reflects the settings a user just changed', () {
      final s = StyleConfig.fromJson(null).copyWith(hashtagCount: 0, emoji: 'expressive');
      expect(s.summary, contains('no tags'));
      expect(s.summary, contains('expressive emoji'));
    });
  });

  group('AppStatus', () {
    test('an uninitialised backend decodes without an agent', () {
      final s = AppStatus.fromJson({
        'initialized': false,
        'config': {'liveMode': false},
      });
      expect(s.initialized, isFalse);
      expect(s.agent, isNull);
      expect(s.account.connected, isFalse);
      expect(s.queue, isEmpty);
    });

    test('a full payload decodes agent, queue and presets', () {
      final s = AppStatus.fromJson({
        'initialized': true,
        'agent': {
          'agentId': 'a1',
          'name': 'Test Agent',
          'domain': 'audio',
          'categories': ['emerging-tech'],
          'timezone': 'Asia/Kolkata',
          'postTimeLocal': '09:30',
          'autoPublish': false,
          'paused': false,
          'style': {'structure': 'bullets'},
        },
        'account': {'connected': true, 'memberName': 'Someone', 'daysRemaining': 42},
        'config': {
          'liveMode': true,
          'presets': [
            {'id': 'builder', 'label': 'Builder', 'blurb': 'b', 'style': {'emoji': 'sparing'}},
          ],
        },
        'schedule': {'nextRunLocal': 'tomorrow 09:30', 'cycleCount': 7},
        'queue': [
          {'id': 'p1', 'seq': 1, 'text': 'Body', 'status': 'draft', 'hashtags': ['DSP']},
        ],
        'history': [],
      });

      expect(s.agent!.name, 'Test Agent');
      expect(s.agent!.style.structure, 'bullets');
      expect(s.account.usable, isTrue);
      expect(s.presets.single.label, 'Builder');
      expect(s.queue.single.isDraft, isTrue);
      expect(s.queue.single.hashtags, ['DSP']);
      expect(s.cycleCount, 7);
    });

    test('needsReauth makes an otherwise connected account unusable', () {
      final s = AppStatus.fromJson({
        'initialized': true,
        'account': {'connected': true, 'needsReauth': true},
        'config': {},
      });
      expect(s.account.connected, isTrue);
      expect(s.account.usable, isFalse);
    });

    test('a garbage queue entry list does not crash decoding', () {
      final s = AppStatus.fromJson({
        'initialized': true,
        'config': {},
        'queue': ['not a post', 42, null],
      });
      expect(s.queue, isEmpty);
    });
  });

  group('PostCard fold marker', () {
    Widget wrap(Widget child) => MaterialApp(
          theme: buildTheme(),
          home: Scaffold(body: SingleChildScrollView(child: child)),
        );

    testWidgets('a short post shows no fold marker', (tester) async {
      final post = Post.fromJson({'id': 'p1', 'seq': 1, 'text': 'Short one.', 'status': 'draft'});
      await tester.pumpWidget(wrap(PostCard(post: post)));
      expect(find.text('see more'), findsNothing);
    });

    testWidgets('a long post shows the fold where LinkedIn cuts it', (tester) async {
      final post = Post.fromJson({
        'id': 'p2',
        'seq': 2,
        'text': 'A' * (kFoldChars + 120),
        'status': 'draft',
      });
      await tester.pumpWidget(wrap(PostCard(post: post)));
      expect(find.text('see more'), findsOneWidget);
    });

    testWidgets('draft actions appear only when handlers are given', (tester) async {
      final post = Post.fromJson({'id': 'p3', 'seq': 3, 'text': 'Body text.', 'status': 'draft'});

      await tester.pumpWidget(wrap(PostCard(post: post)));
      expect(find.text('Publish'), findsNothing);

      await tester.pumpWidget(wrap(PostCard(post: post, onSendNow: () {})));
      expect(find.text('Publish'), findsOneWidget);
    });

    // An unscheduled post has no time to be cleared FOR, so the only thing
    // approving it can mean is sending it. Offering "Clear" here would promise
    // a scheduled send that nothing would ever perform.
    testWidgets('an unscheduled post offers Publish, never Clear', (tester) async {
      final post = Post.fromJson({'id': 'p4', 'seq': 4, 'text': 'Body text.', 'status': 'draft'});

      await tester.pumpWidget(wrap(PostCard(post: post, onSendNow: () {})));

      expect(find.text('Publish'), findsOneWidget);
      expect(find.textContaining('Clear'), findsNothing);
    });

    // The regression that would quietly destroy the review window: if the
    // primary button on a scheduled draft ever publishes instead of clearing,
    // reviewing a post at 08:48 sends it at 08:48.
    testWidgets('a scheduled post leads with Clear, not Publish', (tester) async {
      final at = DateTime.now().add(const Duration(minutes: 20));
      final post = Post.fromJson({
        'id': 'p5',
        'seq': 5,
        'text': 'Body text.',
        'status': 'draft',
        'scheduledFor': at.toUtc().toIso8601String(),
      });

      await tester.pumpWidget(
        wrap(PostCard(post: post, onClear: () {}, onSendNow: () {})),
      );

      final hhmm =
          '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}';
      expect(find.text('Clear for $hhmm'), findsOneWidget);
      expect(find.text('Publish'), findsNothing);
      // And the countdown must be on screen — a review window you cannot see
      // the end of is not a review window.
      expect(find.textContaining('Sends at $hhmm'), findsOneWidget);
    });

    testWidgets('a cleared post says so and stops offering Clear', (tester) async {
      final at = DateTime.now().add(const Duration(minutes: 20));
      final post = Post.fromJson({
        'id': 'p6',
        'seq': 6,
        'text': 'Body text.',
        'status': 'approved',
        'scheduledFor': at.toUtc().toIso8601String(),
        'clearedAt': DateTime.now().toUtc().toIso8601String(),
      });

      await tester.pumpWidget(wrap(PostCard(post: post, onSendNow: () {})));

      expect(find.textContaining('Cleared'), findsOneWidget);
      expect(find.text('Send now'), findsOneWidget);
    });
  });
}
