import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

const _channel = MethodChannel('byline/notifications');

/// Only called for onMessage. FCM displays background messages itself.
Future<bool> showAndroidNotification(RemoteMessage message) async {
  if (defaultTargetPlatform != TargetPlatform.android ||
      message.notification == null) {
    return false;
  }
  try {
    return await _channel.invokeMethod<bool>('show', {
          'title': message.notification!.title,
          'body': message.notification!.body,
          'channel': message.notification!.android?.channelId,
          'tag': message.notification!.android?.tag ?? message.data['kind'],
          'tab': message.data['tab'],
        }) ??
        false;
  } on PlatformException {
    return false;
  } on MissingPluginException {
    return false;
  }
}

Future<void> listenAndroidNotificationTaps(void Function(String) onTap) async {
  if (defaultTargetPlatform != TargetPlatform.android) return;
  Future<void> consume() async {
    try {
      final tab = await _channel.invokeMethod<String>('takePendingTab');
      if (tab != null) onTap(tab);
    } on PlatformException {
      // Keep the app usable when platform delivery is unavailable.
    } on MissingPluginException {
      // Older native binaries and widget tests have no notification bridge.
    }
  }

  _channel.setMethodCallHandler((call) async {
    if (call.method == 'notificationOpened') await consume();
  });
  await consume();
}

void stopAndroidNotificationTaps() {
  if (defaultTargetPlatform == TargetPlatform.android) {
    _channel.setMethodCallHandler(null);
  }
}

Future<void> clearAndroidNotifications() async {
  if (defaultTargetPlatform != TargetPlatform.android) return;
  try {
    await _channel.invokeMethod<void>('clear');
  } on PlatformException {
    // Logout must succeed even if the notification service is unavailable.
  } on MissingPluginException {
    // Older native binaries and widget tests.
  }
}
