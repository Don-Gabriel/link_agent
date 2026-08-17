/**
 * Liveness + keep-alive. One capped query, always 200, no secrets.
 *
 * Neon's free tier autosuspends after ~5 idle minutes, so a scheduled ping
 * here keeps the dashboard's first load warm instead of cold-starting the
 * database.
 */
import { NextResponse } from "next/server";
import { getPool } from "../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let db = "unconfigured";
  try {
    const pool = getPool();
    if (pool) {
      await pool.query("SELECT 1");
      db = "ok";
    }
  } catch (err) {
    db = `error: ${String((err as Error)?.message ?? err).slice(0, 120)}`;
  }
  return NextResponse.json({
    ok: true,
    db,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    at: new Date().toISOString(),
  });
}
