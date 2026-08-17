/**
 * Single pg Pool per lambda instance. Neon requires TLS; the connection
 * string carries ?sslmode=require (see DEPLOY.md).
 *
 * Serverless notes:
 * - The schema is applied lazily on first DB access (ensureSchema), guarded
 *   by a module-level promise so it runs once per instance. CREATE TABLE IF
 *   NOT EXISTS makes concurrent instances safe.
 * - No DATABASE_URL means stub mode (local dev before Neon exists) — callers
 *   must handle a null pool rather than crash.
 */
import { Pool } from "pg";
import { SCHEMA_SQL } from "./schema";

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

export function getPool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30_000,
      // Neon's free tier autosuspends after ~5 idle minutes and a cold start
      // regularly takes 5-10 seconds. A 5s ceiling meant the FIRST request
      // after any quiet spell failed with "Connection terminated due to
      // connection timeout" — the database was not down, we just gave up while
      // it was still waking.
      connectionTimeoutMillis: 20_000,
      // Keeps the socket alive through NAT/idle timeouts on long-lived
      // serverless instances, which is the other source of "Connection
      // terminated unexpectedly".
      keepAlive: true,
    });
    pool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }
  return pool;
}

/** Applies the schema once per instance; safe to call on every access. */
export async function ensureSchema(): Promise<boolean> {
  const p = getPool();
  if (!p) return false;
  if (!schemaReady) {
    schemaReady = p
      .query(SCHEMA_SQL)
      .then(() => {
        console.log("[db] schema ensured");
      })
      .catch((err) => {
        schemaReady = null; // allow retry on the next access
        throw err;
      });
  }
  await schemaReady;
  return true;
}

/**
 * Thin helper so call sites stay one-liners. Throws on query failure.
 *
 * T is deliberately unconstrained: a named `interface` has no implicit index
 * signature, so a `Record<string, unknown>` bound would reject every row type
 * declared as an interface and push call sites toward inline object literals.
 * The cast below is unchecked either way — the constraint bought no safety.
 */
/** A failure to reach the database at all, as opposed to a rejected statement. */
function isConnectionError(err: unknown): boolean {
  const message = String((err as Error)?.message ?? err);
  return (
    message.includes("Connection terminated") ||
    message.includes("timeout expired") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT")
  );
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL not configured");
  await ensureSchema();

  try {
    const result = await p.query(sql, params);
    return result.rows as T[];
  } catch (err) {
    // Retry ONLY read-only statements, and only when the connection itself
    // failed. A write that dies mid-flight is ambiguous — it may have
    // committed — and blindly re-running one here would undermine the
    // idempotency the publish ledger depends on. A SELECT has no such risk.
    const readOnly = /^\s*select\b/i.test(sql);
    if (!readOnly || !isConnectionError(err)) throw err;

    console.warn(`[db] connection failed on a read, retrying once: ${(err as Error).message}`);
    const result = await p.query(sql, params);
    return result.rows as T[];
  }
}
