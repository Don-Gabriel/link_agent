-- Durable dispatch outbox: creating a Workflow is retried without losing the request.
CREATE TABLE generation_jobs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','working','completed','failed')),
  stage TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX generation_jobs_dispatch ON generation_jobs(state,created_at);
CREATE INDEX generation_jobs_agent ON generation_jobs(agent_id,state);

-- A single insert reserves both budgets under the same D1 transaction.
CREATE TABLE ai_reservations (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  model TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_reservations_day ON ai_reservations(day);
CREATE TRIGGER ai_reservation_counters AFTER INSERT ON ai_reservations BEGIN
  INSERT INTO ai_user_days(owner,day,requests) VALUES(NEW.owner,NEW.day,1)
    ON CONFLICT(owner,day) DO UPDATE SET requests=requests+1;
  INSERT INTO ai_provider_days(model,day,attempts,next_at) VALUES(NEW.model,NEW.day,1,strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at,'+4 seconds'))
    ON CONFLICT(model,day) DO UPDATE SET attempts=attempts+1,
      next_at=strftime('%Y-%m-%dT%H:%M:%fZ',MAX(NEW.created_at,next_at),'+4 seconds');
END;
CREATE INDEX native_auth_created ON native_auth(created_at);
CREATE INDEX oauth_states_created ON oauth_states(created_at);
CREATE INDEX byline_sessions_expiry ON byline_sessions(expires_at);
CREATE INDEX notification_outbox_pending ON notification_outbox(delivered_at,retry_at);
CREATE INDEX post_slots_next ON post_slots(enabled,next_run_at);
ALTER TABLE agents ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE post_slots ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE slot_runs ADD COLUMN job_id TEXT;
ALTER TABLE onboarding ADD COLUMN finish_token TEXT;
ALTER TABLE onboarding ADD COLUMN preview_lease TEXT;
ALTER TABLE distributions ADD COLUMN send_day TEXT;
CREATE INDEX distributions_daily ON distributions(agent_id,source,send_day);
ALTER TABLE distributions ADD COLUMN resolution_token TEXT;
ALTER TABLE agents ADD COLUMN edit_token TEXT;
