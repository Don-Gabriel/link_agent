/**
 * Daily cadence maths, done with Intl rather than a date library.
 *
 * The agent posts once a day at a local wall-clock time. The cron ticks every
 * 15 minutes in UTC, so the only question this module answers is "when, in
 * UTC, is the next occurrence of HH:MM in the operator's timezone?".
 *
 * Known limitation, stated rather than hidden: this computes the offset from
 * the CURRENT local time, so on the two DST-transition days per year the post
 * can land an hour early or late. Asia/Kolkata — the default — has no DST at
 * all, and for a once-daily post an hour of drift twice a year is not worth a
 * dependency.
 */

export interface LocalClock {
  hour: number;
  minute: number;
  date: string; // YYYY-MM-DD in the given zone
}

export function localClock(timezone: string, at: Date = new Date()): LocalClock {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
    return {
      // Intl renders midnight as "24" in some ICU versions; normalise it.
      hour: Number(get("hour")) % 24,
      minute: Number(get("minute")),
      date: `${get("year")}-${get("month")}-${get("day")}`,
    };
  } catch {
    // An invalid timezone string must not break the scheduler.
    console.warn(`[schedule] unknown timezone "${timezone}" — falling back to UTC`);
    return {
      hour: at.getUTCHours(),
      minute: at.getUTCMinutes(),
      date: at.toISOString().slice(0, 10),
    };
  }
}

/**
 * Normalize a user-supplied time to exactly "HH:MM", or null if it is not a
 * usable time at all.
 *
 * Browsers are not consistent about what `<input type="time">` yields: a bare
 * "9:30", a seconds-bearing "18:00:00", and an empty string for a half-entered
 * value are all possible. Storing the raw string means the scheduler later
 * silently falls back to 09:30, and rejecting it without saying so means the
 * UI reports a save that never happened. So: coerce what is meaningful, and
 * return null for what is not, so the caller can answer honestly.
 */
export function normalizeHhMm(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseHhMm(hhmm: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return { hour: 9, minute: 30 };
  return {
    hour: Math.min(23, Number(match[1])),
    minute: Math.min(59, Number(match[2])),
  };
}

/**
 * The next occurrence of `hhmm` local time, as a UTC Date. Always strictly in
 * the future: asking at exactly the post time returns tomorrow, which is what
 * stops a just-completed cycle from immediately re-qualifying as due.
 */
export function nextDailyRun(timezone: string, hhmm: string, from: Date = new Date()): Date {
  const now = localClock(timezone, from);
  const target = parseHhMm(hhmm);
  let deltaMinutes = target.hour * 60 + target.minute - (now.hour * 60 + now.minute);
  if (deltaMinutes <= 0) deltaMinutes += 24 * 60;
  return new Date(from.getTime() + deltaMinutes * 60_000);
}

/** Human-readable local time, for the dashboard. */
export function formatInZone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  }
}
