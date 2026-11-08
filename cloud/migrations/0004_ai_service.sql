-- Server-owned limits; clients cannot grant themselves a plan or extra capacity.
ALTER TABLE ai_usage ADD COLUMN neurons REAL;
CREATE TABLE ai_account_limits (
  owner TEXT PRIMARY KEY REFERENCES byline_users(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL DEFAULT 'pilot',
  daily_attempt_limit INTEGER NOT NULL CHECK(daily_attempt_limit BETWEEN 1 AND 100000),
  max_parallel INTEGER NOT NULL DEFAULT 1 CHECK(max_parallel BETWEEN 1 AND 32),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  expires_at TEXT
);
CREATE TABLE ai_service_days (
  owner TEXT NOT NULL REFERENCES byline_users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner,day)
);
CREATE TABLE ai_service_health (
  route TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  blocked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE ai_requests (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL REFERENCES byline_users(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  route TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('running','succeeded','retry','failed')),
  lease TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  retry_at INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 1,
  day TEXT NOT NULL,
  result_enc TEXT,
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ai_requests_capacity ON ai_requests(route,state,lease_until);
CREATE INDEX ai_requests_owner_capacity ON ai_requests(owner,state,lease_until);
CREATE INDEX ai_requests_operation ON ai_requests(owner,operation_id);
CREATE INDEX ai_requests_retention ON ai_requests(updated_at);
CREATE TRIGGER ai_request_first_attempt AFTER INSERT ON ai_requests BEGIN
  INSERT INTO ai_service_days(owner,day,attempts) VALUES(NEW.owner,NEW.day,1)
    ON CONFLICT(owner,day) DO UPDATE SET attempts=attempts+1;
END;
CREATE TRIGGER ai_request_retry_attempt AFTER UPDATE OF lease ON ai_requests WHEN NEW.lease!=OLD.lease BEGIN
  INSERT INTO ai_service_days(owner,day,attempts) VALUES(NEW.owner,NEW.day,1)
    ON CONFLICT(owner,day) DO UPDATE SET attempts=attempts+1;
END;
