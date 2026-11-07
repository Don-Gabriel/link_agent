import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:linkdin_mobile/auth_browser.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('byline/auth_browser');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  setUp(() => debugDefaultTargetPlatformOverride = TargetPlatform.android);
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    messenger.setMockMethodCallHandler(channel, null);
  });
  test(
    'Android sends the complete OAuth URL to the browser-only bridge',
    () async {
      MethodCall? received;
      messenger.setMockMethodCallHandler(channel, (call) async {
        received = call;
        return true;
      });
      final uri = Uri.parse(
        'https://www.linkedin.com/oauth/v2/authorization?state=abc%2Bdef&redirect_uri=https%3A%2F%2Fbyline.example%2Fcallback',
      );
      expect(await openAuthBrowser(uri), isTrue);
      expect(received!.method, 'open');
      expect(received!.arguments, {'url': uri.toString()});
    },
  );
  test(
    'rejects non-HTTPS, credentials and hostless links without launching',
    () async {
      var calls = 0;
      messenger.setMockMethodCallHandler(channel, (_) async {
        calls++;
        return true;
      });
      for (final url in [
        'http://linkedin.com',
        'intent://auth',
        'https:missing',
        'https://user:password@linkedin.com',
      ]) {
        expect(await openAuthBrowser(Uri.parse(url)), isFalse);
      }
      expect(calls, 0);
    },
  );
  test(
    'missing browser or platform failure cannot fall back to provider app',
    () async {
      final uri = Uri.parse('https://www.linkedin.com/oauth/v2/authorization');
      messenger.setMockMethodCallHandler(channel, (_) async => false);
      expect(await openAuthBrowser(uri), isFalse);
      messenger.setMockMethodCallHandler(
        channel,
        (_) async => throw PlatformException(code: 'unavailable'),
      );
      expect(await openAuthBrowser(uri), isFalse);
      messenger.setMockMethodCallHandler(channel, null);
      expect(await openAuthBrowser(uri), isFalse);
    },
  );
}
