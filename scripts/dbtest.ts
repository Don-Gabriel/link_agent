/**
 * Integration tests: every query in the app, executed against a real Postgres.
 *
 * These exist because of a specific, expensive failure. `listDueSlots` shipped
 * with one unqualified column name that Postgres rejects as ambiguous, and the
 * scheduler had never run once — while the entire selftest suite passed. It
 * could not have caught it: scripts/selftest.ts exercises pure logic and never
 * opens a connection, so INVALID SQL THAT IS VALID TYPESCRIPT is invisible to
 * it. Three of the five bugs found on the first live run were of exactly this
 * kind.
 *
 * So this file's job is narrow and it is not "test the business logic" — that
 * is selftest.ts's job and it does it faster. This one exists to make every SQL
 * statement in the codebase actually reach a server and come back. A test here
 * that asserts nothing but runs a query still earns its place.
 *
 * The LLM is never called. Anything that would spend a token is either skipped
 * or fed a pre-made record, because a test suite that needs a model is a test
 * suite that stops running the first time a quota runs out.
 *
 * Run against a THROWAWAY database:
 *   DATABASE_URL=postgres://... npm run test:db
 * Every row it writes is removed on the way out, but it creates and deletes
 * agents, so do not point it at anything you care about.
 */
import { randomUUID } from "node:crypto";
import { ensureAgent, getAgentSettings, getPrimaryAgent, updateAgentSettings, voiceReferencesFor } from "../lib/agents";
import { getAccountStatus } from "../lib/accounts";
import { ensureSchema, getPool, query } from "../lib/db";
import { listAmbiguousSends, sendsToday } from "../lib/distribute";
import { getTodayCalls } from "../lib/llm";
import { recall } from "../lib/memory";
import { forgetDevice, notify, pushConfigured, registerDevice } from "../lib/push";
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure, MAX_ATTEMPTS } from "../lib/ratelimit";
import {
  claimSlotRun,
  createSlot,
  deleteSlot,
  ensureSlotsMigrated,
  listDueSlots,
  listSlots,
  recordTick,
  schedulerHealth,
  settleSlotRun,
  slotTimeline,
  updateSlot,
  withSlotLock,
} from "../lib/slots";

let failures = 0;
let ran = 0;

function check(label: string, ok: boolean, detail = "") {
  ran++;
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Run a query path and report whether it merely EXECUTED.
 *
 * The point of this suite: an ambiguous column, a stale name, a wrong
 * placeholder count. These throw, and until now nothing made them throw
 * anywhere a human would see before production.
 */
async function runs<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  ran++;
  try {
    const value = await fn();
    console.log(`  ok   ${label}`);
    return value;
  } catch (err) {
    failures++;
    console.error(`  FAIL ${label} — ${String((err as Error)?.message ?? err)}`);
    return undefined;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. These tests need a real, throwaway Postgres.");
    process.exit(2);
  }

  // A name nothing else will collide with, so a failed run cannot poison the
  // next one and two runs can share a database.
  const marker = `dbtest-${randomUUID()}`;
  let agentId = "";

  console.log("\nschema");
  {
    check("the schema applies", await ensureSchema());
    // Applied twice on purpose: every statement is IF NOT EXISTS / ADD COLUMN
    // IF NOT EXISTS, and a re-run is what actually happens on every cold start.
    check("the schema is idempotent", await ensureSchema());
  }

  console.log("\nagents");
  {
    const created = await runs("ensureAgent inserts", () =>
      ensureAgent({ name: marker, domain: "emerging tech", categories: ["emerging-tech", "ai-ml"] }),
    );
    agentId = created?.agentId ?? "";
    check("a new agent has an id", agentId.length > 0);

    const again = await runs("ensureAgent is idempotent on the persona hash", () =>
      ensureAgent({ name: marker, domain: "emerging tech", categories: ["emerging-tech", "ai-ml"] }),
    );
    check("the same persona returns the same agent", again?.agentId === agentId, `${again?.agentId} vs ${agentId}`);
    check("and reports it was not created", again?.created === false);

    const settings = await runs("getAgentSettings reads back", () => getAgentSettings(agentId));
    check("the categories round-tripped", settings?.categories.length === 2, JSON.stringify(settings?.categories));

    // The write path the app's most-used control takes.
    const patched = await runs("updateAgentSettings writes categories and the derived scope", () =>
      updateAgentSettings(agentId, { categories: ["compute-silicon"] }),
    );
    check("the category change stuck", patched?.categories.join() === "compute-silicon");
    check("the scope line followed it", patched?.domain === "compute and silicon", patched?.domain);
    check("an empty category list is refused",
      (await updateAgentSettings(agentId, { categories: [] }))?.categories.join() === "compute-silicon");

    await runs("updateAgentSettings writes a style patch", () =>
      updateAgentSettings(agentId, { style: { hashtagCount: 4 }, corpus: ["x ".repeat(60)] }),
    );
    await runs("updateAgentSettings writes the schedule fields", () =>
      updateAgentSettings(agentId, { timezone: "Asia/Kolkata", postTimeLocal: "09:30", autoPublishCap: 2 }),
    );
    await runs("getPrimaryAgent", () => getPrimaryAgent());
    await runs("voiceReferencesFor joins posts", () => {
      const s = getAgentSettings(agentId);
      return s.then((v) => (v ? voiceReferencesFor(v) : Promise.resolve(null)));
    });
  }

  console.log("\nslots — the queries that had never run");
  {
    await runs("ensureSlotsMigrated", () => ensureSlotsMigrated(agentId, "09:30", "Asia/Kolkata", false));

    const made = await runs("createSlot", () =>
      createSlot(agentId, "Asia/Kolkata", { localTime: "09:30", leadMinutes: 30 }),
    );
    const slotId = made && made.ok ? made.slot.id : "";
    check("the slot was created", slotId.length > 0, JSON.stringify(made));

    await runs("listSlots", () => listSlots(agentId));
    await runs("updateSlot", () =>
      updateSlot(agentId, slotId, "Asia/Kolkata", { leadMinutes: 45, enabled: true }),
    );

    // THE regression. listDueSlots joins post_slots to agents, and both carry a
    // categories_json column — an unqualified reference is rejected by Postgres
    // as ambiguous, which is a runtime error no type checker can see.
    const due = await runs("listDueSlots (the ambiguous-column regression)", () => listDueSlots());
    check("listDueSlots returned a list", Array.isArray(due), typeof due);

    await runs("slotTimeline", () => slotTimeline(agentId, 7));
    await runs("schedulerHealth", () => schedulerHealth());
    await runs("recordTick", () => recordTick());

    // The claim/settle pair, including the retry-after-failure behaviour that
    // used to burn a slot for the whole day. Exactly-once for a run that
    // produced something; retryable only for one that failed outright.
    const slot = (await listSlots(agentId)).find((s) => s.id === slotId)!;
    const runDate = "2999-01-01"; // far future, so it cannot collide with a real run
    const fakeDue = {
      slot,
      timezone: "Asia/Kolkata",
      scheduledFor: new Date(Date.now() + 3_600_000),
      runDate,
      missed: false,
    };
    const claimed = await runs("claimSlotRun", () => claimSlotRun(fakeDue));
    check("the first claim succeeds", claimed === true);
    check("the second claim is refused", (await claimSlotRun(fakeDue)) === false);
    await runs("settleSlotRun records a failure", () => settleSlotRun(slotId, runDate, "failed"));
    check("a failed run may be retried", (await claimSlotRun(fakeDue)) === true);
    await runs("settleSlotRun records silence", () => settleSlotRun(slotId, runDate, "silent"));
    check("a settled run is not retried", (await claimSlotRun(fakeDue)) === false);

    // The advisory lock is transaction-scoped so it survives pgbouncer. That is
    // a property of the connection, not of the code, so it needs a real server.
    const locked = await runs("withSlotLock runs the body", () =>
      withSlotLock(slotId, async () => "ran", "busy"),
    );
    check("the lock body ran", locked === "ran");

    await runs("deleteSlot", () => deleteSlot(agentId, slotId));
  }

  console.log("\nposts, budgets and the dashboard fan-out");
  {
    // A published post, so the read paths have something to find rather than
    // returning empty and proving nothing.
    await runs("insert a post", () =>
      query(
        `INSERT INTO posts (agent_id, seq, text, rationale, sources_json, fingerprint, scores_json,
                            cycle_id, status, kind, category, hashtags_json, used_quote, published_at)
         VALUES ($1, 1, $2, 'because', '[]'::jsonb, 'fp — a summary', '{}'::jsonb,
                 1, 'published', 'auto', 'compute-silicon', '["Silicon"]'::jsonb, false, now())`,
        [agentId, "A published post body long enough to be picked up as a voice sample. ".repeat(6)],
      ),
    );

    await runs("sendsToday counts from local midnight", () => sendsToday(agentId, "Asia/Kolkata"));
    await runs("listAmbiguousSends", () => listAmbiguousSends(agentId));
    await runs("getAccountStatus with no connection", () => getAccountStatus(agentId));
    await runs("getTodayCalls", () => getTodayCalls());
    await runs("recall falls back to Postgres fingerprints", () => recall(agentId, "silicon"));
    await runs("insert a rejection", () =>
      query(
        `INSERT INTO rejections (agent_id, cycle_id, title, url, scores_json, reason)
         VALUES ($1, 1, 't', 'https://example.com/x', '{}'::jsonb, 'r')`,
        [agentId],
      ),
    );

    // The exact UNION the status route runs. It is the single most-hit query in
    // the app and the one most likely to break when a column is added.
    await runs("the status route's queue+history UNION", () =>
      query(
        `(SELECT id, seq, text, status, scheduled_for FROM posts
            WHERE agent_id = $1 AND status IN ('draft','approved','failed','unknown','missed')
            ORDER BY scheduled_for ASC NULLS LAST, created_at DESC LIMIT 20)
         UNION ALL
         (SELECT id, seq, text, status, scheduled_for FROM posts
            WHERE agent_id = $1 AND status = 'published'
            ORDER BY published_at DESC NULLS LAST, seq DESC LIMIT 20)`,
        [agentId],
      ),
    );

    // The judge's coverage input, added with the category-balance change.
    await runs("recent categories for the coverage tilt", () =>
      query(
        `SELECT category FROM posts WHERE agent_id = $1 AND category IS NOT NULL
          ORDER BY seq DESC LIMIT 12`,
        [agentId],
      ),
    );
  }

  console.log("\nlogin rate limiting");
  {
    const client = `dbtest-${randomUUID()}`;
    const fresh = await runs("checkLoginAllowed on an unseen client", () => checkLoginAllowed(client));
    check("an unseen client is allowed", fresh?.allowed === true);

    for (let i = 0; i < MAX_ATTEMPTS; i++) await recordLoginFailure(client);
    const blocked = await runs("checkLoginAllowed after the limit", () => checkLoginAllowed(client));
    check("the client is blocked at the limit", blocked?.allowed === false, JSON.stringify(blocked));
    check("it reports how long to wait", (blocked?.retryAfterMinutes ?? 0) > 0);

    await runs("clearLoginFailures", () => clearLoginFailures(client));
    check("a correct password forgives the history",
      (await checkLoginAllowed(client))?.allowed === true);
  }

  console.log("\npush notifications");
  {
    const token = `dbtest-token-${randomUUID()}${"x".repeat(40)}`;
    await runs("registerDevice inserts", () => registerDevice(agentId, token, "android"));
    await runs("registerDevice is an upsert", () => registerDevice(agentId, token, "android"));
    check("the device was stored once",
      (await query("SELECT 1 FROM device_tokens WHERE token = $1", [token])).length === 1);

    // Without FCM credentials notify() must be a no-op rather than an error:
    // the app has to work identically for someone who never set push up.
    check("push is not configured in tests", pushConfigured() === false);
    const sent = await runs("notify is a silent no-op with no credentials", () =>
      notify(agentId, { kind: "published", seq: 1 }),
    );
    check("nothing was delivered", sent === 0);

    // The cooldown query is the part with real SQL in it — an interval cast and
    // a count — and it runs on every single notification.
    await runs("the cooldown query executes", () =>
      query(
        `SELECT count(*) AS recent FROM push_log
          WHERE agent_id = $1 AND kind = $2 AND sent_at > now() - ($3 || ' minutes')::interval`,
        [agentId, "scheduler_stalled", "360"],
      ),
    );
    await runs("push_log accepts a row", () =>
      query("INSERT INTO push_log (agent_id, kind) VALUES ($1, $2)", [agentId, "published"]),
    );

    await runs("forgetDevice removes it", () => forgetDevice(token));
    check("the device is gone",
      (await query("SELECT 1 FROM device_tokens WHERE token = $1", [token])).length === 0);
  }

  // ---- cleanup. Ordered by foreign key, deepest first.
  console.log("\ncleanup");
  {
    await runs("remove everything this run created", async () => {
      if (!agentId) return;
      // slot_runs is keyed by slot, not agent, so it goes first and by slot id.
      await query(
        "DELETE FROM slot_runs WHERE slot_id IN (SELECT id FROM post_slots WHERE agent_id = $1)",
        [agentId],
      ).catch(() => []);
      for (const table of ["push_log", "device_tokens", "distributions", "media_assets", "rejections", "posts", "post_slots", "scheduler_state", "linkedin_accounts"]) {
        await query(`DELETE FROM ${table} WHERE agent_id = $1`, [agentId]).catch(() => []);
      }
      await query("DELETE FROM agents WHERE id = $1", [agentId]);
    });
    check("the agent is gone",
      (await query("SELECT 1 FROM agents WHERE id = $1", [agentId])).length === 0);
  }

  await getPool()?.end();

  console.log(
    failures === 0
      ? `\nAll ${ran} database checks passed.`
      : `\n${failures} of ${ran} database checks FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\ndbtest crashed:", err);
  process.exit(1);
});
