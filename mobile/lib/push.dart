/// Push notifications: permission, registration, and what a tap does.
///
/// Android displays background messages through FCM. Foreground messages use
/// the native notification bridge so the test button and daily alerts also
/// appear in the notification shade while ByLine is open.
library;

import 'dart:async';
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, TargetPlatform;
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'state/app_state.dart';
import 'desktop_notifications.dart';
import 'android_notifications.dart';

/// Destination indices, matching the order in home_screen.dart. The server
/// sends a NAME rather than a number so the two can be reordered
/// independently — which is exactly what happened when five tabs became three:
/// the queue and the timetable are one screen now, and voice and status are
/// both behind Settings. The server's vocabulary did not have to change.
const _tabs = {
  'queue': 1,
  'schedule': 1,
  'compose': 0,
  'voice': 2,
  'status': 2,
};

/// Wire up push for this session.
///
/// Called after sign-in rather than at launch: registration attaches this
/// device to the agent, and that request needs a session cookie. Never throws —
/// on a phone with notifications refused, or no Play Services, the app must
/// carry on being a perfectly good control surface.
StreamSubscription<String>? _tokenSubscription;
Future<void> stopPush() async {
  await stopDesktopNotifications();
  await clearAndroidNotifications();
  await _tokenSubscription?.cancel();
  _tokenSubscription = null;
}

Future<String> startPush(AppState state, {bool askPermission = true}) async {
  if (defaultTargetPlatform == TargetPlatform.windows) {
    return startDesktopNotifications(state);
  }
  if (defaultTargetPlatform != TargetPlatform.android &&
      defaultTargetPlatform != TargetPlatform.iOS &&
      defaultTargetPlatform != TargetPlatform.macOS) {
    return 'unavailable';
  }
  try {
    final messaging = FirebaseMessaging.instance;

    // Asked once by Android; asking again after a refusal is a no-op rather
    // than a second prompt, so this is safe to call on every launch.
    final settings = askPermission
        ? await messaging.requestPermission()
        : await messaging.getNotificationSettings();
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      debugPrint('[push] notifications refused — nothing will be delivered');
      return 'denied';
    }

    final token = await messaging.getToken();
    if (token == null || !await state.registerDevice(token)) {
      return 'unavailable';
    }

    // FCM rotates tokens on its own schedule and tells nobody but this stream.
    // Without it the server keeps a dead address and every alert is delivered
    // nowhere, which looks exactly like the alerts not working.
    await _tokenSubscription?.cancel();
    _tokenSubscription = messaging.onTokenRefresh.listen((next) {
      debugPrint('[push] token rotated — re-registering');
      state.registerDevice(next);
    });
  } catch (err) {
    debugPrint('[push] setup failed, continuing without notifications: $err');
    return 'unavailable';
  }
  return 'enabled';
}

/// Shows foreground messages and routes taps. Wraps the signed-in shell.
///
/// A widget rather than a bare listener because both jobs need a
/// [BuildContext] that outlives the screens — the banner needs a Messenger, and
/// a tap has to change tabs from outside any tab.
class PushListener extends StatefulWidget {
  const PushListener({super.key, required this.child});

  final Widget child;

  @override
  State<PushListener> createState() => _PushListenerState();
}

class _PushListenerState extends State<PushListener> {
  StreamSubscription<RemoteMessage>? _foreground;
  StreamSubscription<RemoteMessage>? _opened;
  @override
  void dispose() {
    stopAndroidNotificationTaps();
    _foreground?.cancel();
    _opened?.cancel();
    super.dispose();
  }

  @override
  void initState() {
    super.initState();

    if (defaultTargetPlatform != TargetPlatform.android &&
        defaultTargetPlatform != TargetPlatform.iOS &&
        defaultTargetPlatform != TargetPlatform.macOS) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) listenAndroidNotificationTaps(_openDestination);
    });
    try {
      // Arrived while the app was open. Android draws nothing in this case.
      _foreground = FirebaseMessaging.onMessage.listen(_showInApp);

      // Tapped while the app was backgrounded.
      _opened = FirebaseMessaging.onMessageOpenedApp.listen(_openTab);

      // Tapped while the app was DEAD. The message that launched the app is
      // delivered once, here, and nowhere else — miss it and the tap silently
      // does nothing but open the queue.
      FirebaseMessaging.instance
          .getInitialMessage()
          .then((message) {
            if (message != null) _openTab(message);
          })
          .catchError((_) {});
    } catch (_) {}
  }

  Future<void> _showInApp(RemoteMessage message) async {
    if (!mounted) return;

    // The message says something changed on the server, and the user is looking
    // straight at the screen that would show it. Refreshing here is what makes
    // a draft appear in the queue on its own rather than on the next pull-down.
    context.read<AppState>().refresh(quiet: true);

    final title = message.notification?.title;
    final body = message.notification?.body;
    if (title == null && body == null) return;

    if (await showAndroidNotification(message) || !mounted) return;

    // Keep the existing banner as a fallback on other platforms or when
    // Android notifications have been disabled.
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(inAppNotification(message, onOpen: () => _openTab(message)));
  }

  void _openTab(RemoteMessage message) {
    _openDestination(message.data['tab'] as String?);
  }

  void _openDestination(String? destination) {
    final tab = _tabs[destination];
    if (tab == null || !mounted) return;
    Navigator.of(context).popUntil((route) => route.isFirst);
    context.read<AppState>().requestTab(tab);
    context.read<AppState>().refresh(quiet: true);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// The foreground fallback when an OS notification cannot be displayed.
SnackBar inAppNotification(
  RemoteMessage message, {
  required VoidCallback onOpen,
}) {
  final title = message.notification?.title;
  final body = message.notification?.body;
  return SnackBar(
    content: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (title != null)
          Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        if (body != null) Text(body, style: const TextStyle(fontSize: 13)),
      ],
    ),
    duration: const Duration(seconds: 6),
    // Flutter otherwise keeps snackbars with action buttons visible indefinitely.
    persist: false,
    action: SnackBarAction(label: 'Show', onPressed: onOpen),
  );
}
