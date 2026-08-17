/**
 * The sole cycle driver. Authenticated by the X-Cron-Secret header only, and
 * a mismatch returns 404 rather than 401 so the endpoint does not advertise
 * that it exists.
 *
 * ACK-THEN-WORK: responds in ~1s with the list of due agents and runs the
 * cycles in after(). Cron providers typically time out client-side around
 * 30 seconds, and a cycle takes longer than that — but the work MUST go
 * through after() with maxDuration set, because serverless kills background
 * work the moment the response returns.
 *
 * Double triggers are harmless: every cycle passes through the same advisory
 * lock and due-check, and every publish through its own idempotency key.
 */
import { after, NextResponse } from "next/server";
import { listDueAgents, runCycleWithLock } from "../../../../lib/cycle";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const provided = request.headers.get("x-cron-secret") ?? "";
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function GET(request: Request) {
  if (!authorized(request)) return new NextResponse("Not Found", { status: 404 });

  const url = new URL(request.url);
  const forced = url.searchParams.get("agent");
  const force = url.searchParams.get("force") === "1";

  try {
    const due = forced ? [forced] : await listDueAgents();
    after(async () => {
      // Serialized on purpose: cycles share a per-model LLM rate limit, so
      // running them concurrently just produces 429s.
      for (const agentId of due) {
        const result = await runCycleWithLock(agentId, force);
        console.log(`[tick] ${agentId}: ${JSON.stringify(result)}`);
      }
    });
    return NextResponse.json({ ok: true, agentsDue: due.length });
  } catch (err) {
    console.error("[tick] failed:", err);
    return NextResponse.json({ ok: false, error: String((err as Error)?.message ?? err) });
  }
}
