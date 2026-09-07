import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:linkdin_mobile/auth_return.dart';

void main() {
  test(
    'loopback return rejects unrelated requests and signals only once',
    () async {
      var returned = 0;
      final listener = await LoopbackAuthReturn.start(
        onReturn: () async {
          returned++;
        },
      );
      final client = HttpClient();
      Future<int> get(Uri uri, {String? host}) async {
        final req = await client.getUrl(uri);
        if (host != null) req.headers.set(HttpHeaders.hostHeader, host);
        final res = await req.close();
        await res.drain<void>();
        return res.statusCode;
      }

      try {
        expect(listener.uri.host, '127.0.0.1');
        expect(listener.uri.pathSegments.last.length, 43);
        expect(await get(listener.uri.replace(path: '/unrelated')), 404);
        expect(await get(listener.uri, host: 'external.example'), 404);
        expect(
          await get(listener.uri.replace(query: 'token=not-accepted')),
          404,
        );
        expect(returned, 0);
        expect(await get(listener.uri), 200);
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(returned, 1);
        expect(await get(listener.uri), 200);
        expect(returned, 1);
      } finally {
        client.close(force: true);
        await listener.close();
      }
    },
  );
}
