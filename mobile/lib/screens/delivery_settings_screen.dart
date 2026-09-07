import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../state/app_state.dart';
import '../push.dart';
import '../widgets/experience.dart';
import '../desktop_notifications.dart';
import '../widgets/editorial.dart';
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, TargetPlatform;

class DeliverySettingsScreen extends StatefulWidget {
  const DeliverySettingsScreen({super.key});
  @override
  State<DeliverySettingsScreen> createState() => _DeliverySettingsScreenState();
}

class _DeliverySettingsScreenState extends State<DeliverySettingsScreen> {
  String? _message;
  bool _busy = false;
  Future<void> _save({bool notifications = false}) async {
    final state = context.read<AppState>();
    setState(() {
      _busy = true;
      _message = null;
    });
    final permission = notifications ? await startPush(state) : null;
    final error = await state.mutate(
      () => state.api.post('/api/review-delivery', {
        'action': 'notifications',
        'notifications': ?permission,
      }),
    );
    if (mounted) {
      setState(() {
        _busy = false;
        _message =
            error ??
            (notifications
                ? (permission == 'enabled'
                      ? 'Notifications enabled.'
                      : 'Notifications are $permission. You can still review posts in ByLine.')
                : 'Notifications updated.');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Notifications')),
      body: PageSurface(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const StudioBanner(
              compact: true,
              scene: StudioScene.routine,
              eyebrow: 'A LITTLE DAILY RHYTHM',
              title: 'Make room for your ideas.',
              caption: 'Get notified when a draft is ready in your timetable.',
            ),
            const SizedBox(height: 24),
            TextButton(
              onPressed: _busy ? null : () => _save(notifications: true),
              child: const Text('Enable notifications'),
            ),
            if (_busy) const LinearProgressIndicator(),
            TextButton(
              onPressed: _busy
                  ? null
                  : () async {
                      final state = context.read<AppState>();
                      final error =
                          defaultTargetPlatform == TargetPlatform.windows
                          ? await testDesktopNotification(state)
                          : await state.testDeviceNotification();
                      if (mounted) {
                        setState(
                          () => _message =
                              error ??
                              'Test notification sent. Check this device.',
                        );
                      }
                    },
              child: const Text('Send a test notification'),
            ),
            if (_message != null) Text(_message!),
          ],
        ),
      ),
    );
  }
}
