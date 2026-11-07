-- Initial D1 schema. Dates are UTC ISO strings; JSON is validated TEXT.

-- Extracted from the verified local PostgreSQL schema; no user data is included.

-- Subsequent changes must be separate numbered migrations.

CREATE TABLE "agents" (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-a' || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  "name" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "persona_json" TEXT NOT NULL CHECK ("persona_json" IS NULL OR json_valid("persona_json")),
  "persona_hash" TEXT NOT NULL,
  "is_demo" INTEGER NOT NULL DEFAULT 0 CHECK ("is_demo" IN (0,1)),
  "active" INTEGER NOT NULL DEFAULT 1 CHECK ("active" IN (0,1)),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "categories_json" TEXT NOT NULL DEFAULT '[]' CHECK ("categories_json" IS NULL OR json_valid("categories_json")),
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "post_time_local" TEXT NOT NULL DEFAULT '09:30',
  "auto_publish" INTEGER NOT NULL DEFAULT 0 CHECK ("auto_publish" IN (0,1)),
  "paused" INTEGER NOT NULL DEFAULT 0 CHECK ("paused" IN (0,1)),
  "auto_publish_cap" INTEGER NOT NULL DEFAULT 1,
  "style_json" TEXT NOT NULL DEFAULT '{}' CHECK ("style_json" IS NULL OR json_valid("style_json")),
  "corpus_json" TEXT NOT NULL DEFAULT '[]' CHECK ("corpus_json" IS NULL OR json_valid("corpus_json")),
  "edit_notes" TEXT,
  "edit_notes_from" INTEGER NOT NULL DEFAULT 0,
  "owner_id" TEXT,
  FOREIGN KEY (owner_id) REFERENCES byline_users(id),
  PRIMARY KEY (id),
  UNIQUE (persona_hash)
);

CREATE UNIQUE INDEX agents_owner_unique ON agents (owner_id) WHERE (owner_id IS NOT NULL);

CREATE TABLE "ai_provider_days" (
  "model" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL,
  "next_at" TEXT NOT NULL,
  PRIMARY KEY (model, day)
);

CREATE TABLE "ai_usage" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "owner" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "success" INTEGER NOT NULL CHECK ("success" IN (0,1)),
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE "ai_user_days" (
  "owner" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "requests" INTEGER NOT NULL,
  PRIMARY KEY (owner, day)
);

CREATE TABLE "byline_sessions" (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-a' || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  "user_id" TEXT NOT NULL,
  "expires_at" TEXT NOT NULL,
  "revoked_at" TEXT,
  FOREIGN KEY (user_id) REFERENCES byline_users(id),
  PRIMARY KEY (id)
);

CREATE TABLE "byline_users" (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-a' || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  "provider" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (id),
  UNIQUE (provider, subject)
);

CREATE TABLE "device_tokens" (
  "token" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'android',
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "last_seen_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  PRIMARY KEY (token)
);

CREATE INDEX device_tokens_agent ON device_tokens (agent_id);

CREATE TABLE "distributions" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "agent_id" TEXT NOT NULL,
  "seq" INTEGER,
  "idempotency_key" TEXT NOT NULL,
  "target" TEXT NOT NULL DEFAULT 'linkedin_member',
  "status" TEXT NOT NULL DEFAULT 'in_flight',
  "external_urn" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "settled_at" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  UNIQUE (idempotency_key)
);

CREATE INDEX distributions_agent_idx ON distributions (agent_id, created_at DESC);

CREATE TABLE "feed_health" (
  "name" TEXT NOT NULL,
  "last_ok_at" TEXT,
  "last_failed_at" TEXT,
  "fails_in_a_row" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (name)
);

CREATE TABLE "linkedin_accounts" (
  "agent_id" TEXT NOT NULL,
  "member_urn" TEXT NOT NULL,
  "member_name" TEXT,
  "member_picture" TEXT,
  "access_token_enc" TEXT NOT NULL,
  "refresh_token_enc" TEXT,
  "scopes" TEXT,
  "expires_at" TEXT NOT NULL,
  "connected_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "last_ok_at" TEXT,
  "last_error" TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  PRIMARY KEY (agent_id)
);

CREATE TABLE "llm_calls" (
  "day" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "call_count" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model)
);

CREATE TABLE "login_attempts" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "client" TEXT NOT NULL,
  "at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX login_attempts_client_at ON login_attempts (client, at DESC);

CREATE TABLE "media_assets" (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-a' || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  "agent_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'image',
  "linkedin_urn" TEXT NOT NULL,
  "upload_url" TEXT NOT NULL,
  "alt_text" TEXT,
  "filename" TEXT,
  "status" TEXT NOT NULL DEFAULT 'initialized',
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  PRIMARY KEY (id)
);

CREATE TABLE "native_auth" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "verifier_hash" TEXT NOT NULL,
  "redirect_uri" TEXT NOT NULL,
  "user_id" TEXT,
  "error" TEXT,
  "claimed_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "return_uri" TEXT,
  FOREIGN KEY (user_id) REFERENCES byline_users(id),
  PRIMARY KEY (id)
);

CREATE TABLE "notification_outbox" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "agent_id" TEXT NOT NULL,
  "payload" TEXT NOT NULL CHECK ("payload" IS NULL OR json_valid("payload")),
  "dedupe_key" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "retry_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "delivered_at" TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  UNIQUE (dedupe_key)
);

CREATE TABLE "oauth_states" (
  "state" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "native" INTEGER NOT NULL DEFAULT 0 CHECK ("native" IN (0,1)),
  "return_uri" TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  PRIMARY KEY (state)
);

CREATE TABLE "onboarding" (
  "user_id" TEXT NOT NULL,
  "config" TEXT NOT NULL DEFAULT '{}' CHECK ("config" IS NULL OR json_valid("config")),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "preview" TEXT CHECK ("preview" IS NULL OR json_valid("preview")),
  "preview_revision" INTEGER,
  "accepted_revision" INTEGER,
  "completed_at" TEXT,
  "next_delivery_at" TEXT,
  "preview_attempts" INTEGER NOT NULL DEFAULT 0,
  "attempts_day" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now')),
  "generating_until" TEXT,
  "timetable_migrated" INTEGER NOT NULL DEFAULT 0 CHECK ("timetable_migrated" IN (0,1)),
  FOREIGN KEY (user_id) REFERENCES byline_users(id),
  PRIMARY KEY (user_id)
);

CREATE TABLE "post_counters" (
  "agent_id" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  PRIMARY KEY (agent_id)
);

CREATE TABLE "post_slots" (
  "id" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-a' || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  "agent_id" TEXT NOT NULL,
  "local_time" TEXT NOT NULL,
  "days_mask" INTEGER NOT NULL DEFAULT 62,
  "lead_minutes" INTEGER NOT NULL DEFAULT 15,
  "auto_publish" INTEGER NOT NULL DEFAULT 0 CHECK ("auto_publish" IN (0,1)),
  "categories_json" TEXT NOT NULL DEFAULT '[]' CHECK ("categories_json" IS NULL OR json_valid("categories_json")),
  "enabled" INTEGER NOT NULL DEFAULT 1 CHECK ("enabled" IN (0,1)),
  "position" INTEGER NOT NULL DEFAULT 0,
  "next_run_at" TEXT,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  PRIMARY KEY (id)
);

CREATE INDEX post_slots_due_idx ON post_slots (agent_id, enabled, next_run_at);

CREATE TABLE "posts" (
  "agent_id" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "id" TEXT GENERATED ALWAYS AS ('p' || seq) STORED,
  "text" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "sources_json" TEXT NOT NULL DEFAULT '[]' CHECK ("sources_json" IS NULL OR json_valid("sources_json")),
  "fingerprint" TEXT NOT NULL,
  "scores_json" TEXT CHECK ("scores_json" IS NULL OR json_valid("scores_json")),
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "continuity" TEXT,
  "cycle_id" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'published',
  "kind" TEXT NOT NULL DEFAULT 'auto',
  "category" TEXT,
  "client_request_id" TEXT,
  "media_json" TEXT NOT NULL DEFAULT '[]' CHECK ("media_json" IS NULL OR json_valid("media_json")),
  "scheduled_for" TEXT,
  "published_at" TEXT,
  "slot_id" TEXT,
  "cleared_at" TEXT,
  "hold_until" TEXT,
  "hashtags_json" TEXT NOT NULL DEFAULT '[]' CHECK ("hashtags_json" IS NULL OR json_valid("hashtags_json")),
  "used_quote" INTEGER NOT NULL DEFAULT 0 CHECK ("used_quote" IN (0,1)),
  "linkedin_text" TEXT,
  "original_text" TEXT,
  "slot_date" TEXT,
  "review_date" TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  PRIMARY KEY (agent_id, seq)
);

CREATE UNIQUE INDEX posts_client_request_idx ON posts (agent_id, client_request_id) WHERE (client_request_id IS NOT NULL);

CREATE INDEX posts_due_idx ON posts (agent_id, status, scheduled_for);

CREATE INDEX posts_status_idx ON posts (agent_id, status, created_at DESC);

CREATE UNIQUE INDEX posts_slot_day ON posts (agent_id, slot_id, slot_date) WHERE (slot_date IS NOT NULL);

CREATE UNIQUE INDEX posts_review_day ON posts (agent_id, review_date) WHERE (review_date IS NOT NULL);

CREATE TABLE "push_log" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "agent_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "sent_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX push_log_agent_kind_at ON push_log (agent_id, kind, sent_at DESC);

CREATE TABLE "rejections" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "agent_id" TEXT NOT NULL,
  "cycle_id" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "scores_json" TEXT NOT NULL CHECK ("scores_json" IS NULL OR json_valid("scores_json")),
  "reason" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE TABLE "review_deliveries" (
  "agent_id" TEXT NOT NULL,
  "delivery_date" TEXT NOT NULL,
  "seq" INTEGER,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "retry_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  "lease_until" TEXT,
  "last_error" TEXT,
  "stage" TEXT,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  PRIMARY KEY (agent_id, delivery_date)
);

CREATE TABLE "scheduler_state" (
  "agent_id" TEXT NOT NULL,
  "last_run_at" TEXT,
  "next_run_at" TEXT,
  "cycle_count" INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  PRIMARY KEY (agent_id)
);

CREATE TABLE "slot_runs" (
  "slot_id" TEXT NOT NULL,
  "run_date" TEXT NOT NULL,
  "scheduled_for" TEXT NOT NULL,
  "generated_at" TEXT,
  "post_seq" INTEGER,
  "outcome" TEXT NOT NULL DEFAULT 'pending',
  "detail" TEXT,
  "stage" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "retry_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (slot_id) REFERENCES post_slots(id) ON DELETE CASCADE,
  PRIMARY KEY (slot_id, run_date)
);

CREATE INDEX slot_runs_date_idx ON slot_runs (run_date DESC);

CREATE TABLE "system_status" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL CHECK ("value" IS NULL OR json_valid("value")),
  "updated_at" TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (key)
);
