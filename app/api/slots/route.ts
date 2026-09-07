/**
 * The timetable: list the slots, or add one.
 *
 * Protected by middleware.ts like every other API route — nothing here repeats
 * the session check.
 */
import { NextResponse } from "next/server";

import { getRequestAgent } from "../../../lib/request-agent";
import { parseCategories, isCategoryId, MAX_SELECTED_CATEGORIES } from "../../../lib/categories";
import {
  createSlot,
  ensureSlotsMigrated,
  listSlots,
  MAX_LEAD_MINUTES,
  MAX_SLOTS,
  MIN_LEAD_MINUTES,
  setSlotCount,
} from "../../../lib/slots";

export const dynamic = "force-dynamic";

export async function GET() {
  const agent = await getRequestAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  // Idempotent and cheap after the first call: gives a pre-slots agent its
  // first slot from the legacy single post time, so opening the schedule screen
  // never shows an empty timetable for an agent that has been posting daily.
  await ensureSlotsMigrated(
    agent.agentId,
    agent.postTimeLocal,
    agent.timezone,
    agent.autoPublish,
  );

  return NextResponse.json({
    slots: await listSlots(agent.agentId),
    limits: {
      maxSlots: MAX_SLOTS,
      minLeadMinutes: MIN_LEAD_MINUTES,
      maxLeadMinutes: MAX_LEAD_MINUTES,
    },
    timezone: agent.timezone,
  });
}

export async function POST(request: Request) {
  const agent = await getRequestAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  let body: {
    action?:string;
    count?:number;
    localTime?: string;
    daysMask?: number;
    leadMinutes?: number;
    autoPublish?: boolean;
    categories?: string[];
    enabled?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({error:'Check your posting time settings.'},{status:400});
  if (body.categories !== undefined && (!Array.isArray(body.categories) || body.categories.length > MAX_SELECTED_CATEGORIES || body.categories.some(id=>!isCategoryId(id)))) return NextResponse.json({error:'Choose up to 12 subjects from the catalogue.'},{status:400});
  if(body.action==='count') {
    if(typeof body.count!=='number'||!Number.isInteger(body.count)||body.count<1||body.count>MAX_SLOTS)
      return NextResponse.json({error:'Choose 1–5 posting times.'},{status:400});
    await setSlotCount(agent.agentId,agent.timezone,body.count);
    return NextResponse.json({ok:true,slots:await listSlots(agent.agentId)});
  }

  const result = await createSlot(agent.agentId, agent.timezone, {
    localTime: body.localTime,
    daysMask: body.daysMask,
    leadMinutes: body.leadMinutes,
    autoPublish: body.autoPublish,
    categories: parseCategories(body.categories),
    enabled: body.enabled,
  });

  if (!result.ok) {
    const status = result.error === "too_many_slots" ? 409 : 400;
    const detail =
      result.error === "too_many_slots"
        ? `You already have ${MAX_SLOTS} slots, which is the maximum. Remove one first.`
        : "A slot needs a time in HH:MM form.";
    return NextResponse.json({ error: result.error, detail }, { status });
  }

  return NextResponse.json({ ok: true, slot: result.slot });
}
