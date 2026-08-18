/**
 * Agent settings: categories, timezone, daily post time, auto-publish, pause.
 *
 * Changing the post time reschedules the next run immediately — otherwise a
 * change made at 10:00 would not take effect until the old slot had fired,
 * which looks exactly like the setting being ignored.
 */
import { NextResponse } from "next/server";
import { getPrimaryAgent, updateAgentSettings } from "../../../lib/agents";
import { getAccountStatus } from "../../../lib/accounts";
import { parseCategories } from "../../../lib/categories";
import { query } from "../../../lib/db";
import { nextDailyRun, normalizeHhMm } from "../../../lib/schedule";
import { rescheduleAllSlots } from "../../../lib/slots";
import { PRESETS, type StyleConfig } from "../../../lib/style";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const agent = await getPrimaryAgent();
  if (!agent) return NextResponse.json({ error: "not_initialized" }, { status: 400 });

  let body: {
    categories?: unknown;
    timezone?: string;
    postTimeLocal?: string;
    autoPublish?: boolean;
    paused?: boolean;
    autoPublishCap?: number;
    style?: unknown;
    preset?: string;
    /** Writing samples, replaced wholesale. */
    corpus?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // Turning on auto-publish without a working connection would produce a daily
  // stream of failed sends, so it is refused with the actual reason.
  if (body.autoPublish === true) {
    const account = await getAccountStatus(agent.agentId);
    if (!account.connected || account.needsReauth) {
      return NextResponse.json(
        { error: "linkedin_not_connected", detail: "Connect LinkedIn before enabling auto-publish." },
        { status: 400 },
      );
    }
  }

  // Validate the time HERE rather than letting the update layer quietly skip a
  // malformed value: silently returning ok:true for a save that did nothing is
  // indistinguishable, from the UI, from the setting refusing to change.
  let postTimeLocal: string | undefined;
  if (body.postTimeLocal !== undefined) {
    const normalized = normalizeHhMm(String(body.postTimeLocal));
    if (!normalized) {
      return NextResponse.json(
        { error: "bad_post_time", detail: `Expected HH:MM, got "${body.postTimeLocal}"` },
        { status: 400 },
      );
    }
    postTimeLocal = normalized;
  }

  // A preset is just a bundle of style fields — it lands in the same patch, so
  // an explicit `style` sent alongside one wins field by field.
  const preset = typeof body.preset === "string" ? PRESETS[body.preset] : undefined;
  if (body.preset !== undefined && !preset) {
    return NextResponse.json({ error: "unknown_preset" }, { status: 400 });
  }
  const stylePatch: Partial<StyleConfig> | undefined =
    preset || body.style
      ? ({
          ...(preset ? preset.style : {}),
          ...(body.style && typeof body.style === "object" && !Array.isArray(body.style)
            ? body.style
            : {}),
        } as Partial<StyleConfig>)
      : undefined;

  const updated = await updateAgentSettings(agent.agentId, {
    categories: body.categories === undefined ? undefined : parseCategories(body.categories),
    timezone: body.timezone,
    postTimeLocal,
    autoPublish: body.autoPublish,
    paused: body.paused,
    autoPublishCap: body.autoPublishCap,
    style: stylePatch,
    corpus: Array.isArray(body.corpus) ? body.corpus.filter((c): c is string => typeof c === "string") : undefined,
  });
  if (!updated) return NextResponse.json({ error: "update_failed" }, { status: 500 });

  if (postTimeLocal || body.timezone) {
    await query(
      `INSERT INTO scheduler_state (agent_id, next_run_at) VALUES ($1, $2)
       ON CONFLICT (agent_id) DO UPDATE SET next_run_at = $2`,
      [agent.agentId, nextDailyRun(updated.timezone, updated.postTimeLocal).toISOString()],
    );
  }

  // A timezone change moves every slot. Each slot stores its next occurrence as
  // an absolute instant derived from the old zone, so without this they would
  // all keep firing at the previous offset — the posts would still go out, just
  // silently at the wrong hour, which is the kind of bug nobody reports because
  // it looks like the schedule was simply set wrong.
  if (body.timezone) {
    await rescheduleAllSlots(agent.agentId, updated.timezone);
  }

  return NextResponse.json({ ok: true, agent: updated });
}
