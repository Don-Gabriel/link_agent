/**
 * Which feeds still work.
 *
 * Discovery is deliberately forgiving: every source is fetched in its own
 * try/catch so one dead feed can never abort a cycle. That is right, and it is
 * also why a dying feed is invisible — it costs one `console.warn` per cycle in
 * a log nobody reads, while the other twenty-six carry the day. Over a year or
 * two that is how a reading list quietly halves with no alert ever firing.
 *
 * So each fetch records its outcome here, and the watchdog reads it. Nothing in
 * this file can fail a cycle: every function swallows its own errors, because
 * bookkeeping about the quality of discovery must never stop discovery.
 */
import { query } from "./db";

/**
 * Consecutive failures before a feed is called dead.
 *
 * High enough to ride out a transient outage — a cycle runs a few times a day,
 * so this is roughly two days of continuous failure — and low enough to notice
 * within a week. A single 500 or one timeout must never raise an alarm.
 */
export const DEAD_AFTER_FAILURES = 6;

/** And it must also have gone this long without a single success. */
export const DEAD_AFTER_DAYS = 3;

/**
 * Record one fetch.
 *
 * `items` is how many entries were parsed, and zero counts as a failure even
 * when the HTTP request succeeded. A feed that answers 200 with something
 * unparseable is exactly as useless as one that times out, and it is the more
 * likely failure — a site redesign returns a beautiful HTML error page with a
 * 200 status. Note that parseFeed does not filter by date, so a merely QUIET
 * blog still returns its old entries; zero really does mean broken.
 */
export async function recordFeedResult(
  name: string,
  outcome: { ok: true; items: number } | { ok: false; error: string },
): Promise<void> {
  try {
    const good = outcome.ok && outcome.items > 0;
    if (good) {
      await query(
        `INSERT INTO feed_health (name, last_ok_at, fails_in_a_row, last_error, updated_at)
         VALUES ($1, now(), 0, NULL, now())
         ON CONFLICT (name) DO UPDATE
            SET last_ok_at = now(), fails_in_a_row = 0, last_error = NULL, updated_at = now()`,
        [name],
      );
      return;
    }
    const detail = outcome.ok ? "fetched but nothing could be parsed" : outcome.error.slice(0, 200);
    await query(
      `INSERT INTO feed_health (name, last_failed_at, fails_in_a_row, last_error, updated_at)
       VALUES ($1, now(), 1, $2, now())
       ON CONFLICT (name) DO UPDATE
          SET last_failed_at = now(),
              fails_in_a_row = feed_health.fails_in_a_row + 1,
              last_error = $2,
              updated_at = now()`,
      [name, detail],
    );
  } catch (err) {
    console.warn("[feeds] could not record health:", String((err as Error)?.message ?? err));
  }
}

export interface DeadFeed {
  name: string;
  failsInARow: number;
  lastOkAt: string | null;
  lastError: string | null;
}

/**
 * Feeds that have failed long enough to be worth mentioning.
 *
 * Both conditions must hold. Consecutive failures alone would fire during any
 * long outage at one host; "no success for days" alone would flag a feed that
 * simply has not been consulted, because the categories it serves are switched
 * off. A feed nobody fetches is not a broken feed.
 */
export async function deadFeeds(): Promise<DeadFeed[]> {
  try {
    const rows = await query<{
      name: string;
      fails_in_a_row: number;
      last_ok_at: Date | null;
      last_error: string | null;
    }>(
      `SELECT name, fails_in_a_row, last_ok_at, last_error
         FROM feed_health
        WHERE fails_in_a_row >= $1
          AND (last_ok_at IS NULL OR last_ok_at < now() - ($2 || ' days')::interval)
        ORDER BY fails_in_a_row DESC`,
      [DEAD_AFTER_FAILURES, String(DEAD_AFTER_DAYS)],
    );
    return rows.map((r) => ({
      name: r.name,
      failsInARow: r.fails_in_a_row,
      lastOkAt: r.last_ok_at?.toISOString() ?? null,
      lastError: r.last_error,
    }));
  } catch (err) {
    console.warn("[feeds] could not read health:", String((err as Error)?.message ?? err));
    return [];
  }
}
