/**
 * Breeth memory client — thin typed wrapper over https://api.thebreeth.com/v1.
 *
 * ARCHITECTURAL CONSTRAINT:
 * Breeth is an ENHANCEMENT layer, never a hard dependency. Postgres is the
 * source of truth for posts, rejections, and scheduler state. If Breeth is
 * unreachable, quota-exceeded, or slow, the agent must keep publishing on
 * schedule using Postgres-only fallback memory. Nothing on a user-facing
 * request path may ever await a Breeth call. A dead memory service degrades
 * the quality of the agent's judgment, never its availability.
 *
 * Consequences encoded here:
 * - No function in this module ever throws across the module boundary; every
 *   call resolves to a discriminated BreethResult the caller must inspect.
 * - 8s AbortController timeout on every request.
 * - One retry with backoff on 500s and network errors only. 402
 *   (payment_required) and 429 (quota_exceeded) are hard stops: never
 *   retried, flip the module into degraded mode (see isDegraded()).
 * - POST /v1/episodes is NOT idempotent — a blind retry of a non-network
 *   failure would double-write, so only transport-level failures retry.
 */

const BASE_URL = "https://api.thebreeth.com/v1";
// Reads (search/health) stay tight; episode writes measured ~16.5s in the
// smoke test, so they get a longer leash. Episodes only ever run inside the
// background cycle (300s budget) — never on a user-facing request path.
const TIMEOUT_MS = 8_000;
const WRITE_TIMEOUT_MS = 30_000;
const RETRY_BACKOFF_MS = 750;

export type BreethResult<T> = { ok: true; data: T } | { ok: false; reason: string };

export interface EpisodeWriteData {
  ok?: boolean;
  entities?: number;
  relationships?: number;
  [key: string]: unknown;
}

export interface SearchEdge {
  edge_uuid: string;
  source_node: string;
  target_node: string;
  fact: string;
  name: string;
  intent_meta?: Record<string, unknown>;
  _tier?: string;
  [key: string]: unknown;
}

// Flips true after a hard-stop error (402 payment_required / 429
// quota_exceeded) and stays true for the life of the process: once quota or
// billing is exhausted, further calls this billing period are pointless.
let degraded = false;

export function isDegraded(): boolean {
  return degraded;
}

const HARD_STOP_STATUSES = new Set([402, 429]);

async function request<T>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number = TIMEOUT_MS,
): Promise<BreethResult<T>> {
  const key = process.env.BREETH_API_KEY;
  if (!key) return { ok: false, reason: "missing_api_key" };

  for (let attempt = 0; attempt <= 1; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (res.ok) {
        return { ok: true, data: (await res.json()) as T };
      }

      let slug = `http_${res.status}`;
      try {
        const err = (await res.json()) as { error?: string };
        if (err.error) slug = err.error;
      } catch {
        // non-JSON error body; keep the http_<status> slug
      }

      if (HARD_STOP_STATUSES.has(res.status)) {
        degraded = true;
        console.error(`[breeth] hard stop ${res.status} ${slug} — degraded mode on, no retry`);
        return { ok: false, reason: slug };
      }

      if (res.status >= 500 && attempt === 0) {
        continue;
      }

      // 400/401/403 etc. — caller error or auth problem; retrying won't help.
      return { ok: false, reason: slug };
    } catch (err) {
      const reason =
        err instanceof Error && err.name === "AbortError" ? "timeout" : "network_error";
      if (attempt === 0) continue;
      return { ok: false, reason };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, reason: "unreachable" };
}

/**
 * Write a prose memory. `extractIntent` is an explicit caller decision:
 * true for writes carrying an editorial decision, false for plain content.
 * NOT idempotent — calling twice with the same content creates two episodes.
 */
export async function writeEpisode(opts: {
  agentId: string;
  content: string;
  extractIntent: boolean;
}): Promise<BreethResult<EpisodeWriteData>> {
  return request<EpisodeWriteData>(
    "/episodes",
    {
      content: opts.content,
      group_id: `agent-${opts.agentId}`,
      extract_intent: opts.extractIntent,
    },
    WRITE_TIMEOUT_MS,
  );
}

/** Hybrid BM25 + vector + graph retrieval, scoped to the agent's namespace. */
export async function search(opts: {
  agentId: string;
  query: string;
  limit?: number;
}): Promise<BreethResult<SearchEdge[]>> {
  const result = await request<{ edges?: SearchEdge[] }>("/search", {
    query: opts.query,
    group_id: `agent-${opts.agentId}`,
    limit: opts.limit ?? 10,
  });
  if (!result.ok) return result;
  return { ok: true, data: result.data.edges ?? [] };
}

/**
 * Breeth documents no health endpoint, so this is the cheapest authenticated
 * round-trip available: a 1-edge search in a reserved namespace. Note it
 * counts against the monthly retrieval quota — call it sparingly.
 */
export async function healthCheck(): Promise<BreethResult<{ reachable: true; latencyMs: number }>> {
  const started = Date.now();
  const result = await request<unknown>("/search", {
    query: "healthcheck",
    group_id: "agent-healthcheck",
    limit: 1,
  });
  if (!result.ok) return result;
  return { ok: true, data: { reachable: true, latencyMs: Date.now() - started } };
}
