-- Workspace principals have no login account. Real actors remain membership/issuer records.
CREATE TABLE workspaces (
 id TEXT PRIMARY KEY NOT NULL REFERENCES user(id), name TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES user(id), created_at INTEGER NOT NULL,
 paused INTEGER NOT NULL DEFAULT 0, storage_limit INTEGER NOT NULL DEFAULT 1073741824
);
CREATE TABLE workspace_members (
 workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')), created_at INTEGER NOT NULL,
 PRIMARY KEY(workspace_id,user_id)
);
CREATE INDEX workspace_members_user_idx ON workspace_members(user_id);
CREATE TABLE workspace_invites (
 id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 email TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('editor','viewer')),
 token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES user(id), expires_at INTEGER NOT NULL
);
ALTER TABLE api_tokens ADD COLUMN issued_by TEXT REFERENCES user(id);
ALTER TABLE api_tokens ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_tokens ADD COLUMN storage_limit INTEGER;
ALTER TABLE api_tokens ADD COLUMN upload_limit INTEGER;
ALTER TABLE api_tokens ADD COLUMN operation_limit INTEGER;
ALTER TABLE uploads ADD COLUMN token_id TEXT;
ALTER TABLE uploads ADD COLUMN condition_mode TEXT NOT NULL DEFAULT 'any';
ALTER TABLE uploads ADD COLUMN expected_etag TEXT;
CREATE TABLE agent_usage (
 token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE, day TEXT NOT NULL,
 operations INTEGER NOT NULL DEFAULT 0, upload_bytes INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(token_id,day)
);
ALTER TABLE entries ADD COLUMN token_id TEXT;
CREATE TABLE search_documents (
 entry_id TEXT PRIMARY KEY NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
 object_key TEXT, content TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', indexed_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE file_search USING fts5(entry_id UNINDEXED, name, content, tags);
CREATE TABLE index_jobs (entry_id TEXT PRIMARY KEY NOT NULL REFERENCES entries(id) ON DELETE CASCADE);
CREATE TRIGGER entry_index_insert AFTER INSERT ON entries BEGIN
 INSERT INTO index_jobs SELECT NEW.id WHERE NOT EXISTS(SELECT 1 FROM index_jobs WHERE entry_id=NEW.id);
END;
CREATE TRIGGER entry_index_update AFTER UPDATE ON entries BEGIN
 INSERT INTO index_jobs SELECT NEW.id WHERE NOT EXISTS(SELECT 1 FROM index_jobs WHERE entry_id=NEW.id);
END;
CREATE TRIGGER entry_index_delete AFTER DELETE ON entries BEGIN
 DELETE FROM file_search WHERE entry_id=OLD.id;
END;
INSERT OR IGNORE INTO index_jobs SELECT id FROM entries;
CREATE TABLE agent_runs (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id), actor_id TEXT NOT NULL REFERENCES user(id),
 token_id TEXT, name TEXT NOT NULL, path_prefix TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
 metadata TEXT NOT NULL DEFAULT '{}', manifest TEXT, created_at INTEGER NOT NULL, completed_at INTEGER
);
CREATE INDEX runs_owner_idx ON agent_runs(owner_id,created_at);
CREATE TABLE draft_sets (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id), actor_id TEXT NOT NULL REFERENCES user(id),
 name TEXT NOT NULL, path_prefix TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL,
 reviewed_by TEXT REFERENCES user(id), reviewed_at INTEGER, applied_at INTEGER
);
CREATE TABLE draft_changes (
 draft_id TEXT NOT NULL REFERENCES draft_sets(id) ON DELETE CASCADE, path TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('write','delete')), base_etag TEXT,
 base_exists INTEGER NOT NULL, content TEXT, content_type TEXT NOT NULL DEFAULT 'text/plain',
 PRIMARY KEY(draft_id,path)
);
CREATE TABLE webhooks (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id), url TEXT NOT NULL,
 path_prefix TEXT NOT NULL, events TEXT NOT NULL, secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL
);
CREATE TABLE webhook_deliveries (
 id TEXT PRIMARY KEY NOT NULL, webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
 event_id TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending', next_attempt INTEGER NOT NULL, last_status INTEGER, last_error TEXT,
 created_at INTEGER NOT NULL, UNIQUE(webhook_id,event_id)
);
CREATE INDEX delivery_pending_idx ON webhook_deliveries(status,next_attempt);
CREATE TABLE object_usage (object_key TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, token_id TEXT, size INTEGER NOT NULL);
CREATE INDEX object_usage_token_idx ON object_usage(token_id);
INSERT INTO object_usage SELECT r2_key,owner_id,NULL,max(size) FROM (
 SELECT r2_key,owner_id,size FROM entries WHERE r2_key IS NOT NULL
 UNION ALL SELECT r2_key,owner_id,size FROM recovery WHERE r2_key IS NOT NULL
) GROUP BY r2_key;
ALTER TABLE agent_runs ADD COLUMN inputs TEXT NOT NULL DEFAULT '[]';
ALTER TABLE draft_changes ADD COLUMN base_content TEXT;
ALTER TABLE draft_sets ADD COLUMN apply_token TEXT;
CREATE TRIGGER activity_webhook AFTER INSERT ON activity BEGIN
 INSERT OR IGNORE INTO webhook_deliveries(id,webhook_id,event_id,payload,next_attempt,created_at)
 SELECT lower(hex(randomblob(16))),w.id,NEW.id,
   json_object('id',NEW.id,'type',NEW.action,'path',NEW.path,'actor',NEW.actor,'tokenId',NEW.token_id,'createdAt',NEW.created_at),
   NEW.created_at,NEW.created_at
 FROM webhooks w WHERE w.owner_id=NEW.owner_id AND w.enabled=1
   AND (w.path_prefix='/' OR NEW.path=w.path_prefix OR substr(NEW.path,1,length(w.path_prefix||'/'))=w.path_prefix||'/')
   AND EXISTS(SELECT 1 FROM json_each(w.events) WHERE value=NEW.action OR value='*');
END;
