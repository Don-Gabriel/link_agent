/** Local wall-clock scheduling with DST gap and repeated-time handling. */

export interface LocalClock {
  hour: number;
  minute: number;
  date: string; // YYYY-MM-DD in the given zone
  /** 0 = Sunday, matching JS getDay() and Postgres EXTRACT(DOW). */
  weekday: number;
}

/**
 * Whether Intl recognises this timezone name.
 *
 * Exists because Postgres is far less forgiving than the rest of this codebase:
 * `now() AT TIME ZONE $1` THROWS on an unknown zone rather than falling back,
 * so a nonsense value stored in agents.timezone would turn a cap check into a
 * 500 and block publishing entirely. Everything that hands a zone to SQL runs
 * it through safeTimeZone first.
 */
export function isValidTimeZone(timezone: string): boolean {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** The zone if usable, otherwise UTC. Never throws, always safe for SQL. */
export function safeTimeZone(timezone: string | null | undefined): string {
  return timezone && isValidTimeZone(timezone) ? timezone : "UTC";
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
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    return {
      // Intl renders midnight as "24" in some ICU versions; normalise it.
      hour: Number(get("hour")) % 24,
      minute: Number(get("minute")),
      date,
      // Read the weekday off the LOCAL calendar date rather than asking Intl for
      // it separately: parsing "YYYY-MM-DD" as UTC and taking getUTCDay() is
      // locale-independent, where a formatted weekday name would need mapping
      // and would break under a non-English default locale.
      weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    };
  } catch {
    // An invalid timezone string must not break the scheduler.
    console.warn(`[schedule] unknown timezone "${timezone}" — falling back to UTC`);
    return {
      hour: at.getUTCHours(),
      minute: at.getUTCMinutes(),
      date: at.toISOString().slice(0, 10),
      weekday: at.getUTCDay(),
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
  return nextSlotRun(timezone, hhmm, 127, from)!;
}

// ------------------------------------------------------------------ weekdays

/** Every day. */
export const MASK_DAILY = 0b1111111;
/** Monday to Friday — the default, because 3 posts × 7 days is 21 a week. */
export const MASK_WEEKDAYS = 0b0111110;
/** Saturday and Sunday. */
export const MASK_WEEKENDS = 0b1000001;

export function isDayEnabled(daysMask: number, weekday: number): boolean {
  return (daysMask & (1 << weekday)) !== 0;
}

/** Coerce anything into a usable mask. An empty mask would never fire, so it becomes daily. */
export function parseDaysMask(v: unknown): number {
  const n = typeof v === "number" ? Math.round(v) : Number(v);
  if (!Number.isFinite(n)) return MASK_WEEKDAYS;
  const masked = n & MASK_DAILY;
  return masked === 0 ? MASK_DAILY : masked;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon-Fri", "Every day", "Mon, Wed, Fri" — for the UI and for logs. */
export function describeDays(daysMask: number): string {
  const mask = parseDaysMask(daysMask);
  if (mask === MASK_DAILY) return "Every day";
  if (mask === MASK_WEEKDAYS) return "Mon-Fri";
  if (mask === MASK_WEEKENDS) return "Weekends";
  return DAY_NAMES.filter((_, i) => isDayEnabled(mask, i)).join(", ");
}

/**
 * The next occurrence of `hhmm` local time on a weekday the mask allows, as a
 * UTC Date. Always strictly in the future.
 *
 * Generalises nextDailyRun. The loop re-derives the local clock for each
 * candidate day rather than assuming 24-hour days, so a DST transition shifts
 * the UTC offset while preserving the chosen local posting time.
 *
 * Returns null only if the mask is empty, which parseDaysMask makes impossible.
 */
export function nextSlotRun(
  timezone: string,
  hhmm: string,
  daysMask: number,
  from: Date = new Date(),
): Date | null {
  const mask = parseDaysMask(daysMask);
  const zone = safeTimeZone(timezone);
  const now = localClock(zone, from);

  const midnight = Date.parse(`${now.date}T00:00:00Z`);
  for (let day = 0; day < 9; day++) {
    const calendar = new Date(midnight + day * 86400000);
    if (!isDayEnabled(mask, calendar.getUTCDay())) continue;
    const date = calendar.toISOString().slice(0,10);
    const candidate = slotOnDate(zone,hhmm,date);
    if (candidate && candidate.getTime()>from.getTime()) return candidate;
  }
  return null;
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

/** One local calendar date: ambiguous times use the first occurrence; gaps move forward. */
export function slotOnDate(timezone:string,hhmm:string,date:string):Date|null {
  const zone=safeTimeZone(timezone),target=parseHhMm(hhmm);
  const desired = Date.parse(`${date}T00:00:00Z`) + (target.hour * 60 + target.minute) * 60000;
  const offsets = new Set<number>();
  for (const delta of [-86400000,0,86400000]) {
    const instant = new Date(desired + delta);
    const l = localClock(zone,instant);
    offsets.add(Date.parse(`${l.date}T00:00:00Z`) + (l.hour*60+l.minute)*60000 - instant.getTime());
  }
  const possible = [...offsets].map(o=>new Date(desired-o)).sort((a,b)=>a.getTime()-b.getTime());
  const exact = possible.filter(t=> {const l=localClock(zone,t);return l.date===date&&l.hour===target.hour&&l.minute===target.minute;});
  // Repeated times run once at the earlier instant; missing times move forward by the DST gap.
  const candidate = exact[0] ?? possible.find(t=> {const l=localClock(zone,t);return l.date===date&&l.hour*60+l.minute>target.hour*60+target.minute;});
  return candidate??null;
}
