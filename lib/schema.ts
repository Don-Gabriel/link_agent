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
/*
 * Writing samples the author supplied — posts of their own they are happy with,
 * or ones whose voice they want to borrow. Used as few-shot examples in the
 * writer prompt.
 *
 * This is the largest single lever on how the output sounds, and until it
 * existed the writer had never read one thing the author actually wrote: the
 * persona was invented by an LLM at init from a name and a one-line domain, and
 * every post for months afterwards was written against that invention. Style
 * RULES describe a voice from the outside; examples are the voice.
 */
ALTER TABLE agents ADD COLUMN IF NOT EXISTS corpus_json JSONB NOT NULL DEFAULT '[]';
/*
 * A standing summary of how this author rewrites the agent, distilled from
 * (original_text, text) pairs on posts they edited before publishing. Null
 * until enough pairs exist to say anything honest.
 */
ALTER TABLE agents ADD COLUMN IF NOT EXISTS edit_notes TEXT;
/* How many edit pairs the current edit_notes was derived from, so the summary
 * is only recomputed when genuinely new evidence has accumulated. */
ALTER TABLE agents ADD COLUMN IF NOT EXISTS edit_notes_from INT NOT NULL DEFAULT 0;

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
ALTER TABLE posts ADD COLUMN IF NOT EXISTS client_request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS posts_client_request_idx ON posts(agent_id,client_request_id) WHERE client_request_id IS NOT NULL;
-- Ordered media_assets.id values attached to this post.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_json JSONB NOT NULL DEFAULT '[]';
-- When this post is due to reach LinkedIn. NULL means "not on a schedule" —
-- an old-style draft, or one the author will send by hand.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
-- Which slot produced this, if any. Deliberately NOT a foreign key: deleting a
-- slot must not cascade into published history, and a post that outlives its
-- slot is normal rather than an error.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS slot_id UUID;
-- When a human said yes. The publisher requires either this or the slot's own
-- auto_publish — an unreviewed draft never goes out on hold-mode slots.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ;
-- Set while the composer has this post open, so the scheduled send cannot fire
-- mid-edit and publish half a sentence. Carries an expiry rather than a flag:
-- a crashed app must not be able to silence a slot forever.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hold_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS posts_due_idx ON posts (agent_id, status, scheduled_for);
-- Hashtags chosen by the writer; appended deterministically at assembly time.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hashtags_json JSONB NOT NULL DEFAULT '[]';
-- Whether this post used a Marvel line, so the writer can ration the signature.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS used_quote BOOLEAN NOT NULL DEFAULT FALSE;
-- Text as actually sent to LinkedIn (after formatting), kept for the record.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS linkedin_text TEXT;
/*
 * What the agent wrote, before the author touched it. Captured on the FIRST
 * edit only, so it always holds the machine's version rather than the previous
 * human revision.
 *
 * Every time someone rewrites a draft before publishing they produce a labelled
 * training pair — the AI version, and the version a human was willing to sign.
 * That is the highest-quality signal this system will ever have about the
 * author's voice, and until this column existed the edit overwrote posts.text
 * in place and the original was gone forever.
 */
ALTER TABLE posts ADD COLUMN IF NOT EXISTS original_text TEXT;

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

/*
 * The daily timetable. One row per recurring posting time.
 *
 * This replaces agents.post_time_local, which held a single HH:MM and could
 * therefore only ever describe one post a day. That column is left in place and
 * still populated — it is the migration source (see lib/slots.ts) and the value
 * the web dashboard reads — but the scheduler no longer consults it.
 *
 * next_run_at stores the next OCCURRENCE (when the post should go out), not the
 * next generation time. Generation is derived as next_run_at - lead_minutes in
 * the due query, so the two can never drift apart the way two stored timestamps
 * eventually would.
 */
CREATE TABLE IF NOT EXISTS post_slots (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         UUID NOT NULL REFERENCES agents(id),
  local_time       TEXT NOT NULL,
  -- Bit per weekday, 0 = Sunday, matching both JS getDay() and Postgres DOW.
  -- 127 = every day, 62 = Mon-Fri (the default: three posts every single day
  -- is 21 a week, which almost nobody actually wants).
  days_mask        INT  NOT NULL DEFAULT 62,
  -- The review window, in minutes. Treated as a MINIMUM, never a target — see
  -- lib/slots.ts for why a drifting cron must only ever give you more warning.
  lead_minutes     INT  NOT NULL DEFAULT 15,
  -- Per slot, not per agent: the morning slot can be trusted to publish itself
  -- while an evening one still waits for a human.
  auto_publish     BOOLEAN NOT NULL DEFAULT FALSE,
  -- Empty array = whatever the agent as a whole is watching.
  categories_json  JSONB NOT NULL DEFAULT '[]',
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  position         INT  NOT NULL DEFAULT 0,
  next_run_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS post_slots_due_idx ON post_slots (agent_id, enabled, next_run_at);

/*
 * One row per slot per local day — the INSTANCE of a recurring rule.
 *
 * Three jobs. It is the idempotency guard that stops a slot generating twice in
 * a day however often the cron fires. It is the timeline the UI renders,
 * including the days when nothing cleared the threshold, so silence is visible
 * as a judgment rather than looking like a broken cron. And because today's row
 * is separate from the recurring rule, a one-off change — skip tonight, move
 * this morning to 11:00 — is an update here and never a edit to the schedule.
 *
 * outcome: pending | drafted | silent | missed | failed | published
 */
CREATE TABLE IF NOT EXISTS slot_runs (
  slot_id       UUID NOT NULL REFERENCES post_slots(id) ON DELETE CASCADE,
  run_date      DATE NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  generated_at  TIMESTAMPTZ,
  post_seq      INT,
  outcome       TEXT NOT NULL DEFAULT 'pending',
  detail        TEXT,
  PRIMARY KEY (slot_id, run_date)
);

CREATE INDEX IF NOT EXISTS slot_runs_date_idx ON slot_runs (run_date DESC);

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

/*
 * One row per feed, recording whether it still works.
 *
 * Feeds die quietly. A blog moves host, an RSS path changes, a site adds
 * Cloudflare — and discovery logs one warning per cycle and carries on with the
 * other twenty-six, which is the correct behaviour and also why nobody ever
 * notices. Over a couple of years that is how a reading list of 27 sources
 * becomes a reading list of 12 without a single alert.
 *
 * Keyed by feed NAME rather than URL so a feed whose URL is corrected keeps its
 * history instead of appearing to be a brand new source that has always worked.
 */
CREATE TABLE IF NOT EXISTS feed_health (
  name            TEXT PRIMARY KEY,
  last_ok_at      TIMESTAMPTZ,
  last_failed_at  TIMESTAMPTZ,
  /* Reset to zero by any successful fetch. */
  fails_in_a_row  INT NOT NULL DEFAULT 0,
  last_error      TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

/*
 * Devices that may receive push notifications, and what has been sent.
 *
 * The token is the primary key rather than an id: FCM issues one per app
 * install and rotates it, so the same phone reappearing with a new token is a
 * new row and the old one is deleted when FCM reports it dead.
 */
CREATE TABLE IF NOT EXISTS device_tokens (
  token        TEXT PRIMARY KEY,
  agent_id     UUID NOT NULL REFERENCES agents(id),
  platform     TEXT NOT NULL DEFAULT 'android',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS device_tokens_agent ON device_tokens (agent_id);

/*
 * What has been sent, so a standing problem is not reported on every tick.
 * A stalled scheduler is re-detected every minute; without this the two alerts
 * that most need to be believed would be the two that get muted first.
 */
CREATE TABLE IF NOT EXISTS push_log (
  id       BIGSERIAL PRIMARY KEY,
  agent_id UUID NOT NULL REFERENCES agents(id),
  kind     TEXT NOT NULL,
  sent_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_log_agent_kind_at ON push_log (agent_id, kind, sent_at DESC);

/*
 * Failed login attempts, for rate limiting.
 *
 * In a table rather than in memory because the gate runs on serverless
 * instances that do not share memory: a per-process counter is reset by every
 * cold start and bypassed entirely by concurrent requests landing on different
 * instances, which is exactly the shape a guessing attack has.
 */
CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGSERIAL PRIMARY KEY,
  /* Truncated client address. Kept only long enough to rate limit. */
  client     TEXT NOT NULL,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_client_at ON login_attempts (client, at DESC);

/* Short-lived CSRF state for the OAuth round trip; swept on use and by age. */
CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  agent_id    UUID NOT NULL REFERENCES agents(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS byline_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL, subject TEXT NOT NULL, name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(provider, subject)
);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES byline_users(id);
CREATE UNIQUE INDEX IF NOT EXISTS agents_owner_unique ON agents(owner_id) WHERE owner_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS byline_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES byline_users(id),
  expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS native_auth (
  id TEXT PRIMARY KEY, provider TEXT NOT NULL, verifier_hash TEXT NOT NULL,
  redirect_uri TEXT NOT NULL, user_id UUID REFERENCES byline_users(id),
  error TEXT, claimed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS onboarding (
  user_id UUID PRIMARY KEY REFERENCES byline_users(id),
  config JSONB NOT NULL DEFAULT '{}', revision INT NOT NULL DEFAULT 0,
  preview JSONB, preview_revision INT, accepted_revision INT,
  completed_at TIMESTAMPTZ, next_delivery_at TIMESTAMPTZ,
  preview_attempts INT NOT NULL DEFAULT 0, attempts_day DATE NOT NULL DEFAULT CURRENT_DATE,
  generating_until TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS review_deliveries (
  agent_id UUID NOT NULL REFERENCES agents(id), delivery_date TEXT NOT NULL,
  seq INT, attempts INT NOT NULL DEFAULT 0, retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ, last_error TEXT, PRIMARY KEY(agent_id, delivery_date)
);
ALTER TABLE review_deliveries ADD COLUMN IF NOT EXISTS stage TEXT;
ALTER TABLE onboarding ADD COLUMN IF NOT EXISTS timetable_migrated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE slot_runs ADD COLUMN IF NOT EXISTS stage TEXT;
ALTER TABLE slot_runs ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 1;
ALTER TABLE slot_runs ADD COLUMN IF NOT EXISTS retry_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE posts ADD COLUMN IF NOT EXISTS slot_date DATE;
CREATE UNIQUE INDEX IF NOT EXISTS posts_slot_day ON posts(agent_id,slot_id,slot_date) WHERE slot_date IS NOT NULL;
CREATE TABLE IF NOT EXISTS notification_outbox (
  id BIGSERIAL PRIMARY KEY, agent_id UUID NOT NULL REFERENCES agents(id),
  payload JSONB NOT NULL, dedupe_key TEXT NOT NULL UNIQUE,
  attempts INT NOT NULL DEFAULT 0, retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS native BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS return_uri TEXT;
ALTER TABLE native_auth ADD COLUMN IF NOT EXISTS return_uri TEXT;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS review_date TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS posts_review_day ON posts(agent_id,review_date) WHERE review_date IS NOT NULL;
CREATE TABLE IF NOT EXISTS post_counters(agent_id UUID PRIMARY KEY REFERENCES agents(id), value INT NOT NULL);
CREATE OR REPLACE FUNCTION byline_next_seq(a UUID) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  INSERT INTO post_counters(agent_id,value) SELECT a, COALESCE(MAX(seq),0)+1 FROM posts WHERE agent_id=a
  ON CONFLICT(agent_id) DO UPDATE SET value=GREATEST(post_counters.value+1,EXCLUDED.value) RETURNING value INTO n;
  RETURN n;
END $$;
CREATE TABLE IF NOT EXISTS ai_user_days(owner TEXT NOT NULL,day DATE NOT NULL,requests INT NOT NULL,PRIMARY KEY(owner,day));
CREATE TABLE IF NOT EXISTS ai_provider_days(model TEXT NOT NULL,day DATE NOT NULL,attempts INT NOT NULL,next_at TIMESTAMPTZ NOT NULL,PRIMARY KEY(model,day));
CREATE TABLE IF NOT EXISTS ai_usage(id BIGSERIAL PRIMARY KEY,owner TEXT NOT NULL,model TEXT NOT NULL,success BOOLEAN NOT NULL,input_tokens INT,output_tokens INT,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
`;
