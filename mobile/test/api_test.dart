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
    test('approve sends PATCH /api/posts/<seq> with action publish', () async {
      final state = await buildState();
      await state.approve(7);

      final call = calls.first;
      expect(call.method, 'PATCH', reason: 'the route exports PATCH; POST returns 405');
      expect(call.path, '/api/posts/7');
      expect(call.body['action'], 'publish');
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
      await state.approve(1);
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
}
