-- Durable deletion queue: failed R2 deletes must remain retryable after metadata removal.
CREATE TABLE object_gc (r2_key TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX entries_r2_key_idx ON entries(r2_key);
CREATE INDEX recovery_r2_key_idx ON recovery(r2_key);
CREATE INDEX uploads_object_key_idx ON uploads(object_key);
