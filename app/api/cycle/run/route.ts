/**
 * Run a cycle now, from the dashboard or the app.
 *
 * /api/cron/tick exists for schedulers and is authenticated by a shared secret
 * that no client should ever hold. This is the human equivalent: same work,
 * same advisory lock, but gated by the ordinary session cookie like every
 * other /api route.
 *
 * Forces past the due check on purpose — someone pressing "Run now" has
 * decided, and refusing because the clock says 09:30 is not yet due would make
 * the button look broken.
 *
 * ACK-THEN-WORK, matching the tick route: a cycle takes longer than any
 * sensible request timeout, so the response returns immediately and the work
 * continues in after().
 */
import { after, NextResponse } from "next/server";
import { getPrimaryAgent } from "../../../../lib/agents";
import { runCycleWithLock } from "../../../../lib/cycle";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const agent = await getPrimaryAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  if (agent.paused) {
    return NextResponse.json(
      { error: "agent_paused", detail: "Unpause the agent before running a cycle." },
      { status: 409 },
    );
  }

  after(async () => {
    const result = await runCycleWithLock(agent.agentId, true);
    console.log(`[run] ${agent.agentId}: ${JSON.stringify(result)}`);
  });

  // The advisory lock means a second press while one is running is harmless —
  // it will simply find the lock held and return without doing anything.
  return NextResponse.json({ ok: true, started: true });
}
