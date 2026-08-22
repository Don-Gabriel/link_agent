/**
 * The sole scheduler driver. Authenticated by the X-Cron-Secret header only,
 * and a mismatch returns 404 rather than 401 so the endpoint does not advertise
 * that it exists.
 *
 * TWO PASSES, AND THE ORDER IS LOAD-BEARING:
 *
 *   1. SEND everything whose time has come.
 *   2. GENERATE for every slot whose review window has opened.
 *
 * Sending first because a generation takes 30-60 seconds of LLM work and can
 * fail slowly, and a post that was ready to go out at 09:00 must not sit behind
 * a cycle that is busy judging feeds. Publishing is cheap, bounded, and the
 * thing with a deadline; writing is neither.
 *
 * ACK-THEN-WORK: responds in ~1s and does the work in after(). Cron providers
 * typically time out client-side around 30 seconds, and a cycle takes longer —
 * but the work MUST go through after() with maxDuration set, because serverless
 * kills background work the moment the response returns.
 *
 * TICK FREQUENCY: every 5 minutes or better. The review window is defined as a
 * MINIMUM (see lib/slots.ts), so a late tick gives more warning rather than
 * less — but a tick slower than the shortest lead time means slots are noticed
 * after their moment and marked missed. GitHub Actions cannot hold this: it
 * floors at 5 minutes and routinely runs 15+ minutes late. Vercel's Hobby cron
 * permits once per day. cron-job.org runs every minute, free.
 *
 * Double triggers are harmless: generation is claimed per (slot, local day),
 * every cycle passes an advisory lock on its own slot, and every publish goes
 * through its own idempotency key.
 */
import { after, NextResponse } from "next/server";
import { runCycleWithLock, runDueSlots } from "../../../../lib/cycle";
import { query } from "../../../../lib/db";
import { publishDuePosts } from "../../../../lib/distribute";
import { hookOf } from "../../../../lib/format";
import { notify } from "../../../../lib/push";
import { formatInZone } from "../../../../lib/schedule";
import { listDueSlots, MISSED_AFTER_MINUTES, recordTick } from "../../../../lib/slots";

/**
 * Tell the phone what just happened.
 *
 * Only things that HAPPENED, on the tick that made them happen. The standing
 * health properties — a stalled scheduler, an expiring token — are checked by
 * /api/watchdog instead, driven from a different machine, because a tick cannot
 * report that ticks have stopped.
 *
 * Failures here are swallowed by notify() itself. A send that succeeded must
 * not be recorded as failed because a notification could not be delivered.
 */
async function announce(results: { agentId: string; seq: number; outcome: string; detail?: string }[]) {
  for (const r of results) {
    if (r.outcome === "published") {
      await notify(r.agentId, { kind: "published", seq: r.seq });
    } else if (r.outcome === "failed") {
      await notify(r.agentId, { kind: "publish_failed", seq: r.seq, detail: r.detail ?? "unknown" });
    }
    // "missed" and "ambiguous" are deliberately silent here: both are already
    // shouted about in the queue, and neither is actionable at 3am.
  }
}

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

  // Before anything else, and regardless of what the passes then do. The
  // heartbeat records that the SCHEDULER IS ALIVE — a tick that legitimately
  // finds nothing due is still proof the cron is running, and that is exactly
  // the case the app could not previously distinguish from a dead one.
  await recordTick();

  const url = new URL(request.url);
  const forcedAgent = url.searchParams.get("agent");
  const force = url.searchParams.get("force") === "1";

  try {
    // A forced single-agent run is the manual escape hatch and keeps the old
    // whole-agent behaviour, bypassing slots entirely.
    if (forcedAgent) {
      after(async () => {
        const result = await runCycleWithLock(forcedAgent, force);
        console.log(`[tick] forced ${forcedAgent}: ${JSON.stringify(result)}`);
      });
      return NextResponse.json({ ok: true, forced: forcedAgent });
    }

    after(async () => {
      // ---- 1. SEND. Never let this wait behind generation.
      try {
        const sent = await publishDuePosts(MISSED_AFTER_MINUTES);
        for (const s of sent) {
          console.log(`[tick] send agent=${s.agentId} p${s.seq} ${s.outcome}${s.detail ? ` (${s.detail})` : ""}`);
        }
        await announce(sent);
      } catch (err) {
        console.error("[tick] send pass failed:", err);
      }

      // ---- 2. GENERATE. Serialized inside runDueSlots — cycles share a
      // per-model LLM rate limit, so concurrency here just produces 429s.
      try {
        const generated = await runDueSlots();
        for (const g of generated) {
          console.log(`[tick] slot agent=${g.agentId}: ${JSON.stringify(g)}`);

          if (g.drafted && g.seq !== undefined) {
            // The hook, not the whole post: a notification is a reason to open
            // the app, not a place to read a draft.
            const rows = await query<{ text: string; scheduled_for: Date | null; timezone: string }>(
              `SELECT p.text, p.scheduled_for, a.timezone
                 FROM posts p JOIN agents a ON a.id = p.agent_id
                WHERE p.agent_id = $1 AND p.seq = $2`,
              [g.agentId, g.seq],
            );
            const row = rows[0];
            await notify(g.agentId, {
              kind: "draft_ready",
              seq: g.seq,
              hook: row ? hookOf(row.text).slice(0, 120) : "A new draft is waiting.",
              at: row?.scheduled_for ? formatInZone(row.scheduled_for, row.timezone) : null,
            });
          } else if (g.ran && g.skippedReason?.startsWith("judge:")) {
            // A cycle that RAN and could not produce anything for a mechanical
            // reason. "below_threshold" and "no_candidates" are deliberately
            // excluded — a silent day is correct behaviour, not a fault.
            await notify(g.agentId, { kind: "cycle_failed", detail: g.skippedReason });
          }
        }
      } catch (err) {
        console.error("[tick] generate pass failed:", err);
      }
    });

    // Reported before the work runs, so this is what is DUE rather than what
    // happened — the logs above carry the outcomes.
    //
    // This used to report listDueAgents(), which counts the LEGACY per-agent
    // scheduler_state and has had nothing to do with slots since generation
    // moved to them. It sat at 0 forever while the scheduler worked perfectly,
    // which is worse than reporting nothing: it invites you to watch a number
    // that cannot move.
    const due = await listDueSlots();
    return NextResponse.json({
      ok: true,
      slotsDue: due.length,
      slots: due.map((d) => ({
        at: d.slot.localTime,
        for: d.runDate,
        missed: d.missed,
      })),
    });
  } catch (err) {
    console.error("[tick] failed:", err);
    return NextResponse.json({ ok: false, error: String((err as Error)?.message ?? err) });
  }
}
