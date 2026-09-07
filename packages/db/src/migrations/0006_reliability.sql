CREATE TABLE change_log (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL, path TEXT NOT NULL,
 operation TEXT NOT NULL, entry TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX changes_owner_seq ON change_log(owner_id,seq);
CREATE TRIGGER change_insert AFTER INSERT ON entries BEGIN
 INSERT INTO change_log(owner_id,path,operation,entry,created_at) VALUES(NEW.owner_id,NEW.path,'upsert',json_object('id',NEW.id,'path',NEW.path,'name',NEW.name,'kind',NEW.kind,'size',NEW.size,'etag',NEW.etag,'contentType',NEW.content_type,'updatedAt',NEW.updated_at),unixepoch()*1000);
END;
CREATE TRIGGER change_update AFTER UPDATE ON entries BEGIN
 INSERT INTO change_log(owner_id,path,operation,created_at) SELECT OLD.owner_id,OLD.path,'delete',unixepoch()*1000 WHERE OLD.path!=NEW.path;
 INSERT INTO change_log(owner_id,path,operation,entry,created_at) VALUES(NEW.owner_id,NEW.path,'upsert',json_object('id',NEW.id,'path',NEW.path,'name',NEW.name,'kind',NEW.kind,'size',NEW.size,'etag',NEW.etag,'contentType',NEW.content_type,'updatedAt',NEW.updated_at),unixepoch()*1000);
END;
CREATE TRIGGER change_delete AFTER DELETE ON entries BEGIN
 INSERT INTO change_log(owner_id,path,operation,created_at) VALUES(OLD.owner_id,OLD.path,'delete',unixepoch()*1000);
END;
CREATE TABLE change_watermarks(owner_id TEXT PRIMARY KEY, floor INTEGER NOT NULL DEFAULT 0);
CREATE TABLE snapshots(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,name TEXT NOT NULL,path_prefix TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,actor_id TEXT NOT NULL);
CREATE INDEX snapshots_owner ON snapshots(owner_id,created_at,id);
CREATE TABLE snapshot_entries(snapshot_id TEXT NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,path TEXT NOT NULL,entry TEXT NOT NULL,PRIMARY KEY(snapshot_id,path));
CREATE TABLE object_pins(owner_id TEXT NOT NULL,reference_id TEXT NOT NULL,object_key TEXT NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(reference_id,object_key));
CREATE INDEX pins_object ON object_pins(object_key,expires_at);
CREATE TABLE idempotency(owner_id TEXT NOT NULL,key_hash TEXT NOT NULL,fingerprint TEXT NOT NULL,status INTEGER,response TEXT,created_at INTEGER NOT NULL,PRIMARY KEY(owner_id,key_hash));
CREATE INDEX idempotency_expiry ON idempotency(created_at);
ALTER TABLE api_tokens ADD COLUMN rotate_after INTEGER;
ALTER TABLE webhooks ADD COLUMN previous_secret TEXT;
ALTER TABLE webhooks ADD COLUMN previous_secret_until INTEGER;
ALTER TABLE webhooks ADD COLUMN last_used_at INTEGER;
CREATE TABLE index_job_status(entry_id TEXT PRIMARY KEY REFERENCES index_jobs(entry_id) ON DELETE CASCADE,queued_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,next_attempt INTEGER NOT NULL DEFAULT 0);
INSERT INTO index_job_status(entry_id,queued_at) SELECT entry_id,unixepoch()*1000 FROM index_jobs;
CREATE TRIGGER index_job_status_insert AFTER INSERT ON index_jobs BEGIN
 INSERT INTO index_job_status(entry_id,queued_at) VALUES(NEW.entry_id,unixepoch()*1000);
END;
DROP TRIGGER entry_index_insert;
DROP TRIGGER entry_index_update;
CREATE TRIGGER entry_index_insert AFTER INSERT ON entries BEGIN
 INSERT INTO index_jobs(entry_id) SELECT NEW.id WHERE NOT EXISTS(SELECT 1 FROM index_jobs WHERE entry_id=NEW.id);
END;
CREATE TRIGGER entry_index_update AFTER UPDATE ON entries BEGIN
 INSERT INTO index_jobs(entry_id) SELECT NEW.id WHERE NOT EXISTS(SELECT 1 FROM index_jobs WHERE entry_id=NEW.id);
 UPDATE index_job_status SET attempts=0,last_error=NULL,next_attempt=0 WHERE entry_id=NEW.id;
END;

CREATE TABLE draft_comments(id TEXT PRIMARY KEY,draft_id TEXT NOT NULL REFERENCES draft_sets(id) ON DELETE CASCADE,actor_id TEXT NOT NULL,body TEXT NOT NULL,path TEXT,line INTEGER,created_at INTEGER NOT NULL);
ALTER TABLE workspaces ADD COLUMN independent_review INTEGER NOT NULL DEFAULT 0;
CREATE TABLE ownership_transfers(workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,from_id TEXT NOT NULL,to_id TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE operation_metrics(owner_id TEXT NOT NULL,minute INTEGER NOT NULL,route TEXT NOT NULL,requests INTEGER NOT NULL DEFAULT 0,errors INTEGER NOT NULL DEFAULT 0,rejections INTEGER NOT NULL DEFAULT 0,duration_ms INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(owner_id,minute,route));
CREATE TABLE health_thresholds(owner_id TEXT PRIMARY KEY,error_percent INTEGER NOT NULL DEFAULT 10,backlog INTEGER NOT NULL DEFAULT 100,latency_ms INTEGER NOT NULL DEFAULT 2000);
CREATE TABLE health_alerts(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,kind TEXT NOT NULL,message TEXT NOT NULL,created_at INTEGER NOT NULL,resolved_at INTEGER);
CREATE UNIQUE INDEX active_health_alert ON health_alerts(owner_id,kind) WHERE resolved_at IS NULL;
CREATE TABLE queue_outbox(id TEXT PRIMARY KEY,kind TEXT NOT NULL,created_at INTEGER NOT NULL,dispatched_at INTEGER);
CREATE TABLE queue_failures(id TEXT PRIMARY KEY,kind TEXT NOT NULL,created_at INTEGER NOT NULL,last_error TEXT NOT NULL);
-- A share only authorizes the file version that was reviewed.
CREATE TRIGGER revoke_changed_shares AFTER UPDATE OF r2_key ON entries WHEN OLD.r2_key IS NOT NEW.r2_key BEGIN
 DELETE FROM share_links WHERE entry_id=NEW.id;
END;
CREATE TABLE token_rotation_aliases(token_hash TEXT PRIMARY KEY,token_id TEXT NOT NULL REFERENCES api_tokens(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);

ALTER TABLE agent_runs ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 30;
CREATE TABLE run_artifacts(run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,path TEXT NOT NULL,kind TEXT NOT NULL,object_key TEXT NOT NULL,PRIMARY KEY(run_id,path,kind));
