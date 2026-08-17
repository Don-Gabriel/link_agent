/**
 * One slot: change it, or remove it.
 *
 * Every change reschedules the slot and re-derives the agent's auto-publish cap
 * (see lib/slots.ts) so the timetable and the safety limit can never disagree.
 */
import { NextResponse } from "next/server";
import { getPrimaryAgent } from "../../../../lib/agents";
import { parseCategories } from "../../../../lib/categories";
import { deleteSlot, listSlots, updateSlot } from "../../../../lib/slots";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const agent = await getPrimaryAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  const { id } = await context.params;

  let body: {
    localTime?: string;
    daysMask?: number;
    leadMinutes?: number;
    autoPublish?: boolean;
    categories?: string[];
    enabled?: boolean;
    position?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const result = await updateSlot(agent.agentId, id, agent.timezone, {
    localTime: body.localTime,
    daysMask: body.daysMask,
    leadMinutes: body.leadMinutes,
    autoPublish: body.autoPublish,
    // Distinguish "not mentioned" from "cleared": an absent key leaves the
    // slot's categories alone, an empty array means "use the agent's".
    categories: body.categories === undefined ? undefined : parseCategories(body.categories),
    enabled: body.enabled,
    position: body.position,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 400 },
    );
  }
  return NextResponse.json({ ok: true, slot: result.slot });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const agent = await getPrimaryAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  const { id } = await context.params;

  // Refuse to remove the last slot. An agent with an empty timetable looks
  // identical to a broken cron from the outside — disable it instead, which
  // says the same thing and can be undone with one tap.
  const slots = await listSlots(agent.agentId);
  if (slots.length <= 1) {
    return NextResponse.json(
      {
        error: "last_slot",
        detail: "This is your only posting time. Disable it instead of deleting it.",
      },
      { status: 409 },
    );
  }

  if (!(await deleteSlot(agent.agentId, id))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
