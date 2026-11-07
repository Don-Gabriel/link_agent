/**
 * Public database readiness probe. Return 503 when storage is unavailable so
 * monitoring can detect an outage. Never expose database error details.
 */
import { NextResponse } from "next/server";
import { getPool } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let db: "unconfigured" | "ok" | "unavailable" = "unconfigured";
  try {
    const pool = getPool();
    if (pool) {
      const probe = { text: "SELECT 1", query_timeout: 5_000 };
      await pool.query(probe);
      db = "ok";
    }
  } catch {
    db = "unavailable";
  }
  const ok = db === "ok";
  return NextResponse.json({
    ok,
    db,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    at: new Date().toISOString(),
  }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
