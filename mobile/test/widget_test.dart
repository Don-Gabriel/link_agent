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

      await tester.pumpWidget(wrap(PostCard(post: post, onApprove: () {})));
      expect(find.text('Publish'), findsOneWidget);
    });
  });
}
