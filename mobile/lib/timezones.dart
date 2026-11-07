import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/data/latest_all.dart' as data;
import 'package:timezone/timezone.dart' as tz;

/// Full offline IANA database, including aliases used by Android devices.
class Timezones {
  static final List<String> all = _load();

  static List<String> _load() {
    data.initializeTimeZones();
    return List.unmodifiable(
      tz.timeZoneDatabase.locations.keys.where((id) => id != 'Factory').toList()
        ..sort(),
    );
  }

  static String label(String id) {
    if (id == 'UTC' || id == 'Etc/UTC') return 'Coordinated Universal Time';
    final parts = id.replaceAll('_', ' ').split('/');
    return parts.length == 1
        ? parts.first
        : '${parts.last} · ${parts.take(parts.length - 1).join(' / ')}';
  }

  static String offset(String id, {DateTime? at}) {
    if (!all.contains(id)) return '';
    final minutes = tz.TZDateTime.from(
      at ?? DateTime.now(),
      tz.getLocation(id),
    ).timeZoneOffset.inMinutes;
    final magnitude = minutes.abs();
    return 'UTC${minutes < 0 ? '-' : '+'}${(magnitude ~/ 60).toString().padLeft(2, '0')}:${(magnitude % 60).toString().padLeft(2, '0')}';
  }

  static Future<String?> device() async {
    try {
      final zone = await FlutterTimezone.getLocalTimezone().timeout(
        const Duration(seconds: 3),
      );
      return all.contains(zone.identifier) ? zone.identifier : null;
    } catch (_) {
      return null;
    }
  }
}
