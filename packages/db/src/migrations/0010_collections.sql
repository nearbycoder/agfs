CREATE TABLE collections (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 name TEXT NOT NULL COLLATE NOCASE, created_at INTEGER NOT NULL,
 UNIQUE(owner_id,actor_id,name)
);
CREATE TABLE collection_entries (
 collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
 entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
 PRIMARY KEY(collection_id,entry_id)
);
CREATE INDEX collection_entries_entry ON collection_entries(entry_id);
