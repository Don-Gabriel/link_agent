/**
 * Agent init, settings, and idempotency.
 *
 * The persona payload is canonicalized (recursively sorted keys) and hashed;
 * the hash has a UNIQUE constraint, so re-running init with identical input
 * returns the existing agent and never resets state, while different input
 * creates a new, fully isolated one.
 *
 * This app is single-operator in practice — one person, one profile — so
 * getPrimaryAgent() is what the UI and cron actually use. The multi-agent
 * structure is inherited and kept because it costs nothing and keeps the
 * option open.
 */
import { createHash } from "node:crypto";
import type { CategoryId } from "./categories";
import { LEGACY_CATEGORY_IDS as ALL_CATEGORY_IDS, describeCategories, parseCategories, sameCategorySet } from "./categories";
import { query } from "./db";
import { MAX_AUTO_CAP } from "./distribute";
import { expandPersona, type PersonaRecord } from "./persona";
import { normalizeHhMm } from "./schedule";
import { parseStyle, type StyleConfig } from "./style";
import { parseCorpus, pickSamples, SAMPLES_IN_PROMPT, type VoiceSample } from "./voice";

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}

export interface InitPersona {
  name: string;
  domain: string;
  categories?: CategoryId[];
  [key: string]: unknown;
}

export interface AgentSettings {
  agentId: string;
  name: string;
  domain: string;
  categories: CategoryId[];
  timezone: string;
  postTimeLocal: string;
  autoPublish: boolean;
  paused: boolean;
  active: boolean;
  /** How many posts the AGENT may send per rolling 24h, 1-3. Manual publishing
   *  is bounded by LinkedIn's limits instead — see lib/distribute.ts. */
  autoPublishCap: number;
  /** Always complete — parseStyle fills every field from the house style. */
  style: StyleConfig;
  /** Writing samples the author supplied, as few-shot examples for the writer. */
  corpus: string[];
  /** Standing summary of how this author rewrites the agent. Null until earned. */
  editNotes: string | null;
}

export async function ensureAgent(
  persona: InitPersona,
  options: { timezone?: string; postTimeLocal?: string } = {},
): Promise<{ agentId: string; created: boolean }> {
  const categories = parseCategories(persona.categories);
  const hash = createHash("sha256").update(canonicalize(persona)).digest("hex");

  const inserted = await query<{ id: string }>(
    `INSERT INTO agents (name, domain, persona_json, persona_hash, categories_json, timezone, post_time_local)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (persona_hash) DO NOTHING
     RETURNING id`,
    [
      persona.name,
      persona.domain,
      JSON.stringify({ input: persona }),
      hash,
      JSON.stringify(categories.length > 0 ? categories : ALL_CATEGORY_IDS),
      options.timezone ?? "Asia/Kolkata",
      options.postTimeLocal ?? "09:30",
    ],
  );

  if (inserted.length === 0) {
    const existing = await query<{ id: string }>("SELECT id FROM agents WHERE persona_hash = $1", [
      hash,
    ]);
    return { agentId: existing[0].id, created: false };
  }

  const agentId = inserted[0].id;
  // Due immediately: the first cycle runs right after init responds.
  await query(
    `INSERT INTO scheduler_state (agent_id, next_run_at) VALUES ($1, now())
     ON CONFLICT (agent_id) DO NOTHING`,
    [agentId],
  );
  return { agentId, created: true };
}

/**
 * The one LLM call that expands the raw persona into a full editorial
 * identity. Deliberately NOT part of ensureAgent: init must answer fast (pure
 * DB work), so callers run this in the background via after(). expandPersona
 * never throws — it falls back mechanically if the LLM is unavailable. Until
 * it completes, getPersona returns null and cycles skip harmlessly.
 */
export async function expandStoredPersona(agentId: string): Promise<void> {
  const rows = await query<{
    persona_json: { input: InitPersona; identity?: unknown };
    categories_json: CategoryId[];
  }>("SELECT persona_json, categories_json FROM agents WHERE id = $1", [agentId]);
  if (rows.length === 0 || rows[0].persona_json.identity) return; // gone or already expanded
  const input = rows[0].persona_json.input;
  const record = await expandPersona(input.name, input.domain, rows[0].categories_json ?? []);
  await query("UPDATE agents SET persona_json = $2 WHERE id = $1", [
    agentId,
    JSON.stringify({ ...record, input }),
  ]);
}

/**
 * Rebuild the stored identity when it no longer matches the agent's categories.
 *
 * The persona is DERIVED from the categories, so switching one off has to
 * change it. Nothing did: expandStoredPersona refuses to re-run once
 * `identity` exists and updateAgentSettings never touched persona_json, so an
 * agent whose music categories had been switched off months ago still carried
 * music interests, music opinions and a music domain line into every judge and
 * writer prompt. Discovery stopped fetching music; the persona kept asking for
 * it, so whatever in the remaining feeds looked closest to music won.
 *
 * Called at the top of a cycle rather than from the settings PATCH on purpose:
 * selecting categories is several taps and each one is its own request, so
 * rebuilding per request would spend an LLM call per tap. The domain line the
 * UI reads is updated synchronously by updateAgentSettings; only the identity
 * waits, and it waits exactly until the moment it is next used.
 *
 * Never throws, and never leaves the agent without an identity: a failed
 * rebuild keeps the previous record, and the next cycle tries again.
 */
export async function refreshPersonaIfStale(agentId: string): Promise<boolean> {
  try {
    const rows = await query<{
      name: string;
      persona_json: PersonaRecord & { input: InitPersona };
      categories_json: CategoryId[];
    }>("SELECT name, persona_json, categories_json FROM agents WHERE id = $1", [agentId]);
    const record = rows[0]?.persona_json;
    // Not expanded yet — that is expandStoredPersona's job, not this one's.
    if (!record?.identity || (record as unknown as {managed?:boolean}).managed) return false;

    const parsed = parseCategories(rows[0].categories_json);
    const categories = parsed.length > 0 ? parsed : ALL_CATEGORY_IDS;
    // A record with no builtFor predates this field: rebuild once to learn it.
    // A fallback record is retried too — it is the mechanical identity written
    // when the LLM was unavailable, and it should not be the permanent answer.
    const fresh =
      record.builtFor !== undefined &&
      record.generator === "llm" &&
      sameCategorySet(record.builtFor, categories);
    if (fresh) return false;

    const domain = describeCategories(categories);
    const rebuilt = await expandPersona(rows[0].name, domain, categories);
    await query("UPDATE agents SET persona_json = $2, domain = $3 WHERE id = $1", [
      agentId,
      // input.name is preserved; input.domain follows the categories, because
      // personaBlock prints it and a stale one is the loudest bias in the prompt.
      // input.categories is refreshed for the same reason — it is not read by
      // anything today, and leaving the setup-time list sitting in the record
      // is exactly the kind of quietly-wrong field this whole change is about.
      JSON.stringify({
        ...rebuilt,
        input: { ...record.input, name: rows[0].name, domain, categories },
      }),
      domain,
    ]);
    console.log(
      `[persona] rebuilt for agent=${agentId} (${rebuilt.generator}) — categories now: ${categories.join(", ")}`,
    );
    return true;
  } catch (err) {
    // A cycle with a slightly stale persona is far better than no cycle.
    console.warn("[persona] refresh failed, keeping the stored identity:", String((err as Error)?.message ?? err));
    return false;
  }
}

export async function getPersona(agentId: string): Promise<PersonaRecord | null> {
  const rows = await query<{ persona_json: PersonaRecord }>(
    "SELECT persona_json FROM agents WHERE id = $1",
    [agentId],
  );
  if (rows.length === 0) return null;
  const p = rows[0].persona_json;
  if (!p.identity) return null; // persona expansion still pending or failed badly
  return p;
}

interface SettingsRow {
  id: string;
  name: string;
  domain: string;
  categories_json: CategoryId[];
  timezone: string;
  post_time_local: string;
  auto_publish: boolean;
  paused: boolean;
  active: boolean;
  auto_publish_cap: number | null;
  style_json: unknown;
  corpus_json: unknown;
  edit_notes: string | null;
}

function toSettings(r: SettingsRow): AgentSettings {
  const categories = parseCategories(r.categories_json);
  return {
    agentId: r.id,
    name: r.name,
    domain: r.domain,
    categories: categories.length > 0 ? categories : ALL_CATEGORY_IDS,
    timezone: r.timezone,
    postTimeLocal: r.post_time_local,
    autoPublish: r.auto_publish,
    paused: r.paused,
    active: r.active,
    autoPublishCap: Math.min(MAX_AUTO_CAP, Math.max(1, r.auto_publish_cap ?? 1)),
    style: parseStyle(r.style_json),
    corpus: parseCorpus(r.corpus_json),
    editNotes: r.edit_notes,
  };
}

const SETTINGS_COLUMNS =
  `id, name, domain, categories_json, timezone, post_time_local, auto_publish, paused, active,
   auto_publish_cap, style_json, corpus_json, edit_notes`;

export async function getAgentSettings(agentId: string): Promise<AgentSettings | null> {
  const rows = await query<SettingsRow>(
    `SELECT ${SETTINGS_COLUMNS} FROM agents WHERE id = $1`,
    [agentId],
  );
  return rows[0] ? toSettings(rows[0]) : null;
}

/** The single agent this installation drives. Null before init has run. */
export async function getPrimaryAgent(): Promise<AgentSettings | null> {
  const rows = await query<SettingsRow>(
    `SELECT ${SETTINGS_COLUMNS} FROM agents WHERE active AND owner_id IS NULL ORDER BY created_at LIMIT 1`,
  );
  return rows[0] ? toSettings(rows[0]) : null;
}

/**
 * The author's voice references: the samples they chose plus what they have
 * actually published, and the standing notes learned from their edits.
 *
 * Shared by the cycle and by the composer's rewrite actions on purpose. The
 * cycle used to be the only caller, so "Rewrite with AI" ran on the style
 * toggles alone — the writing samples and edit notes, which are the half of
 * the Voice screen that actually carries a voice, never reached it. Editing
 * them changed what the agent wrote on its own and changed nothing about the
 * rewrites, which reads exactly like the setting being ignored.
 */
export interface VoiceReferences {
  samples: VoiceSample[];
  editNotes: string | null;
}

export async function voiceReferencesFor(agent: AgentSettings): Promise<VoiceReferences> {
  const published = (
    await query<{ text: string }>(
      // posts.text, not original_text: the published version is the one the
      // author was willing to sign, edits and all. That is the voice to imitate.
      // Drafts are excluded — text nobody approved is not evidence of anything.
      `SELECT text FROM posts
        WHERE agent_id = $1 AND status = 'published' AND length(text) > 200
        ORDER BY published_at DESC NULLS LAST, seq DESC
        LIMIT $2`,
      [agent.agentId, SAMPLES_IN_PROMPT * 2],
    )
  ).map((r) => r.text);
  return { samples: pickSamples(agent.corpus, published), editNotes: agent.editNotes };
}

export interface SettingsPatch {
  categories?: CategoryId[];
  timezone?: string;
  postTimeLocal?: string;
  autoPublish?: boolean;
  paused?: boolean;
  autoPublishCap?: number;
  /** Partial style patch, merged over the current config and re-validated. */
  style?: Partial<StyleConfig>;
  /** Replaces the writing samples wholesale. An empty array clears them. */
  corpus?: string[];
}

export async function updateAgentSettings(
  agentId: string,
  patch: SettingsPatch,
): Promise<AgentSettings | null> {
  const sets: string[] = [];
  const params: unknown[] = [agentId];

  const push = (fragment: string, value: unknown) => {
    params.push(value);
    sets.push(`${fragment} = $${params.length}`);
  };

  if (patch.categories) {
    const categories = parseCategories(patch.categories);
    // Refuse to leave the agent with nothing to look for — an empty category
    // list would silently discover nothing and look like a broken cron.
    if (categories.length === 0) return getAgentSettings(agentId);
    push("categories_json", JSON.stringify(categories));
    // The scope line is a rendering of the categories, so it moves with them in
    // the same write. It used to be free text typed once at setup, which is how
    // the app came to describe an agent as covering music above a list of
    // chips with every music category switched off. The full identity is
    // rebuilt later, by refreshPersonaIfStale at the top of the next cycle.
    push("domain", describeCategories(categories));
    // Managed profiles keep the author's voice and examples, while their
    // scope follows the currently selected subjects in the same transaction.
    params.push(describeCategories(categories));
    sets.push(`persona_json = CASE WHEN persona_json->>'managed'='true' THEN jsonb_set(persona_json,'{input,domain}',to_jsonb($${params.length}::text)) ELSE persona_json END`);
  }
  if (patch.timezone) push("timezone", patch.timezone);
  if (patch.postTimeLocal !== undefined) {
    // Normalize rather than pattern-match: "9:30" and "18:00:00" are both
    // things a browser will hand us, and the old strict test dropped them on
    // the floor while still reporting success.
    const normalized = normalizeHhMm(patch.postTimeLocal);
    if (normalized) push("post_time_local", normalized);
  }
  if (typeof patch.autoPublish === "boolean") push("auto_publish", patch.autoPublish);
  if (typeof patch.paused === "boolean") push("paused", patch.paused);
  if (typeof patch.autoPublishCap === "number" && Number.isFinite(patch.autoPublishCap)) {
    // Clamped rather than rejected: the ceiling is a safety property of the
    // agent, not a preference, so an out-of-range request lands at the bound.
    push("auto_publish_cap", Math.min(MAX_AUTO_CAP, Math.max(1, Math.round(patch.autoPublishCap))));
  }

  if (patch.corpus !== undefined) {
    // Replaced wholesale rather than merged: the corpus is an ordered list the
    // author edits as a set, and a merge would make removing a sample impossible.
    push("corpus_json", JSON.stringify(parseCorpus(patch.corpus)));
  }

  if (patch.style) {
    // Merge over the CURRENT style rather than over the defaults, so the UI can
    // send one changed toggle without silently resetting every other field.
    const current = await getAgentSettings(agentId);
    const merged = parseStyle({ ...(current?.style ?? {}), ...patch.style });
    push("style_json", JSON.stringify(merged));
  }

  if (sets.length === 0) return getAgentSettings(agentId);
  await query(`UPDATE agents SET ${sets.join(", ")} WHERE id = $1`, params);
  return getAgentSettings(agentId);
}
