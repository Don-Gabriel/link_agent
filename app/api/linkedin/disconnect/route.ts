/**
 * Disconnect: drop the stored token entirely.
 *
 * Also pauses the agent. Leaving it scheduled would mean it keeps drafting
 * posts it has no way to publish, then filling the queue with failures.
 */
import { NextResponse } from "next/server";
import { disconnectAccount } from "../../../../lib/accounts";
import { updateAgentSettings } from "../../../../lib/agents";
import { getRequestAgent } from "../../../../lib/request-agent";

export const dynamic = "force-dynamic";

export async function POST() {
  const agent = await getRequestAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });
  await disconnectAccount(agent.agentId);
  await updateAgentSettings(agent.agentId, { paused: true, autoPublish: false });
  return NextResponse.json({ ok: true });
}
