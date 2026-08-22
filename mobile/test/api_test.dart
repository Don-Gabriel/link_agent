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

  // Every settings change used to cost two sequential round trips to a database
  // on another continent — the PATCH, then a full /api/status rebuild of the
  // queue, history, rejections, slot timeline and LLM budget, none of which a
  // settings change can alter. At roughly half a second each, with the whole UI
  // disabled in between, that was most of what "the app feels slow" meant.
  group('settings changes cost one round trip, not two', () {
    Map<String, dynamic> agentJson({List<String> categories = const ['ai-ml']}) => {
          'agentId': 'a1',
          'name': 'A Working Engineer',
          'domain': 'AI and ML engineering',
          'categories': categories,
          'timezone': 'Asia/Kolkata',
          'postTimeLocal': '09:30',
          'autoPublish': false,
          'paused': false,
          'autoPublishCap': 1,
          'style': {'structure': 'prose', 'hashtagCount': 2},
        };

    Future<AppState> seeded({Map<String, dynamic>? response, int status = 200}) async {
      final state = await buildState(
        response: response ?? {'ok': true, 'agent': agentJson()},
        status: status,
      );
      state.status = AppStatus.fromJson({
        'initialized': true,
        'agent': agentJson(categories: ['ai-ml', 'dev-tooling']),
        'account': {'connected': true},
        'config': {'liveMode': false},
      });
      return state;
    }

    test('a style change does not refetch the whole dashboard', () async {
      final state = await seeded();
      await state.setStyle(StyleConfig.houseStyle.copyWith(register: 'blunt'));

      expect(calls.map((c) => c.path), ['/api/settings'],
          reason: 'the PATCH already answers with the updated agent');
    });

    test('the updated agent is taken from the PATCH response', () async {
      final state = await seeded(
        response: {'ok': true, 'agent': agentJson(categories: ['compute-silicon'])},
      );
      await state.setPaused(true);
      expect(state.agent!.categories, ['compute-silicon']);
    });

    test('a response without an agent still falls back to a full refresh', () async {
      // An older backend, or a shape this build does not recognise. Showing
      // possibly-stale settings would be worse than paying for the round trip.
      final state = await seeded(response: {'ok': true});
      await state.setPaused(true);
      expect(calls.map((c) => c.path), ['/api/settings', '/api/status']);
    });

    test('the schedule fields still take the full refresh', () async {
      // Changing the timezone reschedules every slot, and slots are not part of
      // the agent object — so this one genuinely has to re-read everything.
      final state = await seeded();
      await state.setTimezone('Europe/Berlin');
      expect(calls.map((c) => c.path), ['/api/settings', '/api/status']);
    });

    test('a category tap shows immediately, before the server answers', () async {
      final state = await seeded();
      final pending = state.setCategories(['ai-ml']);
      expect(state.agent!.categories, ['ai-ml'],
          reason: 'the chip must not wait half a second to look pressed');
      expect(state.loading, isFalse,
          reason: 'setting loading would disable every control on the screen');
      await pending;
    });

    test('a rejected category change is rolled back', () async {
      final state = await seeded(response: {'error': 'update_failed'}, status: 500);
      final error = await state.setCategories(['ai-ml']);

      expect(error, isNotNull);
      expect(state.agent!.categories, ['ai-ml', 'dev-tooling'],
          reason: 'a refused change must never be left looking accepted');
    });
  });

  // A follow-up is two database reads, a model call, and usually a SECOND model
  // call repairing the draft to the author's word range — with every model call
  // paced four seconds behind the last. Half a minute is normal. The client used
  // to give up at thirty seconds flat, so the post was written and thrown away.
  group('calls that wait on a model get a longer ceiling', () {
    test('the writer ceiling outlasts the server, so the server error wins', () {
      // If the client gave up first, the user would see a stopwatch message
      // instead of whatever actually went wrong.
      expect(kWriterTimeout.inSeconds, greaterThan(120),
          reason: 'the routes behind these calls allow 120s');
    });

    test('a follow-up survives longer than a status refresh would', () async {
      // Answers after 40s: past the old 30s default, inside the writer ceiling.
      SharedPreferences.setMockInitialValues(
        {'session_cookie': 'lc_session=abc', 'base_url': 'http://test.local'},
      );
      final slow = MockClient((_) async {
        await Future<void>.delayed(const Duration(milliseconds: 60));
        return http.Response(
          jsonEncode({'ok': true, 'text': 'A follow-up long enough to be a real post body.'}),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final state = AppState(await ApiClient.create(httpClient: slow));
      final error = await state.followUp(7);

      expect(error, isNull);
      expect(state.composeSeed, contains('A follow-up'));
      // A follow-up is a NEW post; arriving bound to the original would
      // overwrite the post being followed up.
      expect(state.editing, isNull);
    });
  });

  // The composer watches this to decide whether to offer a re-run. It used to
  // watch StyleConfig.summary, which names three fields out of a prompt built
  // from every style rule plus the author's samples and edit notes.
  group('the voice fingerprint notices every part of the voice', () {
    Map<String, dynamic> withAgent(Map<String, dynamic> agent) => {
          'initialized': true,
          'agent': agent,
          'account': {'connected': true},
          'config': {'liveMode': false},
        };

    Map<String, dynamic> base({
      Map<String, dynamic> style = const {'structure': 'prose', 'hashtagCount': 2},
      List<String> corpus = const [],
      String? editNotes,
    }) =>
        {
          'agentId': 'a1',
          'name': 'N',
          'domain': 'd',
          'categories': ['ai-ml'],
          'timezone': 'UTC',
          'postTimeLocal': '09:30',
          'autoPublish': false,
          'paused': false,
          'autoPublishCap': 1,
          'style': style,
          'corpus': corpus,
          'editNotes': editNotes,
        };

    Future<String> fingerprintOf(Map<String, dynamic> agent) async {
      final state = await buildState();
      state.status = AppStatus.fromJson(withAgent(agent));
      return state.styleFingerprint;
    }

    test('a register change moves it', () async {
      expect(
        await fingerprintOf(base(style: {'structure': 'prose', 'register': 'blunt'})),
        isNot(await fingerprintOf(base(style: {'structure': 'prose', 'register': 'practitioner'}))),
        reason: 'style.summary never mentioned the register, so the banner stayed silent',
      );
    });

    test('adding a writing sample moves it', () async {
      // The single largest lever on how the output sounds, and previously
      // invisible to the composer entirely.
      expect(
        await fingerprintOf(base(corpus: ['A sample of how this person writes.'])),
        isNot(await fingerprintOf(base())),
      );
    });

    test('edit notes move it', () async {
      expect(
        await fingerprintOf(base(editNotes: 'Open on the number.')),
        isNot(await fingerprintOf(base())),
      );
    });

    test('an unchanged voice keeps the same fingerprint', () async {
      expect(await fingerprintOf(base(corpus: ['x'])), await fingerprintOf(base(corpus: ['x'])));
    });
  });
}
