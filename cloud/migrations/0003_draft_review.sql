-- Preserve generated work that needs human review before automatic publishing.
ALTER TABLE posts ADD COLUMN review_notes_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(review_notes_json));
ALTER TABLE posts ADD COLUMN requires_review INTEGER NOT NULL DEFAULT 0 CHECK(requires_review IN (0,1));
-- Retry only devices that did not accept a notification in the previous attempt.
ALTER TABLE notification_outbox ADD COLUMN delivered_tokens_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(delivered_tokens_json));
