/**
 * The daily timetable: what a "slot" is, when it is due, and what happened to
 * it today.
 *
 * The whole point of this module is a split that did not exist before it: the
 * moment a post is WRITTEN stops being the moment it is SENT. A slot fires its
 * generation `lead_minutes` early, the draft lands with a `scheduled_for`, and
 * a separate pass in lib/distribute.ts does the sending. The gap between the
 * two is the review window.
 *
 * LEAD TIME IS A MINIMUM, NEVER A TARGET. A cron driver is not a real-time
 * system — GitHub Actions floors at 5 minutes and routinely runs 15+ late, and
 * even a good driver drifts. So the due test asks "has the window opened yet",
 * which means a late tick gives MORE warning than promised and never less. The
 * one thing a review window must never do is quietly shrink to nothing.
 *
 * Two guards stop a wobbly cron from doing damage:
 *   - `slot_runs` has a (slot_id, run_date) primary key, so however many times
 *     the tick fires, a slot generates at most once per local day.
 *   - A slot noticed more than MISSED_AFTER_MINUTES past its time is marked
 *     `missed` rather than generated. A scheduled post published hours late is
 *     worse than no post: it is a post you did not choose to send at that hour.
 */
import { type CategoryId, parseCategories } from "./categories";
import { getPool, query } from "./db";
import {
  MASK_WEEKDAYS,
  localClock,
  nextSlotRun,
  normalizeHhMm,
  parseDaysMask,
  safeTimeZone,
} from "./schedule";

/** Hard ceiling on slots per agent. Five posts a day is already a lot. */
export const MAX_SLOTS = 5;
/** Anything shorter is not a review window, it is a notification. */
export const MIN_LEAD_MINUTES = 10;
/** Half a day. Beyond this the "news" the post was written from is stale. */
export const MAX_LEAD_MINUTES = 720;
/** Past this much lateness a slot is missed rather than published late. */
export const MISSED_AFTER_MINUTES = 45;

/**
 * Head start given to generation, on top of the review window.
 *
 * The review window is a promise about when the draft is READY TO READ, not
 * about when the machine starts thinking. Firing generation exactly at
 * `T - lead` keeps the wrong half of that promise: the cycle then takes 30-90
 * seconds of feed fetching and two or three LLM calls, so a 15-minute window
 * hands you the draft with 13 minutes left.
 *
 * Worse, a cron does not tick continuously. At a 5-minute interval the tick
 * that should fire at T-15 may not arrive until T-11, and the draft lands with
 * nine minutes left on a fifteen-minute promise.
 *
 * So generation starts at `T - lead - GENERATION_BUFFER`, sized to cover the
 * slowest realistic cycle plus one missed tick. The draft is then in the queue
 * BEFORE the window opens, every time, and the window you were promised is the
 * window you actually get.
 *
 * Costs nothing but eight minutes of extra notice, and it is deliberately not
 * folded into lead_minutes: lead is the author's promise, this is the slack
 * needed to keep it.
 */
export const GENERATION_BUFFER_MINUTES = 8;
/** How long a composer's edit lock survives without being refreshed. */
export const HOLD_MINUTES = 30;

export type SlotOutcome =
  | "pending"
  | "drafted"
  | "silent"
  | "missed"
  | "failed"
  | "published";

export interface PostSlot {
  id: string;
  agentId: string;
  localTime: string;
  daysMask: number;
  leadMinutes: number;
  autoPublish: boolean;
  categories: CategoryId[];
  enabled: boolean;
  position: number;
  nextRunAt: string | null;
}

interface SlotRow {
  id: string;
  agent_id: string;
  local_time: string;
  days_mask: number;
  lead_minutes: number;
  auto_publish: boolean;
  categories_json: unknown;
  enabled: boolean;
  position: number;
  next_run_at: Date | null;
}

/** Every column [toSlot] needs, in one place. */
export const SLOT_COLUMN_NAMES = [
  "id",
  "agent_id",
  "local_time",
  "days_mask",
  "lead_minutes",
  "auto_publish",
  "categories_json",
  "enabled",
  "position",
  "next_run_at",
] as const;

/** Unqualified — for the single-table queries, where there is nothing to clash with. */
const SLOT_COLUMNS = SLOT_COLUMN_NAMES.join(", ");

/**
 * Qualified with the `s` alias, for the JOIN against agents.
 *
 * Written out from the same array rather than derived by string surgery on the
 * unqualified list. The previous version did `SLOT_COLUMNS.split(", ")`, which
 * silently failed to split where the constant wrapped across a line — so
 * `categories_json` came through with no alias, and since BOTH post_slots and
 * agents have a column of that name, every tick died with
 * `column reference "categories_json" is ambiguous`. The scheduler never ran.
 *
 * The selftests could not catch it: they exercise pure logic and never open a
 * connection, so a query that is valid TypeScript and invalid SQL runs clean
 * through the whole suite.
 */
export const SLOT_COLUMNS_QUALIFIED = SLOT_COLUMN_NAMES.map((c) => `s.${c}`).join(", ");

function toSlot(r: SlotRow): PostSlot {
  return {
    id: r.id,
    agentId: r.agent_id,
    localTime: r.local_time,
    daysMask: parseDaysMask(r.days_mask),
    leadMinutes: clampLead(r.lead_minutes),
    autoPublish: r.auto_publish,
    categories: parseCategories(r.categories_json),
    enabled: r.enabled,
    position: r.position,
    nextRunAt: r.next_run_at?.toISOString() ?? null,
  };
}

export function clampLead(v: unknown): number {
  const n = typeof v === "number" ? Math.round(v) : Number(v);
  if (!Number.isFinite(n)) return 15;
  return Math.min(MAX_LEAD_MINUTES, Math.max(MIN_LEAD_MINUTES, n));
}

// ------------------------------------------------------------------ reading

export async function listSlots(agentId: string): Promise<PostSlot[]> {
  const rows = await query<SlotRow>(
    `SELECT ${SLOT_COLUMNS} FROM post_slots WHERE agent_id = $1
      ORDER BY position, local_time`,
    [agentId],
  );
  return rows.map(toSlot);
}

export async function getSlot(agentId: string, slotId: string): Promise<PostSlot | null> {
  const rows = await query<SlotRow>(
    `SELECT ${SLOT_COLUMNS} FROM post_slots WHERE agent_id = $1 AND id = $2`,
    [agentId, slotId],
  );
  return rows[0] ? toSlot(rows[0]) : null;
}

// ------------------------------------------------------------------ writing

/**
 * Keep agents.auto_publish_cap in step with the timetable.
 *
 * The cap exists so a logic error cannot spam a real profile, and its right
 * value is simply "how many posts did the author actually schedule". Deriving
 * it removes an entire class of confusing failure: configure a fourth slot,
 * forget the cap is 3, and the fourth post fails at send time with
 * `auto_cap_reached` — which reads as a bug rather than a limit.
 */
async function syncAutoCap(agentId: string): Promise<void> {
  await query(
    `UPDATE agents SET auto_publish_cap = GREATEST(1, LEAST($2, (
       SELECT count(*) FROM post_slots WHERE agent_id = $1 AND enabled
     ))) WHERE id = $1`,
    [agentId, MAX_SLOTS],
  );
}

/** Recompute when this slot next fires. Called after any change that moves it. */
export async function rescheduleSlot(slot: PostSlot, timezone: string): Promise<void> {
  if (!slot.enabled) {
    await query("UPDATE post_slots SET next_run_at = NULL WHERE id = $1", [slot.id]);
    return;
  }
  const next = nextSlotRun(safeTimeZone(timezone), slot.localTime, slot.daysMask);
  await query("UPDATE post_slots SET next_run_at = $2 WHERE id = $1", [
    slot.id,
    next?.toISOString() ?? null,
  ]);
}

export async function rescheduleAllSlots(agentId: string, timezone: string): Promise<void> {
  for (const slot of await listSlots(agentId)) await rescheduleSlot(slot, timezone);
}

export interface SlotInput {
  localTime?: string;
  daysMask?: number;
  leadMinutes?: number;
  autoPublish?: boolean;
  categories?: CategoryId[];
  enabled?: boolean;
  position?: number;
}

export type SlotWriteResult =
  | { ok: true; slot: PostSlot }
  | { ok: false; error: "too_many_slots" | "bad_time" | "not_found" };

export async function createSlot(
  agentId: string,
  timezone: string,
  input: SlotInput,
): Promise<SlotWriteResult> {
  const existing = await listSlots(agentId);
  // Refused at creation rather than at send time. A limit you discover by
  // having a post silently not go out is not a limit, it is a trap.
  if (existing.length >= MAX_SLOTS) return { ok: false, error: "too_many_slots" };

  const localTime = normalizeHhMm(input.localTime ?? "");
  if (!localTime) return { ok: false, error: "bad_time" };

  const rows = await query<SlotRow>(
    `INSERT INTO post_slots (agent_id, local_time, days_mask, lead_minutes, auto_publish,
                             categories_json, enabled, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${SLOT_COLUMNS}`,
    [
      agentId,
      localTime,
      parseDaysMask(input.daysMask ?? MASK_WEEKDAYS),
      clampLead(input.leadMinutes ?? 15),
      input.autoPublish ?? false,
      JSON.stringify(parseCategories(input.categories ?? [])),
      input.enabled ?? true,
      input.position ?? existing.length,
    ],
  );

  const slot = toSlot(rows[0]);
  await rescheduleSlot(slot, timezone);
  await syncAutoCap(agentId);
  return { ok: true, slot: (await getSlot(agentId, slot.id)) ?? slot };
}

export async function updateSlot(
  agentId: string,
  slotId: string,
  timezone: string,
  patch: SlotInput,
): Promise<SlotWriteResult> {
  const current = await getSlot(agentId, slotId);
  if (!current) return { ok: false, error: "not_found" };

  const sets: string[] = [];
  const params: unknown[] = [slotId];
  const push = (fragment: string, value: unknown) => {
    params.push(value);
    sets.push(`${fragment} = $${params.length}`);
  };

  if (patch.localTime !== undefined) {
    const normalized = normalizeHhMm(patch.localTime);
    if (!normalized) return { ok: false, error: "bad_time" };
    push("local_time", normalized);
  }
  if (patch.daysMask !== undefined) push("days_mask", parseDaysMask(patch.daysMask));
  if (patch.leadMinutes !== undefined) push("lead_minutes", clampLead(patch.leadMinutes));
  if (typeof patch.autoPublish === "boolean") push("auto_publish", patch.autoPublish);
  if (patch.categories !== undefined) {
    push("categories_json", JSON.stringify(parseCategories(patch.categories)));
  }
  if (typeof patch.enabled === "boolean") push("enabled", patch.enabled);
  if (patch.position !== undefined) push("position", patch.position);

  if (sets.length > 0) {
    await query(`UPDATE post_slots SET ${sets.join(", ")} WHERE id = $1`, params);
  }

  const updated = (await getSlot(agentId, slotId))!;
  await rescheduleSlot(updated, timezone);
  await syncAutoCap(agentId);
  return { ok: true, slot: (await getSlot(agentId, slotId))! };
}

export async function deleteSlot(agentId: string, slotId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    "DELETE FROM post_slots WHERE agent_id = $1 AND id = $2 RETURNING id",
    [agentId, slotId],
  );
  if (rows.length === 0) return false;
  await syncAutoCap(agentId);
  return true;
}

/**
 * Give an agent its first slot from the legacy single post time.
 *
 * Runs once, guarded by "does this agent have any slot at all", so it is safe
 * to call on every status read. Behaviour is deliberately unchanged by the
 * migration: one slot, at the same time, carrying the agent's existing
 * auto_publish setting — a user who never opens the new screen keeps exactly
 * the cadence they had. Days default to daily rather than weekdays here for
 * the same reason: the old scheduler ran every day.
 */
export async function ensureSlotsMigrated(
  agentId: string,
  postTimeLocal: string,
  timezone: string,
  autoPublish: boolean,
): Promise<PostSlot[]> {
  const existing = await listSlots(agentId);
  // Returned, not discarded: /api/status used to call this and then call
  // listSlots again for the same rows — a second network round trip for data
  // it already had in hand.
  if (existing.length > 0) return existing;

  const created = await createSlot(agentId, timezone, {
    localTime: normalizeHhMm(postTimeLocal) ?? "09:30",
    daysMask: 0b1111111,
    leadMinutes: 15,
    autoPublish,
    enabled: true,
    position: 0,
  });
  if (!created.ok) {
    console.warn(`[slots] migration failed for agent=${agentId}: ${created.error}`);
    return [];
  }
  console.log(`[slots] agent=${agentId} migrated post_time_local=${postTimeLocal} to a slot`);
  return listSlots(agentId);
}

// --------------------------------------------------------------------- due

export interface DueSlot {
  slot: PostSlot;
  timezone: string;
  /** When this instance should reach LinkedIn. */
  scheduledFor: Date;
  /** Local calendar date of the occurrence — the slot_runs key. */
  runDate: string;
  /** True when we noticed too late to be worth publishing. */
  missed: boolean;
}

interface DueRow extends SlotRow {
  timezone: string;
}

/**
 * Every slot whose generation window has opened, across all active agents.
 *
 * The window test is `next_run_at - lead <= now()`, computed in SQL from one
 * stored timestamp so the occurrence and the generation time cannot drift.
 */
export async function listDueSlots(): Promise<DueSlot[]> {
  const rows = await query<DueRow>(
    `SELECT ${SLOT_COLUMNS_QUALIFIED}, a.timezone
       FROM post_slots s
       JOIN agents a ON a.id = s.agent_id
      WHERE s.enabled AND a.active AND NOT a.paused
        AND s.next_run_at IS NOT NULL
        -- lead + buffer, so the draft is READY when the review window opens
        -- rather than only starting to be written then. See
        -- GENERATION_BUFFER_MINUTES.
        AND s.next_run_at - make_interval(mins => s.lead_minutes + $1::int) <= now()
      ORDER BY s.next_run_at`,
    [GENERATION_BUFFER_MINUTES],
  );

  const now = Date.now();
  return rows.map((r) => {
    const slot = toSlot(r);
    const timezone = safeTimeZone(r.timezone);
    const scheduledFor = r.next_run_at!;
    return {
      slot,
      timezone,
      scheduledFor,
      runDate: localClock(timezone, scheduledFor).date,
      missed: now > scheduledFor.getTime() + MISSED_AFTER_MINUTES * 60_000,
    };
  });
}

/**
 * Claim this slot's run for today. Returns false if another tick already has it.
 *
 * Same shape as the idempotency claim in lib/distribute.ts, and for the same
 * reason: the primary key does the concurrency control, so overlapping cron
 * ticks collapse into one generation rather than racing.
 */
export async function claimSlotRun(due: DueSlot): Promise<boolean> {
  const rows = await query<{ slot_id: string }>(
    // DO UPDATE rather than DO NOTHING, but only for a run that FAILED and
    // whose send time has not yet passed.
    //
    // A plain DO NOTHING made any transient failure fatal for the day: one bad
    // judge response, one 429, one feed timeout, and the row sat at 'failed'
    // while every later tick reported `already_ran_today` and refused to try
    // again. That is not what a review window is for — there is nothing to
    // review, and hours of remaining time were being thrown away.
    //
    // Still exactly-once for the outcomes that matter. A run that DRAFTED,
    // PUBLISHED, went SILENT or was MISSED is never re-claimed, so a slot
    // cannot produce two posts in a day however often the cron fires.
    `INSERT INTO slot_runs (slot_id, run_date, scheduled_for, outcome)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (slot_id, run_date) DO UPDATE
        SET outcome = 'pending', detail = NULL
      WHERE slot_runs.outcome = 'failed'
        AND slot_runs.scheduled_for > now()
     RETURNING slot_id`,
    [due.slot.id, due.runDate, due.scheduledFor.toISOString()],
  );
  return rows.length > 0;
}

export async function settleSlotRun(
  slotId: string,
  runDate: string,
  outcome: SlotOutcome,
  fields: { postSeq?: number; detail?: string } = {},
): Promise<void> {
  await query(
    `UPDATE slot_runs
        SET outcome = $3, generated_at = COALESCE(generated_at, now()),
            post_seq = COALESCE($4, post_seq), detail = $5
      WHERE slot_id = $1 AND run_date = $2`,
    [slotId, runDate, outcome, fields.postSeq ?? null, fields.detail?.slice(0, 300) ?? null],
  );
}

/**
 * Run `fn` holding an advisory lock on this SLOT.
 *
 * Keyed on the slot rather than the agent, which is what makes two slots at the
 * same time work. The agent-wide lock the old single cycle used would let one
 * of them take the lock and silently drop the other as `locked` — a lost post
 * with no error anywhere.
 */
export async function withSlotLock<T>(
  slotId: string,
  fn: () => Promise<T>,
  onBusy: T,
): Promise<T> {
  const pool = getPool();
  if (!pool) return onBusy;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock(43, hashtext($1)) AS locked",
      [slotId],
    );
    if (!lock.rows[0].locked) {
      await client.query("ROLLBACK");
      return onBusy;
    }
    const result = await fn();
    await client.query("COMMIT"); // releases the lock
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`[slots] lock wrapper failed for slot=${slotId}:`, err);
    return onBusy;
  } finally {
    client.release();
  }
}

// --------------------------------------------------------------- heartbeat

/**
 * How long without a tick before the scheduler is presumed dead.
 *
 * Three missed ticks at the recommended 5-minute interval. Long enough to ride
 * out one slow run or a provider hiccup, short enough that a stopped cron is
 * noticed within the quarter hour.
 */
export const TICK_STALE_MINUTES = 16;

/**
 * Record that the scheduler checked in.
 *
 * Exists because "nothing happened today" has two completely different causes
 * that looked identical from the app: the agent judged everything below the bar
 * and stayed quiet, or NOTHING IS RUNNING AT ALL. The first is the system
 * working; the second is a cron that stopped hours ago, and the only visible
 * difference was an empty timeline in both cases.
 *
 * Never throws. A heartbeat that could break a tick would be worse than no
 * heartbeat.
 */
export async function recordTick(): Promise<void> {
  try {
    await query(
      `INSERT INTO system_status (key, value, updated_at)
       VALUES ('last_tick', '{}'::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET updated_at = now()`,
    );
  } catch (err) {
    console.warn("[slots] could not record the tick heartbeat:", err);
  }
}

export interface SchedulerHealth {
  lastTickAt: string | null;
  minutesSince: number | null;
  /** False when the cron has stopped, or has never run at all. */
  healthy: boolean;
  staleAfterMinutes: number;
}

export async function schedulerHealth(): Promise<SchedulerHealth> {
  try {
    const rows = await query<{ updated_at: Date }>(
      "SELECT updated_at FROM system_status WHERE key = 'last_tick'",
    );
    const last = rows[0]?.updated_at ?? null;
    if (!last) {
      // Never ticked. Not a stale heartbeat — an absent one, which usually
      // means the cron was never pointed at this deployment.
      return { lastTickAt: null, minutesSince: null, healthy: false, staleAfterMinutes: TICK_STALE_MINUTES };
    }
    const minutesSince = Math.floor((Date.now() - last.getTime()) / 60_000);
    return {
      lastTickAt: last.toISOString(),
      minutesSince,
      healthy: minutesSince <= TICK_STALE_MINUTES,
      staleAfterMinutes: TICK_STALE_MINUTES,
    };
  } catch {
    // A database hiccup is not evidence the scheduler is down, so this reports
    // unknown-but-healthy rather than crying wolf.
    return { lastTickAt: null, minutesSince: null, healthy: true, staleAfterMinutes: TICK_STALE_MINUTES };
  }
}

// ---------------------------------------------------------------- timeline

export interface TimelineEntry {
  slotId: string;
  localTime: string;
  runDate: string;
  scheduledFor: string;
  outcome: SlotOutcome;
  postSeq: number | null;
  detail: string | null;
}

/**
 * What each slot did over the last `days` local days, newest first.
 *
 * This is what makes a silent day legible. A slot that found nothing worth
 * writing appears with outcome `silent` and the reason attached, so the app can
 * say "nothing cleared 6.5 — best was 5.8" instead of showing a gap that looks
 * indistinguishable from a broken cron.
 */
export async function slotTimeline(agentId: string, days = 7): Promise<TimelineEntry[]> {
  const rows = await query<{
    slot_id: string;
    local_time: string;
    run_date: Date;
    scheduled_for: Date;
    outcome: string;
    post_seq: number | null;
    detail: string | null;
  }>(
    `SELECT r.slot_id, s.local_time, r.run_date, r.scheduled_for, r.outcome, r.post_seq, r.detail
       FROM slot_runs r JOIN post_slots s ON s.id = r.slot_id
      WHERE s.agent_id = $1 AND r.run_date > (now() - make_interval(days => $2))::date
      ORDER BY r.scheduled_for DESC`,
    [agentId, days],
  );
  return rows.map((r) => ({
    slotId: r.slot_id,
    localTime: r.local_time,
    runDate: r.run_date.toISOString().slice(0, 10),
    scheduledFor: r.scheduled_for.toISOString(),
    outcome: r.outcome as SlotOutcome,
    postSeq: r.post_seq,
    detail: r.detail,
  }));
}
