/// Push notifications: permission, registration, and what a tap does.
///
/// The division of labour with Android is worth stating, because it is the
/// source of most confusion about FCM:
///
///   * App BACKGROUNDED or KILLED — the system draws the notification itself,
///     from the `notification` block the server sends. No Dart runs. This is
///     the case that matters: hearing that the agent stopped on a day you never
///     opened the app.
///   * App OPEN — Android draws nothing at all, by design, and hands the
///     message to [FirebaseMessaging.onMessage]. Showing it is our job, and an
///     in-app banner is the honest form for it: a system notification for
///     something you are already looking at is noise.
///
/// That second case is why there is no flutter_local_notifications here. It
/// exists to draw system notifications while the app is foregrounded, which is
/// exactly the thing we do not want.
library;

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'state/app_state.dart';

/// Destination indices, matching the order in home_screen.dart. The server
/// sends a NAME rather than a number so the two can be reordered
/// independently — which is exactly what happened when five tabs became three:
/// the queue and the timetable are one screen now, and voice and status are
/// both behind Settings. The server's vocabulary did not have to change.
const _tabs = {'queue': 0, 'schedule': 0, 'compose': 0, 'voice': 2, 'status': 2};

/// Wire up push for this session.
///
/// Called after sign-in rather than at launch: registration attaches this
/// device to the agent, and that request needs a session cookie. Never throws —
/// on a phone with notifications refused, or no Play Services, the app must
/// carry on being a perfectly good control surface.
Future<void> startPush(AppState state) async {
  try {
    final messaging = FirebaseMessaging.instance;

    // Asked once by Android; asking again after a refusal is a no-op rather
    // than a second prompt, so this is safe to call on every launch.
    final settings = await messaging.requestPermission();
    if (settings.authorizationStatus == AuthorizationStatus.denied) {
      debugPrint('[push] notifications refused — nothing will be delivered');
      return;
    }

    final token = await messaging.getToken();
    if (token != null) await state.registerDevice(token);

    // FCM rotates tokens on its own schedule and tells nobody but this stream.
    // Without it the server keeps a dead address and every alert is delivered
    // nowhere, which looks exactly like the alerts not working.
    messaging.onTokenRefresh.listen((next) {
      debugPrint('[push] token rotated — re-registering');
      state.registerDevice(next);
    });
  } catch (err) {
    debugPrint('[push] setup failed, continuing without notifications: $err');
  }
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
  @override
  void initState() {
    super.initState();

    // Arrived while the app was open. Android draws nothing in this case.
    FirebaseMessaging.onMessage.listen(_showInApp);

    // Tapped while the app was backgrounded.
    FirebaseMessaging.onMessageOpenedApp.listen(_openTab);

    // Tapped while the app was DEAD. The message that launched the app is
    // delivered once, here, and nowhere else — miss it and the tap silently
    // does nothing but open the queue.
    FirebaseMessaging.instance.getInitialMessage().then((message) {
      if (message != null) _openTab(message);
    });
  }

  void _showInApp(RemoteMessage message) {
    if (!mounted) return;

    // The message says something changed on the server, and the user is looking
    // straight at the screen that would show it. Refreshing here is what makes
    // a draft appear in the queue on its own rather than on the next pull-down.
    context.read<AppState>().refresh(quiet: true);

    final title = message.notification?.title;
    final body = message.notification?.body;
    if (title == null && body == null) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
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
        action: SnackBarAction(label: 'Show', onPressed: () => _openTab(message)),
      ),
    );
  }

  void _openTab(RemoteMessage message) {
    final tab = _tabs[message.data['tab']];
    if (tab == null || !mounted) return;
    context.read<AppState>().requestTab(tab);
    context.read<AppState>().refresh(quiet: true);
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
