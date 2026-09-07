import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:flutter/services.dart';
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, TargetPlatform;

/// A credential-free browser return signal. Authentication still uses the
/// verifier-protected API poll; visiting this URL cannot sign anyone in.
class LoopbackAuthReturn {
  LoopbackAuthReturn._(this._server, this.uri);
  final HttpServer _server;
  final Uri uri;
  Timer? _expiry;
  bool _received = false;

  static Future<LoopbackAuthReturn> start({
    required Future<void> Function() onReturn,
  }) async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final random = Random.secure();
    final nonce = base64UrlEncode(
      List.generate(32, (_) => random.nextInt(256)),
    ).replaceAll('=', '');
    final uri = Uri.parse(
      'http://127.0.0.1:${server.port}/byline-return/$nonce',
    );
    final listener = LoopbackAuthReturn._(server, uri);
    listener._expiry = Timer(const Duration(minutes: 10), listener.close);
    server.listen((request) async {
      final valid =
          request.method == 'GET' &&
          request.headers.value(HttpHeaders.hostHeader) == uri.authority &&
          request.uri.path == uri.path &&
          !request.uri.hasQuery;
      request.response.headers
        ..contentType = ContentType.html
        ..set('Cache-Control', 'no-store')
        ..set('Referrer-Policy', 'no-referrer')
        ..set(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        );
      request.response.statusCode = valid ? 200 : 404;
      request.response.write(
        valid
            ? '<!doctype html><html lang="en"><meta charset="utf-8"><title>ByLine</title><body style="font:16px/1.6 system-ui;background:#f3f2ef;color:#191919;padding:48px"><h1>Continue in ByLine</h1><p>Your browser has returned to the desktop app. You can close this tab.</p><p>If Windows kept your browser in front, select ByLine in the taskbar.</p></body></html>'
            : 'Not found',
      );
      await request.response.close();
      if (valid && !listener._received) {
        listener._received = true;
        try {
          await onReturn();
        } finally {
          listener._expiry?.cancel();
          listener._expiry = Timer(const Duration(seconds: 3), listener.close);
        }
      }
    });
    return listener;
  }

  Future<void> close() async {
    _expiry?.cancel();
    await _server.close(force: true);
  }
}

LoopbackAuthReturn? _activeReturn;

Future<String?> prepareDesktopAuthReturn({
  Future<void> Function()? onReturn,
}) async {
  if (defaultTargetPlatform != TargetPlatform.windows) return null;
  await _activeReturn?.close();
  _activeReturn = await LoopbackAuthReturn.start(
    onReturn: () async {
      try {
        await const MethodChannel('byline/window').invokeMethod<void>('show');
      } on MissingPluginException {
        // Older runners can still complete sign-in through polling.
      }
      await onReturn?.call();
    },
  );
  return _activeReturn!.uri.toString();
}

Future<void> cancelDesktopAuthReturn() async {
  await _activeReturn?.close();
  _activeReturn = null;
}
