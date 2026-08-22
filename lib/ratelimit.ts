/**
 * Rate limiting for the login gate.
 *
 * The gate already delayed 800ms on a wrong password, which is a real brake on
 * a sequential guesser and almost none on a parallel one: serverless runs
 * requests concurrently, so twenty simultaneous guesses all wait 800ms at the
 * same time and cost the attacker 800ms in total. Behind that gate is an
 * endpoint that publishes to a real LinkedIn profile.
 *
 * So attempts are counted in Postgres rather than in memory. A per-process
 * counter would be reset by every cold start and sidestepped by requests
 * landing on different instances — the exact shape of the attack.
 *
 * Deliberately counts FAILURES only, and only for the login route. A correct
 * password clears the record, so ordinary use never approaches the limit and
 * nobody can lock the real user out by guessing from another address: the
 * window is keyed by client.
 */
import { query } from "./db";

/** Failures allowed from one client before it is refused. */
export const MAX_ATTEMPTS = 8;

/** How far back failures are counted, and how long a block therefore lasts. */
export const WINDOW_MINUTES = 15;

/**
 * The client, as far as we can tell.
 *
 * Vercel sets x-forwarded-for and x-real-ip; nothing else is trustworthy. A
 * request with neither is bucketed under "unknown", which means every such
 * request shares one allowance — the conservative direction, since a client
 * that hides its address should not get a fresh quota by doing so.
 *
 * Only the first address is used: x-forwarded-for is a chain, and the entries
 * after the first are supplied by the caller.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  return (forwarded || real || "unknown").slice(0, 100);
}

export interface RateVerdict {
  allowed: boolean;
  /** Failures already recorded in the window. */
  recent: number;
  /** Whole minutes until the oldest failure ages out. Only meaningful when blocked. */
  retryAfterMinutes: number;
}

/**
 * Whether this client may attempt a login right now.
 *
 * Fails OPEN on a database error. A login gate that refuses everyone because
 * the counter table is unreachable turns a degraded database into a total
 * lockout, and the password check itself is unaffected either way.
 */
export async function checkLoginAllowed(client: string): Promise<RateVerdict> {
  try {
    const rows = await query<{ recent: string; oldest: Date | null }>(
      `SELECT count(*) AS recent, min(at) AS oldest
         FROM login_attempts
        WHERE client = $1 AND at > now() - ($2 || ' minutes')::interval`,
      [client, String(WINDOW_MINUTES)],
    );
    const recent = Number(rows[0]?.recent ?? 0);
    const oldest = rows[0]?.oldest;
    const retryAfterMinutes = oldest
      ? Math.max(1, WINDOW_MINUTES - Math.floor((Date.now() - oldest.getTime()) / 60_000))
      : WINDOW_MINUTES;
    return { allowed: recent < MAX_ATTEMPTS, recent, retryAfterMinutes };
  } catch (err) {
    console.warn("[ratelimit] check failed, allowing:", String((err as Error)?.message ?? err));
    return { allowed: true, recent: 0, retryAfterMinutes: 0 };
  }
}

/** Record one failed attempt, and opportunistically sweep expired rows. */
export async function recordLoginFailure(client: string): Promise<void> {
  try {
    await query("INSERT INTO login_attempts (client) VALUES ($1)", [client]);
    // Swept here rather than on a schedule: this table only grows when someone
    // is failing to log in, so the moment of failure is exactly when it is
    // worth tidying, and it keeps the app free of a second cron.
    await query(
      `DELETE FROM login_attempts WHERE at < now() - ($1 || ' minutes')::interval`,
      [String(WINDOW_MINUTES)],
    );
  } catch (err) {
    console.warn("[ratelimit] could not record failure:", String((err as Error)?.message ?? err));
  }
}

/** Forget this client's failures. Called on a successful login. */
export async function clearLoginFailures(client: string): Promise<void> {
  try {
    await query("DELETE FROM login_attempts WHERE client = $1", [client]);
  } catch (err) {
    console.warn("[ratelimit] could not clear failures:", String((err as Error)?.message ?? err));
  }
}
