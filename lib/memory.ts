/**
 * Memory layer: Breeth (intent-aware graph memory) with Postgres fallback.
 *
 * Breeth is an ENHANCEMENT, never a hard dependency. When it is unreachable,
 * quota-exceeded, or slow, recall degrades to the last 20 post fingerprints
 * from Postgres and the agent keeps publishing on schedule. Degradation is
 * surfaced honestly (source/degraded fields), never hidden.
 *
 * Episode formatting rule (learned from the smoke test): episodes must be
 * natural prose with the agent NAMED as subject and real predicates —
 * "Ada published an analysis of X because Y". Terse fragments produce zero
 * graph edges, and search returns only edges, so bad prose makes the memory
 * silently write-only.
 */
import { isDegraded, search, writeEpisode } from "./breeth";
import { query } from "./db";

export interface MemoryContext {
  facts: string[];
  source: "breeth" | "postgres" | "none";
  degraded: boolean;
}

/** Persist Breeth health so the UI (any lambda) can report it honestly. */
async function recordBreethStatus(healthy: boolean, note: string): Promise<void> {
  try {
    await query(
      `INSERT INTO system_status (key, value, updated_at) VALUES ('breeth', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()`,
      [JSON.stringify({ healthy, note })],
    );
  } catch {
    // status is best-effort; never let it affect a cycle
  }
}

async function fingerprintFallback(agentId: string): Promise<string[]> {
  try {
    const rows = await query<{ fingerprint: string }>(
      "SELECT fingerprint FROM posts WHERE agent_id = $1 ORDER BY seq DESC LIMIT 20",
      [agentId],
    );
    return rows.map((r) => r.fingerprint);
  } catch {
    return [];
  }
}

/** Recall prior coverage and editorial positions relevant to `topics`. */
export async function recall(agentId: string, topics: string): Promise<MemoryContext> {
  const res = await search({
    agentId,
    query: `previous coverage and editorial position on ${topics}`,
    limit: 10,
  });
  await recordBreethStatus(res.ok, res.ok ? `search ok (${res.data.length} facts)` : `search failed: ${res.reason}`);
  if (res.ok && res.data.length > 0) {
    return { facts: res.data.map((e) => e.fact), source: "breeth", degraded: false };
  }
  const fallback = await fingerprintFallback(agentId);
  if (fallback.length > 0) {
    return { facts: fallback, source: "postgres", degraded: !res.ok };
  }
  return { facts: [], source: "none", degraded: !res.ok };
}

/**
 * Record a publish decision as an intent-carrying episode. Processing is
 * async server-side (returns a task_id) — we do not block on it, only on the
 * write itself (~16s, acceptable inside the awaited background cycle).
 */
export async function rememberPublish(
  agentId: string,
  agentName: string,
  post: { title: string; rationale: string; runnersUp: string[] },
): Promise<void> {
  const runnerText =
    post.runnersUp.length > 0
      ? ` ${agentName} chose it over ${post.runnersUp.map((t) => `"${t}"`).join(" and ")}.`
      : "";
  const content =
    `${agentName} published a post about "${post.title}".` +
    ` ${agentName} selected this topic because ${post.rationale}` +
    runnerText;
  const res = await writeEpisode({ agentId, content, extractIntent: true });
  await recordBreethStatus(res.ok, res.ok ? "episode write ok" : `episode write failed: ${res.reason}`);
  if (!res.ok) console.warn(`[memory] publish episode failed: ${res.reason}`);
}

/** Record what was passed over and why, so standards accumulate across cycles. */
export async function rememberRejections(
  agentId: string,
  agentName: string,
  rejects: { title: string; reason: string }[],
): Promise<void> {
  if (rejects.length === 0) return;
  const content = rejects
    .slice(0, 3)
    .map((r) => `${agentName} passed over the story "${r.title}" because ${r.reason}`)
    .join(" ");
  const res = await writeEpisode({ agentId, content, extractIntent: false });
  if (!res.ok) console.warn(`[memory] rejection episode failed: ${res.reason}`);
}

/** Current memory health, for the UI. */
export function memoryDegraded(): boolean {
  return isDegraded();
}
