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

  static tz.TZDateTime at(DateTime instant, String id) => tz.TZDateTime.from(
    instant,
    tz.getLocation(all.contains(id) ? id : 'UTC'),
  );

  /// Same DST policy as the server: first repeated time, gaps shifted forward.
  static DateTime nextTime(String id, int hour, int minute, {DateTime? now}) {
    final instant = now ?? DateTime.now();
    final local = at(instant, id);
    for (var day = 0; day < 3; day++) {
      final date = DateTime.utc(local.year, local.month, local.day + day);
      final desired = date.add(Duration(hours: hour, minutes: minute));
      final offsets = [-1, 0, 1]
          .map((d) => at(desired.add(Duration(days: d)), id).timeZoneOffset)
          .toSet();
      final candidates = offsets.map((o) => desired.subtract(o)).toList()
        ..sort();
      bool sameDate(DateTime t) =>
          t.year == date.year && t.month == date.month && t.day == date.day;
      final exact = candidates.where((t) {
        final l = at(t, id);
        return sameDate(l) && l.hour == hour && l.minute == minute;
      }).toList();
      final shifted = candidates.where((t) {
        final l = at(t, id);
        return sameDate(l) && l.hour * 60 + l.minute > hour * 60 + minute;
      }).toList();
      final chosen = exact.isNotEmpty ? exact.first : shifted.firstOrNull;
      if (chosen != null && chosen.isAfter(instant)) return chosen;
    }
    throw StateError('Could not find the next posting time');
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
