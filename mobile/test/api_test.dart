/// Transport-layer tests: the HTTP method, path and body of every call.
///
/// These exist because of a real bug. `/api/posts/[seq]` exports PATCH; the
/// client called POST; every publish, discard and edit from the phone returned
/// 405. Twenty-four passing widget tests said nothing about it, because none of
/// them touched the network.
///
/// A route's verb is a contract with the backend, and the only place it can be
/// checked is here.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:linkdin_mobile/api/client.dart';
import 'package:linkdin_mobile/api/models.dart';
import 'package:linkdin_mobile/state/app_state.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// One recorded request.
class _Call {
  _Call(this.method, this.path, this.body, this.headers, this.rawBody);
  final String method;
  final String path;
  final Map<String, dynamic> body;
  final Map<String, String> headers;

  /// The unparsed body — the only way to inspect multipart part headers.
  final String rawBody;
}

void main() {
  late List<_Call> calls;

  /// Builds a state wired to a fake transport that records everything and
  /// answers with [response].
  Future<AppState> buildState({
    Map<String, dynamic> response = const {'ok': true},
    int status = 200,
    bool signedIn = true,
  }) async {
    SharedPreferences.setMockInitialValues(
      signedIn ? {'session_cookie': 'lc_session=abc', 'base_url': 'http://test.local'} : {},
    );
    calls = [];

    final mock = MockClient((request) async {
      // latin1, not request.body: that getter decodes as UTF-8 and a multipart
      // body carrying real image bytes is not valid UTF-8, so it throws.
      final raw = latin1.decode(request.bodyBytes, allowInvalid: true);

      Map<String, dynamic> parsed = {};
      if (raw.isNotEmpty && !raw.startsWith('--')) {
        try {
          final decoded = jsonDecode(raw);
          if (decoded is Map<String, dynamic>) parsed = decoded;
        } on FormatException {
          // Not JSON — rawBody still carries it.
        }
      }
      calls.add(_Call(request.method, request.url.path, parsed, request.headers, raw));
      return http.Response(jsonEncode(response), status,
          headers: {'content-type': 'application/json'});
    });

    return AppState(await ApiClient.create(httpClient: mock));
  }

  group('post actions use the verb the route actually exports', () {
    // Clearing and sending are DIFFERENT verbs, and conflating them is the
    // regression these two tests exist to catch. Clearing says "let it go at
    // its scheduled time"; sending says "go now". If clear ever starts emitting
    // action:publish again, every cleared draft publishes the instant it is
    // reviewed and the whole review window silently disappears.
    test('clear sends PATCH /api/posts/<seq> with action clear', () async {
      final state = await buildState();
      await state.clear(7);

      final call = calls.first;
      expect(call.method, 'PATCH', reason: 'the route exports PATCH; POST returns 405');
      expect(call.path, '/api/posts/7');
      expect(call.body['action'], 'clear',
          reason: 'clearing must not publish — it authorises the scheduled send');
    });

    test('sendNow sends PATCH with action publish', () async {
      final state = await buildState();
      await state.sendNow(7);

      final call = calls.first;
      expect(call.method, 'PATCH');
      expect(call.path, '/api/posts/7');
      expect(call.body['action'], 'publish');
    });

    test('unclear withdraws the clearance', () async {
      final state = await buildState();
      await state.unclear(2);
      expect(calls.first.body['action'], 'unclear');
    });

    test('holdForEditing takes the edit lock', () async {
      final state = await buildState();
      await state.holdForEditing(5);
      expect(calls.first.path, '/api/posts/5');
      expect(calls.first.body['action'], 'hold');
    });

    test('reschedule sends an ISO instant in UTC', () async {
      final state = await buildState();
      final when = DateTime.utc(2026, 8, 20, 9, 30);
      await state.reschedule(6, when);

      expect(calls.first.body['action'], 'reschedule');
      expect(calls.first.body['scheduledFor'], when.toIso8601String());
    });

    test('reschedule with null lifts a post off the timetable', () async {
      final state = await buildState();
      await state.reschedule(6, null);
      expect(calls.first.body['action'], 'reschedule');
      expect(calls.first.body['scheduledFor'], isNull);
    });

    test('discard sends PATCH with action discard', () async {
      final state = await buildState();
      await state.discard(3);
      expect(calls.first.method, 'PATCH');
      expect(calls.first.path, '/api/posts/3');
      expect(calls.first.body['action'], 'discard');
    });

    test('editPost sends PATCH with the text', () async {
      final state = await buildState();
      await state.editPost(4, 'New body text', ['DSP']);

      final call = calls.first;
      expect(call.method, 'PATCH');
      expect(call.path, '/api/posts/4');
      expect(call.body['action'], 'edit');
      expect(call.body['text'], 'New body text');
      expect(call.body['hashtags'], ['DSP']);
    });

    test('editPost omits mediaIds entirely when not given', () async {
      final state = await buildState();
      await state.editPost(4, 'Body text here', const []);
      // Absent means "leave existing images alone"; sending an empty array
      // would silently detach every image on the post.
      expect(calls.first.body.containsKey('mediaIds'), isFalse);
    });

    test('editPost sends mediaIds when given, including an explicit empty list', () async {
      final state = await buildState();
      await state.editPost(4, 'Body text here', const [], mediaIds: const []);
      expect(calls.first.body['mediaIds'], isEmpty);
      expect(calls.first.body.containsKey('mediaIds'), isTrue);
    });

    test('compose sends POST /api/posts — the collection route IS a POST', () async {
      final state = await buildState(response: {'ok': true, 'id': 'p9', 'seq': 9});
      await state.compose(text: 'A new post body', polish: true, publishNow: false);

      expect(calls.first.method, 'POST');
      expect(calls.first.path, '/api/posts');
      expect(calls.first.body['polish'], isTrue);
    });

    test('rewrite sends PATCH with the variant index and returns the text', () async {
      final state = await buildState(response: {'ok': true, 'text': 'A different version.'});
      final text = await state.rewriteDraft(5, variant: 2);

      expect(calls.first.method, 'PATCH');
      expect(calls.first.path, '/api/posts/5');
      expect(calls.first.body['action'], 'rewrite');
      expect(calls.first.body['variant'], 2);
      expect(text, 'A different version.');
    });

    test('rewrite rejects an empty result rather than blanking the draft', () async {
      final state = await buildState(response: {'ok': true, 'text': '   '});
      expect(() => state.rewriteDraft(5), throwsA(isA<ApiException>()));
    });

    test('rewriting UNSAVED text posts the body, since there is no seq yet', () async {
      final state = await buildState(response: {'ok': true, 'text': 'Another angle entirely.'});
      final text = await state.rewriteText('Some text the user just typed out.', variant: 1);

      expect(calls.first.method, 'POST');
      expect(calls.first.path, '/api/compose/rewrite');
      expect(calls.first.body['text'], 'Some text the user just typed out.');
      expect(calls.first.body['variant'], 1);
      expect(text, 'Another angle entirely.');
    });

    test('an unsaved rewrite also refuses an empty result', () async {
      final state = await buildState(response: {'ok': true, 'text': ''});
      expect(() => state.rewriteText('Some text the user just typed out.'),
          throwsA(isA<ApiException>()));
    });
  });

  group('image upload', () {
    test('declares a real image content type, not octet-stream', () async {
      final state = await buildState(response: {'ok': true, 'id': 'media-1'});
      final file = File('${Directory.systemTemp.path}/linkdin_test_upload.jpg')
        ..writeAsBytesSync([0xFF, 0xD8, 0xFF, 0xE0, 0x00]);
      addTearDown(() => file.existsSync() ? file.deleteSync() : null);

      final ids = await state.uploadImages([file.path]);

      expect(ids, ['media-1']);
      expect(calls.first.method, 'POST');
      expect(calls.first.path, '/api/media');
      // /api/media checks the DECLARED type against {jpeg, png, gif}.
      // MultipartFile defaults to application/octet-stream, which made every
      // valid photo fail with 400 unsupported_type.
      expect(calls.first.rawBody, contains('image/jpeg'));
      expect(calls.first.rawBody, isNot(contains('application/octet-stream')));
    });

    test('png keeps its own type rather than being called a jpeg', () async {
      final state = await buildState(response: {'ok': true, 'id': 'media-2'});
      final file = File('${Directory.systemTemp.path}/linkdin_test_upload.png')
        ..writeAsBytesSync([0x89, 0x50, 0x4E, 0x47]);
      addTearDown(() => file.existsSync() ? file.deleteSync() : null);

      await state.uploadImages([file.path]);
      expect(calls.first.rawBody, contains('image/png'));
    });
  });

  group('settings', () {
    test('style save sends PATCH /api/settings with the whole config', () async {
      final state = await buildState();
      await state.setStyle(StyleConfig.houseStyle.copyWith(emoji: 'sparing'));

      expect(calls.first.method, 'PATCH');
      expect(calls.first.path, '/api/settings');
      expect((calls.first.body['style'] as Map)['emoji'], 'sparing');
    });

    test('preset save sends the preset id, not a style blob', () async {
      final state = await buildState();
      await state.applyPreset('builder');
      expect(calls.first.body['preset'], 'builder');
    });
  });

  group('session handling', () {
    test('the session cookie is attached to authenticated calls', () async {
      final state = await buildState();
      await state.clear(1);
      expect(calls.first.headers['cookie'], 'lc_session=abc');
    });

    test('a 401 clears the session and drops back to the gate', () async {
      final state = await buildState(response: {'error': 'unauthorized'}, status: 401);
      state.phase = AuthPhase.signedIn;

      await state.refresh();

      expect(state.phase, AuthPhase.signedOut,
          reason: 'a dead cookie must not leave a signed-in shell that 401s on every tap');
      expect(state.status, isNull);
    });

    test('a server error surfaces its detail instead of a generic message', () async {
      final state = await buildState(
        response: {'error': 'bad_post_time', 'detail': 'Expected HH:MM, got "18:00:00"'},
        status: 400,
      );
      final error = await state.setStyle(StyleConfig.houseStyle);
      expect(error, contains('Expected HH:MM'));
    });
  });

  group('editing target', () {
    test('startEditing sets the target and raises a compose request', () async {
      final state = await buildState();
      final post = Post.fromJson({'id': 'p2', 'seq': 2, 'text': 'Body', 'status': 'draft'});

      final before = state.composeRequest;
      state.startEditing(post);

      expect(state.editing?.seq, 2);
      expect(state.composeRequest, greaterThan(before),
          reason: 'the shell watches this counter to bring the composer forward');
    });

    test('editing the same post twice still raises a fresh request', () async {
      final state = await buildState();
      final post = Post.fromJson({'id': 'p2', 'seq': 2, 'text': 'Body', 'status': 'draft'});

      state.startEditing(post);
      final first = state.composeRequest;
      state.startEditing(post);

      // Otherwise "edit" does nothing when you are already on that draft but
      // have since navigated to another tab.
      expect(state.composeRequest, greaterThan(first));
    });

    test('stopEditing clears the target', () async {
      final state = await buildState();
      state.startEditing(Post.fromJson({'id': 'p2', 'seq': 2, 'text': 'Body', 'status': 'draft'}));
      state.stopEditing();
      expect(state.editing, isNull);
    });
  });

  group('scheduling state on a post', () {
    Post post(Map<String, dynamic> extra) => Post.fromJson({
          'id': 'p1',
          'seq': 1,
          'text': 'Body text long enough to be a post.',
          'status': 'draft',
          ...extra,
        });

    final future = DateTime.now().toUtc().add(const Duration(minutes: 12));
    final past = DateTime.now().toUtc().subtract(const Duration(minutes: 5));

    test('an unscheduled draft is not scheduled and never overdue', () {
      final p = post({});
      expect(p.isScheduled, isFalse);
      expect(p.isOverdue, isFalse);
      expect(p.timeUntilSend, isNull);
    });

    test('a scheduled draft reports the time remaining', () {
      final p = post({'scheduledFor': future.toIso8601String()});
      expect(p.isScheduled, isTrue);
      expect(p.isCleared, isFalse);
      expect(p.timeUntilSend!.inMinutes, inInclusiveRange(10, 12));
      expect(p.isOverdue, isFalse);
    });

    test('past its time and not cleared is overdue', () {
      final p = post({'scheduledFor': past.toIso8601String()});
      expect(p.isOverdue, isTrue,
          reason: 'this is the state worth shouting about — it usually means it was never cleared');
    });

    // A published post is never overdue however long ago its time was: it went
    // out. Getting this wrong would leave every historical post flagged red.
    test('a published post is never overdue', () {
      final p = post({
        'scheduledFor': past.toIso8601String(),
        'status': 'published',
        'publishedAt': past.toIso8601String(),
      });
      expect(p.isOverdue, isFalse);
    });

    test('a missed post is never overdue either', () {
      final p = post({'scheduledFor': past.toIso8601String(), 'status': 'missed'});
      expect(p.isMissed, isTrue);
      expect(p.isOverdue, isFalse);
    });

    test('clearedAt and heldUntil are read back', () {
      final p = post({
        'scheduledFor': future.toIso8601String(),
        'clearedAt': past.toIso8601String(),
        'heldUntil': future.toIso8601String(),
      });
      expect(p.isCleared, isTrue);
      expect(p.isHeld, isTrue);
    });

    test('a slot parses its display fields', () {
      final s = PostSlot.fromJson({
        'id': 's1',
        'localTime': '09:30',
        'daysMask': 62,
        'daysLabel': 'Mon-Fri',
        'leadMinutes': 15,
        'autoPublish': false,
        'categories': ['emerging-tech'],
        'enabled': true,
      });
      expect(s.localTime, '09:30');
      expect(s.daysLabel, 'Mon-Fri');
      expect(s.leadMinutes, 15);
      expect(s.autoPublish, isFalse);
      expect(s.categories, ['emerging-tech']);
      // Absent `enabled` must read as true, not false — a slot that silently
      // defaults to disabled is a schedule that never runs.
      expect(PostSlot.fromJson({'id': 's2', 'localTime': '18:00'}).enabled, isTrue);
    });

    test('nextDue picks the soonest pending post, not the newest', () {
      final status = AppStatus.fromJson({
        'initialized': true,
        'queue': [
          {
            'id': 'p9',
            'seq': 9,
            'text': 'Later today.',
            'status': 'draft',
            'scheduledFor': DateTime.now().toUtc().add(const Duration(hours: 8)).toIso8601String(),
          },
          {
            'id': 'p8',
            'seq': 8,
            'text': 'Very soon.',
            'status': 'draft',
            'scheduledFor': future.toIso8601String(),
          },
        ],
      });
      expect(status.nextDue!.seq, 8,
          reason: 'the one with the nearest deadline is the one that needs reading');
      expect(status.needingReview, 2);
    });
  });
}
