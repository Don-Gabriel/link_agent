/// HTTP client for the Next.js backend.
///
/// The backend authenticates with an httpOnly session cookie (`lc_session`,
/// set by POST /api/auth) and gates every /api/* route in middleware.ts. That
/// design assumes a browser, so this client does the browser's job by hand:
/// capture Set-Cookie on login, persist it, and attach it to every later
/// request. Nothing on the server had to change for the app to work.
///
/// This is deliberately the shape of a temporary arrangement. A single shared
/// password is not a real multi-user auth story, and when the backend grows
/// bearer tokens only [_authHeaders] and [logIn] should need to change.
library;

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart' show MediaType;
import 'package:shared_preferences/shared_preferences.dart';

/// LinkedIn accepts JPG, PNG and GIF; /api/media enforces exactly those.
/// image_picker re-encodes to JPEG when it downscales, so anything unfamiliar
/// is far more likely to be a jpeg than something exotic.
String _imageSubtype(String path) {
  final ext = path.toLowerCase().split('.').last;
  return switch (ext) {
    'png' => 'png',
    'gif' => 'gif',
    _ => 'jpeg',
  };
}

/// Hard ceiling on every request.
///
/// package:http has NO default timeout, so a request to an address that
/// silently goes nowhere — the emulator's 10.0.2.2 typed into a real phone,
/// a dead tunnel, a sleeping laptop — hangs until the OS gives up, which can
/// be minutes. An infinite spinner with no error is the worst failure mode a
/// client can have: it looks identical to "still loading".
///
/// Generous rather than snappy on purpose: /api/status assembles the whole
/// dashboard and takes ~9s against a cold Neon free-tier database.
const Duration _kTimeout = Duration(seconds: 30);

/// For requests that sit in front of a language model.
///
/// Thirty seconds is right for reading state and wrong for writing prose. A
/// follow-up is two database reads and then up to TWO model calls — one to
/// write, and one to repair the draft when it misses the author's word range or
/// hashtag count, which on a narrow range is most of the time. That routinely
/// runs past thirty seconds, and the client was giving up while the server was
/// still working: the post got written and thrown away.
///
/// Longer than the server's own 120s ceiling on those routes, deliberately. If
/// something really is stuck, the useful error is the server's — "the writer
/// returned nothing usable" — not a client-side stopwatch that says only that
/// the phone stopped listening.
const Duration kWriterTimeout = Duration(seconds: 135);

/// Thrown for any non-2xx response, carrying the server's own error string so
/// the UI can show the real reason instead of "something went wrong".
class ApiException implements Exception {
  ApiException(this.status, this.error, {this.detail});

  final int status;
  final String error;
  final String? detail;

  bool get isUnauthorized => status == 401;

  @override
  String toString() => detail == null || detail!.isEmpty ? error : '$error — $detail';
}

class ApiClient {
  ApiClient._(this._prefs, this._http);

  static const _kBaseUrl = 'base_url';
  static const _kCookie = 'session_cookie';

  /// The Android emulator reaches the host machine on this address; `localhost`
  /// inside the emulator is the emulated device itself. Getting this wrong is
  /// the single most common way a first run fails, so it is the default.
  static const defaultBaseUrl = 'http://10.0.2.2:3000';

  final SharedPreferences _prefs;
  final http.Client _http;

  /// [httpClient] is injectable so tests can assert the METHOD and PATH of
  /// every call. Without it the whole transport layer is untestable, and a
  /// wrong verb — POST where the route exports PATCH — is invisible until a
  /// button 405s in someone's hand. That has already happened once.
  static Future<ApiClient> create({http.Client? httpClient}) async =>
      ApiClient._(await SharedPreferences.getInstance(), httpClient ?? http.Client());

  String get baseUrl => _prefs.getString(_kBaseUrl) ?? defaultBaseUrl;
  Future<void> setBaseUrl(String value) async {
    var v = value.trim();
    while (v.endsWith('/')) {
      v = v.substring(0, v.length - 1);
    }
    await _prefs.setString(_kBaseUrl, v);
  }

  String? get _cookie => _prefs.getString(_kCookie);
  bool get hasSession => (_cookie ?? '').isNotEmpty;

  Map<String, String> get _authHeaders => {
        'Content-Type': 'application/json',
        if (hasSession) 'Cookie': _cookie!,
      };

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  /// Pull `lc_session` out of Set-Cookie and keep only the name=value pair —
  /// the attributes (Path, HttpOnly, SameSite) are instructions for a browser
  /// and must not be echoed back on the request.
  Future<void> _captureCookie(http.Response res) async {
    final raw = res.headers['set-cookie'];
    if (raw == null) return;
    final match = RegExp(r'lc_session=([^;]*)').firstMatch(raw);
    if (match == null) return;
    final value = match.group(1) ?? '';
    if (value.isEmpty) return;
    await _prefs.setString(_kCookie, 'lc_session=$value');
  }

  Never _fail(http.Response res) {
    String error = 'http_${res.statusCode}';
    String? detail;
    try {
      final body = jsonDecode(res.body);
      if (body is Map<String, dynamic>) {
        error = (body['error'] as String?) ?? error;
        detail = body['detail'] as String?;
      }
    } catch (_) {
      // A non-JSON body means we probably hit something other than the API —
      // a proxy, a tunnel login page, the wrong port. Say so plainly.
      detail = res.body.isEmpty ? null : 'Non-JSON response from $baseUrl';
    }
    throw ApiException(res.statusCode, error, detail: detail);
  }

  Future<dynamic> _send(Future<http.Response> Function() run, {Duration? timeout}) async {
    final limit = timeout ?? _kTimeout;
    final http.Response res;
    try {
      res = await run().timeout(limit);
    } on TimeoutException {
      throw ApiException(0, 'timeout',
          detail: 'No response from $baseUrl after ${limit.inSeconds}s. '
              'On a real phone use http://localhost:3000 with `adb reverse tcp:3000 tcp:3000` '
              '— 10.0.2.2 only works on an emulator.');
    } on Exception catch (e) {
      // Connection-level failures are the common case during setup (wrong host,
      // server not running, cleartext blocked) and deserve an actionable message.
      throw ApiException(0, 'connection_failed', detail: '$baseUrl — $e');
    }
    if (res.statusCode < 200 || res.statusCode >= 300) _fail(res);
    if (res.body.isEmpty) return null;
    return jsonDecode(res.body);
  }

  Future<dynamic> get(String path) => _send(() => _http.get(_uri(path), headers: _authHeaders));

  Future<dynamic> post(String path, [Map<String, dynamic>? body, Duration? timeout]) =>
      _send(() => _http.post(_uri(path), headers: _authHeaders, body: jsonEncode(body ?? {})),
          timeout: timeout);

  Future<dynamic> patch(String path, Map<String, dynamic> body, {Duration? timeout}) =>
      _send(() => _http.patch(_uri(path), headers: _authHeaders, body: jsonEncode(body)),
          timeout: timeout);

  Future<dynamic> delete(String path) =>
      _send(() => _http.delete(_uri(path), headers: _authHeaders));

  /// Upload one image and return its media asset id.
  ///
  /// Multipart rather than JSON because /api/media reads `request.formData()`.
  /// The server caps the body at 4MB and the LinkedIn hop needs the member
  /// token, so bytes go through the server rather than straight to LinkedIn —
  /// the caller is responsible for having downscaled first.
  Future<String> uploadImage(String path, {String altText = ''}) async {
    // The content type MUST be set explicitly. MultipartFile.fromPath defaults
    // to application/octet-stream, and /api/media checks the declared type
    // against {jpeg, png, gif} — so a perfectly valid JPEG is rejected 400
    // "unsupported_type" purely because nobody said what it was.
    final request = http.MultipartRequest('POST', _uri('/api/media'))
      ..headers.addAll({if (hasSession) 'Cookie': _cookie!})
      ..fields['altText'] = altText
      ..files.add(await http.MultipartFile.fromPath(
        'file',
        path,
        contentType: MediaType('image', _imageSubtype(path)),
      ));

    final http.Response res;
    try {
      // _http.send, NOT request.send(): BaseRequest.send() quietly constructs
      // its own Client, bypassing the one this class was given — which makes
      // the upload path untestable and ignores any client-level configuration.
      final streamed = await _http.send(request).timeout(_kTimeout);
      res = await http.Response.fromStream(streamed);
    } on TimeoutException {
      throw ApiException(0, 'timeout', detail: 'Upload timed out after ${_kTimeout.inSeconds}s.');
    } on Exception catch (e) {
      throw ApiException(0, 'upload_failed', detail: '$e');
    }
    if (res.statusCode < 200 || res.statusCode >= 300) _fail(res);

    final body = jsonDecode(res.body);
    final id = body is Map ? body['id'] : null;
    if (id is! String) {
      throw ApiException(res.statusCode, 'upload_failed', detail: 'No media id in the response.');
    }
    return id;
  }

  /// Exchange the shared password for a session cookie.
  Future<void> logIn(String password) async {
    final http.Response res;
    try {
      res = await _http
          .post(
            _uri('/api/auth'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'password': password}),
          )
          .timeout(_kTimeout);
    } on TimeoutException {
      throw ApiException(0, 'timeout',
          detail: 'No response from $baseUrl after ${_kTimeout.inSeconds}s. '
              'Check the server address and that `npm run dev` is running.');
    } on Exception catch (e) {
      throw ApiException(0, 'connection_failed', detail: '$baseUrl — $e');
    }
    if (res.statusCode < 200 || res.statusCode >= 300) _fail(res);
    await _captureCookie(res);
    if (!hasSession) {
      // A 200 with no usable cookie means something between us and the server
      // stripped it. Failing loudly here beats an app that looks logged in and
      // then 401s on every screen.
      throw ApiException(200, 'no_session_cookie',
          detail: 'The server accepted the password but returned no session cookie.');
    }
  }

  Future<void> logOut() async {
    try {
      await _http.delete(_uri('/api/auth'), headers: _authHeaders);
    } on Exception {
      // Local sign-out must succeed even with no network.
    }
    await _prefs.remove(_kCookie);
  }

  /// Drop the session without calling the server — used when a request comes
  /// back 401 and the stored cookie is known to be dead.
  Future<void> clearSession() => _prefs.remove(_kCookie);
}
