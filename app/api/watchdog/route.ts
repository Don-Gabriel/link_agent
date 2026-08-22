/**
 * The outside observer. Checks the standing health properties and pushes if
 * one of them has gone bad.
 *
 * This is separate from the cron tick for one structural reason: **a dead
 * scheduler cannot report its own death.** If the tick is what notices a
 * stalled tick, then the exact failure that most needs an alert — the cron
 * stopping — is the one that produces silence. So this endpoint is driven by a
 * DIFFERENT machine on a different schedule (a GitHub Action, see
 * .github/workflows/watchdog.yml) and the two can only fail together if both
 * providers are down at once.
 *
 * Authenticated by the same CRON_SECRET header as the tick, and answers 404 on
 * a mismatch so it does not advertise that it exists.
 *
 * Everything it can report is throttled in lib/push.ts. A stalled scheduler is
 * still stalled thirty minutes later, and an alert that repeats every half hour
 * is an alert that gets muted — after which it may as well not exist.
 */
import { NextResponse } from "next/server";
import { getAccountStatus } from "../../../lib/accounts";
import { getPrimaryAgent } from "../../../lib/agents";
import { notify, pushConfigured } from "../../../lib/push";
import { schedulerHealth } from "../../../lib/slots";

export const dynamic = "force-dynamic";

/** Warn this far ahead of the 60-day LinkedIn token expiry. */
const TOKEN_WARNING_DAYS = 7;

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

  const agent = await getPrimaryAgent();
  if (!agent) return NextResponse.json({ ok: true, checked: false, reason: "not_initialized" });

  const [health, account] = await Promise.all([
    schedulerHealth(),
    getAccountStatus(agent.agentId),
  ]);

  const alerts: string[] = [];

  if (!health.healthy) {
    alerts.push("scheduler_stalled");
    await notify(agent.agentId, {
      kind: "scheduler_stalled",
      // Null means it has never ticked at all, which on a fresh deployment is
      // normal for a few minutes and after that is the same problem.
      minutes: health.minutesSince ?? health.staleAfterMinutes,
    });
  }

  // Reported while there is still time to act. Once needsReauth is true nothing
  // can publish at all, so the useful alert is the one before that.
  if (account.connected && (account.needsReauth || (account.daysRemaining ?? 99) <= TOKEN_WARNING_DAYS)) {
    alerts.push("token_expiring");
    await notify(agent.agentId, { kind: "token_expiring", days: account.daysRemaining ?? 0 });
  }

  return NextResponse.json({
    ok: true,
    checked: true,
    pushConfigured: pushConfigured(),
    scheduler: { healthy: health.healthy, minutesSince: health.minutesSince },
    linkedin: { connected: account.connected, daysRemaining: account.daysRemaining ?? null },
    alerts,
  });
}
