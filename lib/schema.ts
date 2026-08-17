/**
 * Postgres schema, applied idempotently on first DB access (see lib/db.ts).
 * Embedded as a string rather than a .sql file so Next's output tracing can
 * never drop it — the only durable state is Neon Postgres.
 *
 * Inherited from the autonomous-creator base: agents, posts, rejections,
 * scheduler_state, llm_calls, system_status.
 * Added here: the LinkedIn distribution layer — connected accounts, an
 * append-only send ledger keyed by an idempotency key, media assets, and the
 * OAuth state table.
 *
 * Rule: never edit a CREATE TABLE in place once a database exists. Add an
 * ALTER ... IF NOT EXISTS line below it — existing databases only run those.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  domain        TEXT NOT NULL,
  persona_json  JSONB NOT NULL,
  persona_hash  TEXT NOT NULL UNIQUE,
  is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
-- The categories chosen at init; drives discovery weighting and judging.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS categories_json JSONB NOT NULL DEFAULT '[]';
-- Daily cadence: one post attempt per day at post_time_local in timezone.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS post_time_local TEXT NOT NULL DEFAULT '09:30';
-- FALSE = drafts wait in the approval queue. The whole safety posture is here.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS auto_publish BOOLEAN NOT NULL DEFAULT FALSE;
-- Kill switch: paused agents still cycle nothing and distribute nothing.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE;
-- How many posts the AGENT may publish by itself per rolling 24h. Only ever
-- consulted on the auto-publish path; a human pressing Publish is bounded by
-- LinkedIn's own limits instead, not by this.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS auto_publish_cap INT NOT NULL DEFAULT 1;
-- Voice configuration (lib/style.ts): structure, emoji, hook, CTA, length,
-- hashtag cap, signature line, custom rules. An empty object means "house
-- style", so existing agents keep writing exactly what they wrote before.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS style_json JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS posts (
  agent_id      UUID NOT NULL REFERENCES agents(id),
  seq           INT  NOT NULL,
  id            TEXT GENERATED ALWAYS AS ('p' || seq) STORED,
  text          TEXT NOT NULL,
  rationale     TEXT NOT NULL,
  sources_json  JSONB NOT NULL DEFAULT '[]',
  fingerprint   TEXT NOT NULL,
  scores_json   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, seq)
);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS scores_json JSONB;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS continuity TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS cycle_id INT;
-- draft -> approved -> published, or rejected / failed. Drafts are what the
-- approval queue renders; nothing reaches LinkedIn from 'draft'.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
-- 'auto' = the daily agent cycle wrote it; 'custom' = the user composed it.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS category TEXT;
-- Ordered media_assets.id values attached to this post.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_json JSONB NOT NULL DEFAULT '[]';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
-- Hashtags chosen by the writer; appended deterministically at assembly time.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hashtags_json JSONB NOT NULL DEFAULT '[]';
-- Whether this post used a Marvel line, so the writer can ration the signature.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS used_quote BOOLEAN NOT NULL DEFAULT FALSE;
-- Text as actually sent to LinkedIn (after formatting), kept for the record.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS linkedin_text TEXT;

CREATE INDEX IF NOT EXISTS posts_status_idx ON posts (agent_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS rejections (
  id           BIGSERIAL PRIMARY KEY,
  agent_id     UUID NOT NULL REFERENCES agents(id),
  cycle_id     INT  NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT NOT NULL,
  scores_json  JSONB NOT NULL,
  reason       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduler_state (
  agent_id     UUID PRIMARY KEY REFERENCES agents(id),
  last_run_at  TIMESTAMPTZ,
  next_run_at  TIMESTAMPTZ,
  cycle_count  INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS llm_calls (
  day          DATE NOT NULL,
  model        TEXT NOT NULL,
  call_count   INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model)
);

CREATE TABLE IF NOT EXISTS system_status (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- LinkedIn

/*
 * One connected LinkedIn member per agent. Tokens are AES-256-GCM encrypted
 * with TOKEN_ENCRYPTION_KEY (lib/crypto.ts) — a Postgres dump must not be a
 * posting credential.
 *
 * refresh_token_enc is almost always NULL: LinkedIn issues programmatic
 * refresh tokens only to approved Marketing Developer Platform partners. A
 * standard app gets a 60-day access token, so expires_at drives the re-auth
 * banner and the automatic pause.
 */
CREATE TABLE IF NOT EXISTS linkedin_accounts (
  agent_id          UUID PRIMARY KEY REFERENCES agents(id),
  member_urn        TEXT NOT NULL,
  member_name       TEXT,
  member_picture    TEXT,
  access_token_enc  TEXT NOT NULL,
  refresh_token_enc TEXT,
  scopes            TEXT,
  expires_at        TIMESTAMPTZ NOT NULL,
  connected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at        TIMESTAMPTZ,
  last_error        TEXT
);

/*
 * The send ledger. THE most important table for not embarrassing yourself:
 * idempotency_key is UNIQUE, so a duplicate cron tick, a retried request, or
 * a double-clicked Publish button can insert at most one row per post — and
 * only the transaction that wins the insert may call the LinkedIn API.
 *
 * status lifecycle: in_flight -> sent | failed.
 * 'in_flight' rows are NEVER auto-retried. If the process dies between the
 * API call and the status update we cannot tell whether LinkedIn accepted it,
 * and r_member_social (which would let us read our own posts back) is a
 * restricted scope we do not have. An orphaned in_flight row is surfaced in
 * the UI for a human to check rather than silently retried into a double post.
 */
CREATE TABLE IF NOT EXISTS distributions (
  id               BIGSERIAL PRIMARY KEY,
  agent_id         UUID NOT NULL REFERENCES agents(id),
  seq              INT,
  idempotency_key  TEXT NOT NULL UNIQUE,
  target           TEXT NOT NULL DEFAULT 'linkedin_member',
  status           TEXT NOT NULL DEFAULT 'in_flight',
  external_urn     TEXT,
  attempts         INT  NOT NULL DEFAULT 0,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at       TIMESTAMPTZ
);

/*
 * 'auto'   — the daily cycle published this without a human.
 * 'manual' — a person pressed Publish.
 * The two are capped separately: the agent gets a deliberately small allowance
 * so a logic error cannot spam a real profile, while a human is limited only
 * by what LinkedIn itself permits. Defaulting to 'manual' is the safe choice
 * for pre-existing rows: it never makes the agent's allowance look emptier
 * than it is.
 */
ALTER TABLE distributions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS distributions_agent_idx ON distributions (agent_id, created_at DESC);

/*
 * Media registered with LinkedIn. The browser PUTs bytes straight to
 * upload_url (Vercel caps request bodies near 4.5MB, so proxying images
 * through the function would break on ordinary phone photos).
 */
CREATE TABLE IF NOT EXISTS media_assets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     UUID NOT NULL REFERENCES agents(id),
  kind         TEXT NOT NULL DEFAULT 'image',
  linkedin_urn TEXT NOT NULL,
  upload_url   TEXT NOT NULL,
  alt_text     TEXT,
  filename     TEXT,
  status       TEXT NOT NULL DEFAULT 'initialized',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* Short-lived CSRF state for the OAuth round trip; swept on use and by age. */
CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  agent_id    UUID NOT NULL REFERENCES agents(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
