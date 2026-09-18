/**
 * Process liveness only. Frequent host probes must not wake the database.
 * Database readiness is verified by the hosted startup migration.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    // Liveness must not continuously wake a metered free-tier database or expose DB errors.
    db: 'not_probed',
    commit: (process.env.RENDER_GIT_COMMIT??process.env.VERCEL_GIT_COMMIT_SHA)?.slice(0, 7) ?? "local",
    at: new Date().toISOString(),
  });
}
