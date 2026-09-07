CREATE TABLE recent_files (
 owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
 opened_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,actor_id,entry_id)
);
CREATE INDEX recent_files_actor_time_idx ON recent_files(owner_id,actor_id,opened_at DESC);
