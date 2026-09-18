/**
 * Delete rows that have stopped being worth keeping.
 *
 * Most tables here are bounded by their own shape — llm_calls holds one row per
 * model per day, slot_runs one per slot per day — and would take decades to
 * matter. `rejections` is the exception and the reason this file exists: a
 * cycle judges twenty to forty candidates and writes a row for every one it
 * turns down, several times a day, forever. That is the fastest-growing table
 * in the system by two orders of magnitude, and nothing was removing any of it.
 *
 * None of this is urgent in gigabytes. It matters because the alternative is a
 * free-tier database that fills up in some year nobody is thinking about, and
 * the failure that produces — writes refused — looks like the whole app broken.
 *
 * What is NOT swept, deliberately:
 *   - posts: the archive is the point, and the writer reads it for voice.
 *   - distributions: the publish idempotency record. Deleting one could let a
 *     post be sent twice, which is the single worst outcome this app has.
 *   - agents, post_slots, linkedin_accounts: configuration, not history.
 */
import { query } from "./db";

/**
 * What is swept, by which column, and how long is kept.
 *
 * The timestamp column is named per table rather than guessed: slot_runs keys
 * on run_date and llm_calls on day, and a rule that assumed created_at would
 * produce SQL that is perfectly valid TypeScript and fails at runtime — the
 * exact class of bug scripts/dbtest.ts exists to catch.
 *
 * login_attempts and oauth_states are absent on purpose: both are already swept
 * where they are written, which is the better place for something with a
 * fifteen-minute and one-hour lifetime respectively.
 *
 * The rejection log is read in the app as "what did it turn down lately" —
 * fifteen rows, always recent. Ninety days is far more than that needs and
 * still answers "why did it ignore this back in March".
 */
export const RETENTION: { table: string; column: string; days: number }[] = [
  { table: "rejections", column: "created_at", days: 90 },
  { table: "push_log", column: "sent_at", days: 30 },
  { table: "llm_calls", column: "day", days: 90 },
  { table: "ai_usage", column: "created_at", days: 90 },
  { table: "ai_user_days", column: "day", days: 90 },
  { table: "ai_scoped_provider_days", column: "day", days: 90 },
  { table: "byline_invites", column: "expires_at", days: 7 },
  { table: "slot_runs", column: "run_date", days: 180 },
];

/** Run the sweep at most this often. */
const SWEEP_EVERY_HOURS = 20;

export interface SweepResult {
  ran: boolean;
  deleted: Record<string, number>;
}

/**
 * Sweep, but no more than once a day.
 *
 * Called from the cron tick, which fires every few minutes — so the throttle is
 * load-bearing rather than tidiness. The marker is claimed with a conditional
 * UPDATE so two ticks racing cannot both decide it is their turn.
 */
export async function sweepIfDue(): Promise<SweepResult> {
  const empty: SweepResult = { ran: false, deleted: {} };
  try {
    const claimed = await query<{ key: string }>(
      `INSERT INTO system_status (key, value, updated_at)
       VALUES ('last_sweep', '{}'::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET updated_at = now()
        WHERE system_status.updated_at < now() - ($1 || ' hours')::interval
       RETURNING key`,
      [String(SWEEP_EVERY_HOURS)],
    );
    if (claimed.length === 0) return empty;

    const deleted: Record<string, number> = {};
    for (const { table, column, days } of RETENTION) {
      // Table and column are literals from the list above, never from input —
      // that is what makes interpolating them safe. The cutoff is still bound.
      //
      // Counted in the database rather than by returning the rows: the first
      // sweep on an old database could delete tens of thousands, and there is
      // no reason to carry all of them back over the wire to call .length on.
      const rows = await query<{ n: number }>(
        `WITH removed AS (
           DELETE FROM ${table} WHERE ${column} < now() - ($1 || ' days')::interval RETURNING 1
         )
         SELECT count(*)::int AS n FROM removed`,
        [String(days)],
      );
      const n = rows[0]?.n ?? 0;
      if (n > 0) deleted[table] = n;
    }

    const total = Object.values(deleted).reduce((a, b) => a + b, 0);
    console.log(
      total > 0
        ? `[retention] swept ${total} row(s): ${JSON.stringify(deleted)}`
        : "[retention] nothing old enough to remove",
    );
    return { ran: true, deleted };
  } catch (err) {
    // Housekeeping must never take the scheduler down with it.
    console.warn("[retention] sweep failed:", String((err as Error)?.message ?? err));
    return empty;
  }
}
