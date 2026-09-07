import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:linkdin_mobile/android_notifications.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('byline/notifications');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  final calls = <MethodCall>[];
  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    calls.clear();
    messenger.setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return call.method == 'show' ? true : null;
    });
  });
  tearDown(() {
    stopAndroidNotificationTaps();
    messenger.setMockMethodCallHandler(channel, null);
    debugDefaultTargetPlatformOverride = null;
  });

  const message = RemoteMessage(
    data: {'kind': 'test', 'tab': 'status'},
    notification: RemoteNotification(
      title: 'Notifications are working',
      body: 'Test message',
      android: AndroidNotification(channelId: 'linkdin_alerts', tag: 'test'),
    ),
  );
  test(
    'received foreground push keeps its channel, grouping and destination',
    () async {
      expect(await showAndroidNotification(message), isTrue);
      expect(calls.single.arguments, {
        'title': 'Notifications are working',
        'body': 'Test message',
        'channel': 'linkdin_alerts',
        'tag': 'test',
        'tab': 'status',
      });
    },
  );
  test(
    'data-only and non-Android messages do not create duplicate notifications',
    () async {
      expect(
        await showAndroidNotification(
          const RemoteMessage(data: {'tab': 'queue'}),
        ),
        isFalse,
      );
      debugDefaultTargetPlatformOverride = TargetPlatform.windows;
      expect(await showAndroidNotification(message), isFalse);
      expect(calls, isEmpty);
    },
  );
  test(
    'blocked or unavailable platform notifications allow the banner fallback',
    () async {
      messenger.setMockMethodCallHandler(channel, (_) async => false);
      expect(await showAndroidNotification(message), isFalse);
      messenger.setMockMethodCallHandler(
        channel,
        (_) async => throw PlatformException(code: 'denied'),
      );
      expect(await showAndroidNotification(message), isFalse);
    },
  );
  test('cold notification tap is consumed when listener starts', () async {
    messenger.setMockMethodCallHandler(
      channel,
      (call) async => call.method == 'takePendingTab' ? 'queue' : null,
    );
    final tabs = <String>[];
    await listenAndroidNotificationTaps(tabs.add);
    expect(tabs, ['queue']);
    await clearAndroidNotifications();
  });
}
