CREATE TABLE favorites (
 owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(owner_id,actor_id,entry_id)
);
