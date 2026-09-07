import 'dart:async';
import 'package:flutter_local_notifications_windows/flutter_local_notifications_windows.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'state/app_state.dart';

FlutterLocalNotificationsWindows? _notifications;
Timer? _poll;
int _generation = 0;

Future<void> stopDesktopNotifications() async {
  _generation++;
  _poll?.cancel();
  _poll = null;
}

Future<String> startDesktopNotifications(AppState state) async {
  await stopDesktopNotifications();
  final generation = _generation;
  try {
    final notifications = _notifications ??= FlutterLocalNotificationsWindows();
    final initialized = await notifications.initialize(
      settings: const WindowsInitializationSettings(
        appName: 'ByLine',
        appUserModelId: 'ByLine.Desktop.App',
        guid: '36dfb7ac-09e9-4b91-97a6-81a7a1252b7d',
      ),
      onDidReceiveNotificationResponse: (_) {
        if (state.phase == AuthPhase.signedIn) {
          state.requestTab(1);
          state.refresh(quiet: true);
        }
      },
    );
    if (!initialized) return 'unavailable';
    final prefs = await SharedPreferences.getInstance();
    final key = 'desktop-notified:${state.baseUrl}:${state.agent?.agentId}';
    final seen = (prefs.getStringList(key) ?? []).toSet();
    bool busy = false;
    Future<void> tick() async {
      if (busy ||
          generation != _generation ||
          state.phase != AuthPhase.signedIn) {
        return;
      }
      busy = true;
      try {
        await state.refresh(quiet: true);
        if (generation != _generation || state.phase != AuthPhase.signedIn) {
          return;
        }
        final fresh =
            state.status?.queue
                .where((p) => p.isDraft && !p.isCleared && !seen.contains(p.id))
                .toList() ??
            [];
        if (fresh.isNotEmpty) {
          final post = fresh.first;
          await notifications.show(
            id: post.seq,
            title: 'A post is ready in ByLine',
            body: post.hook.isEmpty
                ? 'Open ByLine to approve, edit or skip.'
                : post.hook,
            payload: 'queue',
          );
          seen.addAll(fresh.map((p) => p.id));
          await prefs.setStringList(
            key,
            seen.toList().reversed.take(500).toList(),
          );
        }
      } catch (_) {
        /* Next poll retries after temporary network or notification failures. */
      } finally {
        busy = false;
      }
    }

    _poll = Timer.periodic(const Duration(seconds: 30), (_) => tick());
    unawaited(tick());
    return 'enabled';
  } catch (_) {
    return 'unavailable';
  }
}

Future<String?> testDesktopNotification(AppState state) async {
  if (await startDesktopNotifications(state) != 'enabled') {
    return 'Windows notifications are unavailable.';
  }
  try {
    await _notifications!.show(
      id: 0,
      title: 'ByLine notifications are working',
      body: 'Keep ByLine open or minimized to receive new draft alerts.',
    );
    return null;
  } catch (_) {
    return 'Windows could not display the notification. Check notification settings.';
  }
}
