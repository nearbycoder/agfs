-- Additive projections: old Workers can continue writing their original tables.
CREATE TABLE resource_policies (
 owner_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
 index_mode TEXT NOT NULL DEFAULT 'content' CHECK(index_mode IN ('content','metadata')),
 max_text_bytes INTEGER NOT NULL DEFAULT 1048576 CHECK(max_text_bytes BETWEEN 0 AND 1048576),
 indexing_paused INTEGER NOT NULL DEFAULT 0, webhooks_paused INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE resource_work (
 kind TEXT NOT NULL, id TEXT NOT NULL, owner_id TEXT NOT NULL,
 due_at INTEGER NOT NULL, queued_at INTEGER NOT NULL, generation INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(kind,id)
) WITHOUT ROWID;
CREATE INDEX resource_work_due ON resource_work(due_at,kind,id);
CREATE INDEX resource_work_owner_due ON resource_work(owner_id,kind,due_at,id);
CREATE INDEX resource_work_owner_queued ON resource_work(owner_id,kind,queued_at,id);
-- A single bounded counter prevents generation reuse after source completion,
-- deletion/recreation or an old Worker requeues the same ID. No history scan or
-- growing generation ledger is needed. Each allocation costs two extra writes.
CREATE TABLE resource_generation(id INTEGER PRIMARY KEY CHECK(id=1),value INTEGER NOT NULL CHECK(value BETWEEN 0 AND 9007199254740991));
INSERT INTO resource_generation VALUES(1,0);
-- Absence is revision zero; every persisted policy receives a distinct exact
-- identity, including first creation, concurrent upserts and delete/recreate.
CREATE TRIGGER resource_policy_generation_insert AFTER INSERT ON resource_policies BEGIN
 UPDATE resource_generation SET value=value+1 WHERE id=1;
 UPDATE resource_policies SET revision=(SELECT value FROM resource_generation WHERE id=1) WHERE owner_id=NEW.owner_id;
END;
CREATE TRIGGER resource_policy_generation_update AFTER UPDATE OF index_mode,max_text_bytes,indexing_paused,webhooks_paused ON resource_policies BEGIN
 UPDATE resource_generation SET value=value+1 WHERE id=1;
 UPDATE resource_policies SET revision=(SELECT value FROM resource_generation WHERE id=1) WHERE owner_id=NEW.owner_id;
END;
-- Only occupied inside an atomic reindex apply batch; no dry-run plan storage.
CREATE TABLE resource_reindex_guard(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CONSTRAINT resource_reindex_review CHECK(valid=1));
CREATE TRIGGER resource_work_generation_insert AFTER INSERT ON resource_work BEGIN
 UPDATE resource_generation SET value=value+1 WHERE id=1;
 UPDATE resource_work SET generation=(SELECT value FROM resource_generation WHERE id=1) WHERE kind=NEW.kind AND id=NEW.id;
END;
CREATE TRIGGER resource_work_generation_update AFTER UPDATE OF generation ON resource_work WHEN NEW.generation=0 BEGIN
 UPDATE resource_generation SET value=value+1 WHERE id=1;
 UPDATE resource_work SET generation=(SELECT value FROM resource_generation WHERE id=1) WHERE kind=NEW.kind AND id=NEW.id;
END;
-- Independent intent survives an old Worker's unqualified object_gc DELETE.
-- Only the new generation-qualified collector retires this projection.
CREATE TABLE resource_object_gc(r2_key TEXT PRIMARY KEY,created_at INTEGER NOT NULL,generation INTEGER NOT NULL DEFAULT 0);
CREATE INDEX resource_object_gc_created ON resource_object_gc(created_at,r2_key);
CREATE TRIGGER resource_gc_generation_insert AFTER INSERT ON resource_object_gc BEGIN
 UPDATE resource_generation SET value=value+1 WHERE id=1;
 UPDATE resource_object_gc SET generation=(SELECT value FROM resource_generation WHERE id=1) WHERE r2_key=NEW.r2_key;
END;
CREATE TRIGGER resource_gc_generation_update AFTER UPDATE OF generation ON resource_object_gc WHEN NEW.generation=0 BEGIN
 UPDATE resource_generation SET value=value+1 WHERE id=1;
 UPDATE resource_object_gc SET generation=(SELECT value FROM resource_generation WHERE id=1) WHERE r2_key=NEW.r2_key;
END;
INSERT INTO resource_object_gc(r2_key,created_at) SELECT r2_key,created_at FROM object_gc;
CREATE TRIGGER resource_gc_insert AFTER INSERT ON object_gc BEGIN
 INSERT INTO resource_object_gc(r2_key,created_at) VALUES(NEW.r2_key,NEW.created_at)
 ON CONFLICT(r2_key) DO UPDATE SET created_at=excluded.created_at,generation=0;
END;
CREATE TRIGGER resource_gc_update AFTER UPDATE OF created_at ON object_gc BEGIN
 INSERT INTO resource_object_gc(r2_key,created_at) VALUES(NEW.r2_key,NEW.created_at)
 ON CONFLICT(r2_key) DO UPDATE SET created_at=excluded.created_at,generation=0;
END;
CREATE TABLE resource_index_counts(owner_id TEXT PRIMARY KEY,pending INTEGER NOT NULL DEFAULT 0,failed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE resource_webhook_counts(owner_id TEXT NOT NULL,status TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(owner_id,status));
CREATE TABLE resource_health_queue(owner_id TEXT PRIMARY KEY,due_at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 0);
-- Dirty owner revisions also survive queue deletion/recreation without ABA.
CREATE TRIGGER resource_health_generation_insert AFTER INSERT ON resource_health_queue BEGIN
 UPDATE resource_generation SET value=value+1 WHERE id=1;
 UPDATE resource_health_queue SET revision=(SELECT value FROM resource_generation WHERE id=1) WHERE owner_id=NEW.owner_id;
END;
CREATE TRIGGER resource_health_generation_update AFTER UPDATE OF revision ON resource_health_queue WHEN NEW.revision=0 BEGIN
 UPDATE resource_generation SET value=value+1 WHERE id=1;
 UPDATE resource_health_queue SET revision=(SELECT value FROM resource_generation WHERE id=1) WHERE owner_id=NEW.owner_id;
END;
CREATE INDEX resource_health_due ON resource_health_queue(due_at,owner_id);
CREATE TABLE resource_scheduler(name TEXT PRIMARY KEY,cursor TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL DEFAULT 0);
-- Additive cleanup continuation. Old workers ignore this state and keep their
-- original SQL valid; bounded turns begin only after the new worker is active.
CREATE TABLE resource_cleanup(
 task TEXT PRIMARY KEY CHECK(task IN ('uploads','recovery','pins','snapshots','aliases','secrets','idempotency','changes','metrics','transfers','outbox','alerts','deliveries','invites','usage','devices','activity','shares','committed')),
 cutoff NOT NULL,cursor_expiry NOT NULL,cursor_rowid TEXT NOT NULL,revision TEXT NOT NULL
);
CREATE TABLE resource_cleanup_guard(id INTEGER PRIMARY KEY CHECK(id=1),valid INTEGER NOT NULL CONSTRAINT resource_cleanup_current CHECK(valid=1));
CREATE INDEX cleanup_upload_expiry ON uploads(expires_at) WHERE status IN ('pending','completing','expired');
CREATE INDEX cleanup_upload_committed ON uploads(committed_at) WHERE status='committed';
CREATE INDEX cleanup_snapshot_expiry ON snapshots(expires_at);
CREATE INDEX cleanup_alias_expiry ON token_rotation_aliases(expires_at);
CREATE INDEX cleanup_secret_expiry ON webhooks(previous_secret_until);
CREATE INDEX cleanup_change_expiry ON change_log(created_at);
CREATE INDEX cleanup_transfer_expiry ON ownership_transfers(expires_at);
CREATE INDEX cleanup_alert_expiry ON health_alerts(resolved_at);
CREATE INDEX cleanup_invite_expiry ON workspace_invites(expires_at);
CREATE INDEX cleanup_usage_expiry ON agent_usage(day);
CREATE INDEX cleanup_device_expiry ON device_codes(expires_at);
CREATE INDEX cleanup_share_expiry ON share_links(expires_at);
CREATE TABLE resource_owner_progress(owner_id TEXT PRIMARY KEY,last_dispatch_at INTEGER,last_health_at INTEGER,dispatched INTEGER NOT NULL DEFAULT 0);
CREATE TABLE resource_alert_state(
 alert_id TEXT PRIMARY KEY REFERENCES health_alerts(id) ON DELETE CASCADE,
 acknowledged_at INTEGER,acknowledged_by TEXT,note TEXT NOT NULL DEFAULT '',snoozed_until INTEGER
);
CREATE TABLE resource_failures(id TEXT PRIMARY KEY,kind TEXT NOT NULL,owner_id TEXT NOT NULL,path TEXT,created_at INTEGER NOT NULL,last_error TEXT NOT NULL);
CREATE INDEX resource_failures_owner ON resource_failures(owner_id,created_at,id);
CREATE INDEX uploads_owner_created ON uploads(owner_id,created_at,id);
CREATE INDEX uploads_token_active ON uploads(token_id,status,size);
CREATE INDEX recovery_owner_key ON recovery(owner_id,r2_key,id);
CREATE INDEX entries_owner_key ON entries(owner_id,r2_key,id);
CREATE INDEX pins_owner_expiry ON object_pins(owner_id,expires_at);
CREATE INDEX pins_owner_key ON object_pins(owner_id,object_key,reference_id);
CREATE INDEX deliveries_hook_status ON webhook_deliveries(webhook_id,status,id);
CREATE INDEX health_alerts_owner_created ON health_alerts(owner_id,created_at,id);
CREATE INDEX tokens_owner_expiry ON api_tokens(owner_id,revoked_at,expires_at,id);
CREATE INDEX tokens_owner_active_id ON api_tokens(owner_id,revoked_at,id);
CREATE TABLE resource_token_storage(token_id TEXT PRIMARY KEY,bytes INTEGER NOT NULL);
INSERT INTO resource_token_storage SELECT token_id,sum(size) FROM object_usage WHERE token_id IS NOT NULL GROUP BY token_id;
CREATE TRIGGER resource_storage_insert AFTER INSERT ON object_usage WHEN NEW.token_id IS NOT NULL BEGIN
 INSERT INTO resource_token_storage VALUES(NEW.token_id,NEW.size) ON CONFLICT(token_id) DO UPDATE SET bytes=bytes+NEW.size;
END;
CREATE TRIGGER resource_storage_delete AFTER DELETE ON object_usage WHEN OLD.token_id IS NOT NULL BEGIN
 UPDATE resource_token_storage SET bytes=bytes-OLD.size WHERE token_id=OLD.token_id;
END;
CREATE TRIGGER resource_storage_update AFTER UPDATE OF token_id,size ON object_usage BEGIN
 UPDATE resource_token_storage SET bytes=bytes-OLD.size WHERE token_id=OLD.token_id;
 INSERT INTO resource_token_storage SELECT NEW.token_id,NEW.size WHERE NEW.token_id IS NOT NULL ON CONFLICT(token_id) DO UPDATE SET bytes=bytes+NEW.size;
END;
CREATE TABLE resource_upload_progress(upload_id TEXT PRIMARY KEY REFERENCES uploads(id) ON DELETE CASCADE,uploaded_bytes INTEGER NOT NULL,parts INTEGER NOT NULL);
INSERT INTO resource_upload_progress SELECT upload_id,sum(size),count(*) FROM upload_parts GROUP BY upload_id;
CREATE TRIGGER resource_part_insert AFTER INSERT ON upload_parts BEGIN
 INSERT INTO resource_upload_progress VALUES(NEW.upload_id,NEW.size,1) ON CONFLICT(upload_id) DO UPDATE SET uploaded_bytes=uploaded_bytes+NEW.size,parts=parts+1;
END;
CREATE TRIGGER resource_part_update AFTER UPDATE OF size ON upload_parts BEGIN
 UPDATE resource_upload_progress SET uploaded_bytes=uploaded_bytes+NEW.size-OLD.size WHERE upload_id=NEW.upload_id;
END;
CREATE TRIGGER resource_part_delete AFTER DELETE ON upload_parts BEGIN
 UPDATE resource_upload_progress SET uploaded_bytes=uploaded_bytes-OLD.size,parts=parts-1 WHERE upload_id=OLD.upload_id;
END;

INSERT INTO resource_work(kind,id,owner_id,due_at,queued_at)
 SELECT 'index',j.entry_id,e.owner_id,max(s.next_attempt,s.queued_at),s.queued_at FROM index_jobs j JOIN index_job_status s ON s.entry_id=j.entry_id JOIN entries e ON e.id=j.entry_id;
INSERT INTO resource_work(kind,id,owner_id,due_at,queued_at)
 SELECT 'webhook',d.id,w.owner_id,max(d.next_attempt,d.created_at),d.created_at FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE d.status IN ('pending','sending');
INSERT INTO resource_index_counts SELECT e.owner_id,count(*),sum(s.attempts>0) FROM index_job_status s JOIN entries e ON e.id=s.entry_id GROUP BY e.owner_id;
INSERT INTO resource_webhook_counts SELECT w.owner_id,d.status,count(*) FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id GROUP BY w.owner_id,d.status;
INSERT OR IGNORE INTO resource_health_queue(owner_id,due_at)
 SELECT owner_id,0 FROM operation_metrics WHERE minute>=unixepoch()/60-10
 UNION SELECT owner_id,0 FROM index_job_owners
 UNION SELECT owner_id,0 FROM health_alerts WHERE resolved_at IS NULL
 UNION SELECT w.owner_id,0 FROM webhooks w JOIN webhook_deliveries d ON d.webhook_id=w.id WHERE d.status='failed';
INSERT OR IGNORE INTO resource_failures
 SELECT s.entry_id,'index',e.owner_id,e.path,s.queued_at,coalesce(s.last_error,'Indexing failed')
 FROM index_job_status s JOIN entries e ON e.id=s.entry_id WHERE s.attempts>0;
INSERT OR IGNORE INTO resource_failures
 SELECT d.id,'webhook',w.owner_id,w.path_prefix,d.created_at,coalesce(d.last_error,'Delivery failed')
 FROM webhook_deliveries d JOIN webhooks w ON w.id=d.webhook_id WHERE d.status='failed';

CREATE TRIGGER resource_index_insert AFTER INSERT ON index_job_status BEGIN
 INSERT INTO resource_work(kind,id,owner_id,due_at,queued_at) SELECT 'index',NEW.entry_id,owner_id,max(NEW.next_attempt,NEW.queued_at),NEW.queued_at FROM entries WHERE id=NEW.entry_id;
 INSERT INTO resource_index_counts(owner_id,pending,failed) SELECT owner_id,1,NEW.attempts>0 FROM entries WHERE id=NEW.entry_id
 ON CONFLICT(owner_id) DO UPDATE SET pending=pending+1,failed=failed+excluded.failed;
 INSERT INTO resource_health_queue(owner_id,due_at) SELECT owner_id,unixepoch()*1000 FROM entries WHERE id=NEW.entry_id
 ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_index_update AFTER UPDATE ON index_job_status BEGIN
 UPDATE resource_work SET due_at=max(NEW.next_attempt,unixepoch()*1000),generation=CASE WHEN NEW.attempts=0 AND OLD.attempts>0 THEN 0 ELSE generation END WHERE kind='index' AND id=NEW.entry_id;
 UPDATE resource_index_counts SET failed=failed+(NEW.attempts>0)-(OLD.attempts>0) WHERE owner_id=(SELECT owner_id FROM resource_work WHERE kind='index' AND id=NEW.entry_id);
 INSERT INTO resource_health_queue(owner_id,due_at) SELECT owner_id,unixepoch()*1000 FROM resource_work WHERE kind='index' AND id=NEW.entry_id
 ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_index_delete AFTER DELETE ON index_job_status BEGIN
 UPDATE resource_index_counts SET pending=pending-1,failed=failed-(OLD.attempts>0) WHERE owner_id=(SELECT owner_id FROM resource_work WHERE kind='index' AND id=OLD.entry_id);
 INSERT INTO resource_health_queue(owner_id,due_at) SELECT owner_id,unixepoch()*1000 FROM resource_work WHERE kind='index' AND id=OLD.entry_id
 ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
 DELETE FROM resource_work WHERE kind='index' AND id=OLD.entry_id;
 DELETE FROM resource_failures WHERE kind='index' AND id=OLD.entry_id;
END;
CREATE TRIGGER resource_entry_change AFTER UPDATE ON entries BEGIN
 UPDATE resource_work SET generation=0 WHERE kind='index' AND id=NEW.id;
END;
CREATE TRIGGER resource_entry_owner BEFORE UPDATE OF owner_id ON entries WHEN OLD.owner_id IS NOT NEW.owner_id BEGIN
 UPDATE resource_index_counts SET pending=pending-1,failed=failed-coalesce((SELECT attempts>0 FROM index_job_status WHERE entry_id=OLD.id),0)
 WHERE owner_id=OLD.owner_id AND EXISTS(SELECT 1 FROM resource_work WHERE kind='index' AND id=OLD.id);
 INSERT INTO resource_index_counts(owner_id,pending,failed) SELECT NEW.owner_id,1,s.attempts>0 FROM index_job_status s WHERE s.entry_id=OLD.id
 ON CONFLICT(owner_id) DO UPDATE SET pending=pending+1,failed=failed+excluded.failed;
 INSERT INTO resource_health_queue(owner_id,due_at) VALUES(OLD.owner_id,unixepoch()*1000),(NEW.owner_id,unixepoch()*1000)
 ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
 UPDATE resource_work SET owner_id=NEW.owner_id WHERE kind='index' AND id=OLD.id;
END;
CREATE TRIGGER resource_delivery_insert AFTER INSERT ON webhook_deliveries BEGIN
 INSERT INTO resource_webhook_counts SELECT owner_id,NEW.status,1 FROM webhooks WHERE id=NEW.webhook_id ON CONFLICT(owner_id,status) DO UPDATE SET count=count+1;
 INSERT INTO resource_work(kind,id,owner_id,due_at,queued_at) SELECT 'webhook',NEW.id,owner_id,max(NEW.next_attempt,NEW.created_at),NEW.created_at FROM webhooks WHERE id=NEW.webhook_id AND NEW.status IN ('pending','sending');
 INSERT INTO resource_health_queue(owner_id,due_at) SELECT owner_id,unixepoch()*1000 FROM webhooks WHERE id=NEW.webhook_id AND NEW.status='failed'
 ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_delivery_update AFTER UPDATE OF status,next_attempt ON webhook_deliveries BEGIN
 UPDATE resource_webhook_counts SET count=count-1 WHERE owner_id=(SELECT owner_id FROM webhooks WHERE id=OLD.webhook_id) AND status=OLD.status;
 INSERT INTO resource_webhook_counts SELECT owner_id,NEW.status,1 FROM webhooks WHERE id=NEW.webhook_id ON CONFLICT(owner_id,status) DO UPDATE SET count=count+1;
 INSERT INTO resource_work(kind,id,owner_id,due_at,queued_at) SELECT 'webhook',NEW.id,owner_id,max(NEW.next_attempt,unixepoch()*1000),NEW.created_at FROM webhooks WHERE id=NEW.webhook_id AND NEW.status IN ('pending','sending')
 ON CONFLICT(kind,id) DO UPDATE SET due_at=excluded.due_at,generation=CASE WHEN NEW.attempts=0 AND OLD.attempts>0 THEN 0 ELSE generation END;
 DELETE FROM resource_work WHERE kind='webhook' AND id=NEW.id AND NEW.status NOT IN ('pending','sending');
 INSERT INTO resource_health_queue(owner_id,due_at) SELECT owner_id,unixepoch()*1000 FROM webhooks WHERE id=NEW.webhook_id AND (OLD.status='failed' OR NEW.status='failed')
 ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_delivery_delete BEFORE DELETE ON webhook_deliveries BEGIN
 UPDATE resource_webhook_counts SET count=count-1 WHERE owner_id=(SELECT owner_id FROM webhooks WHERE id=OLD.webhook_id) AND status=OLD.status;
 DELETE FROM resource_work WHERE kind='webhook' AND id=OLD.id;
 DELETE FROM resource_failures WHERE kind='webhook' AND id=OLD.id;
 INSERT INTO resource_health_queue(owner_id,due_at) SELECT owner_id,unixepoch()*1000 FROM webhooks WHERE id=OLD.webhook_id AND OLD.status='failed'
 ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_metric_insert AFTER INSERT ON operation_metrics WHEN NEW.minute>=unixepoch()/60-10 BEGIN
 INSERT INTO resource_health_queue(owner_id,due_at) VALUES(NEW.owner_id,unixepoch()*1000) ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_metric_update AFTER UPDATE ON operation_metrics WHEN NEW.minute>=unixepoch()/60-10 OR OLD.minute>=unixepoch()/60-10 BEGIN
 INSERT INTO resource_health_queue(owner_id,due_at) VALUES(NEW.owner_id,unixepoch()*1000) ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
 INSERT INTO resource_health_queue(owner_id,due_at) SELECT OLD.owner_id,unixepoch()*1000 WHERE OLD.owner_id IS NOT NEW.owner_id ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_metric_delete AFTER DELETE ON operation_metrics WHEN OLD.minute>=unixepoch()/60-10 BEGIN
 INSERT INTO resource_health_queue(owner_id,due_at) VALUES(OLD.owner_id,unixepoch()*1000) ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_alert_insert AFTER INSERT ON health_alerts BEGIN
 INSERT INTO resource_health_queue(owner_id,due_at) VALUES(NEW.owner_id,unixepoch()*1000) ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_alert_update AFTER UPDATE OF resolved_at ON health_alerts WHEN OLD.resolved_at IS NOT NEW.resolved_at BEGIN
 INSERT INTO resource_health_queue(owner_id,due_at) VALUES(NEW.owner_id,unixepoch()*1000) ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_hook_owner BEFORE UPDATE OF owner_id ON webhooks WHEN OLD.owner_id IS NOT NEW.owner_id BEGIN
 UPDATE resource_webhook_counts SET count=count-(SELECT count(*) FROM webhook_deliveries WHERE webhook_id=OLD.id AND status=resource_webhook_counts.status) WHERE owner_id=OLD.owner_id;
 INSERT INTO resource_webhook_counts SELECT NEW.owner_id,status,count(*) FROM webhook_deliveries WHERE webhook_id=OLD.id GROUP BY status
 ON CONFLICT(owner_id,status) DO UPDATE SET count=count+excluded.count;
 UPDATE resource_work SET owner_id=NEW.owner_id,generation=0 WHERE kind='webhook' AND id IN (SELECT id FROM webhook_deliveries WHERE webhook_id=OLD.id);
 INSERT INTO resource_health_queue(owner_id,due_at) VALUES(OLD.owner_id,unixepoch()*1000),(NEW.owner_id,unixepoch()*1000)
 ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_hook_delete BEFORE DELETE ON webhooks BEGIN
 UPDATE resource_webhook_counts SET count=count-(SELECT count(*) FROM webhook_deliveries WHERE webhook_id=OLD.id AND status=resource_webhook_counts.status) WHERE owner_id=OLD.owner_id;
 INSERT INTO resource_health_queue(owner_id,due_at) VALUES(OLD.owner_id,unixepoch()*1000) ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_threshold_insert AFTER INSERT ON health_thresholds BEGIN
 INSERT INTO resource_health_queue(owner_id,due_at) VALUES(NEW.owner_id,unixepoch()*1000) ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
CREATE TRIGGER resource_threshold_update AFTER UPDATE ON health_thresholds BEGIN
 INSERT INTO resource_health_queue(owner_id,due_at) VALUES(NEW.owner_id,unixepoch()*1000) ON CONFLICT(owner_id) DO UPDATE SET due_at=min(due_at,unixepoch()*1000),revision=0;
END;
-- The inbox is a projection of current source failures, not an archive of queue
-- dead letters. Old/late queue diagnostics cannot recreate deleted sources or
-- copy a previous owner's error into a newly created source with the same ID.
-- Backfill uses the source creation time; new transitions use database time.
CREATE TRIGGER resource_index_failure_insert AFTER INSERT ON index_job_status WHEN NEW.attempts>0 BEGIN
 INSERT INTO resource_failures SELECT NEW.entry_id,'index',owner_id,path,NEW.queued_at,coalesce(NEW.last_error,'Indexing failed') FROM entries WHERE id=NEW.entry_id
 ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,owner_id=excluded.owner_id,path=excluded.path,last_error=excluded.last_error;
END;
CREATE TRIGGER resource_index_failure_update AFTER UPDATE OF attempts,last_error ON index_job_status WHEN NEW.attempts>0 OR OLD.attempts>0 BEGIN
 DELETE FROM resource_failures WHERE kind='index' AND id=NEW.entry_id AND NEW.attempts=0;
 INSERT INTO resource_failures SELECT NEW.entry_id,'index',owner_id,path,unixepoch()*1000,coalesce(NEW.last_error,'Indexing failed') FROM entries WHERE id=NEW.entry_id AND NEW.attempts>0
 ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,owner_id=excluded.owner_id,path=excluded.path,last_error=excluded.last_error;
END;
CREATE TRIGGER resource_delivery_failure_insert AFTER INSERT ON webhook_deliveries WHEN NEW.status='failed' BEGIN
 INSERT INTO resource_failures SELECT NEW.id,'webhook',owner_id,path_prefix,NEW.created_at,coalesce(NEW.last_error,'Delivery failed') FROM webhooks WHERE id=NEW.webhook_id
 ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,owner_id=excluded.owner_id,path=excluded.path,last_error=excluded.last_error;
END;
CREATE TRIGGER resource_delivery_failure_update AFTER UPDATE OF status,last_error,webhook_id ON webhook_deliveries WHEN NEW.status='failed' OR OLD.status='failed' BEGIN
 DELETE FROM resource_failures WHERE kind='webhook' AND id=NEW.id AND NEW.status<>'failed';
 INSERT INTO resource_failures SELECT NEW.id,'webhook',owner_id,path_prefix,unixepoch()*1000,coalesce(NEW.last_error,'Delivery failed') FROM webhooks WHERE id=NEW.webhook_id AND NEW.status='failed'
 ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,owner_id=excluded.owner_id,path=excluded.path,last_error=excluded.last_error;
END;
CREATE TRIGGER resource_hook_failure_scope AFTER UPDATE OF owner_id,path_prefix ON webhooks WHEN OLD.owner_id IS NOT NEW.owner_id OR OLD.path_prefix IS NOT NEW.path_prefix BEGIN
 UPDATE resource_failures SET owner_id=NEW.owner_id,path=NEW.path_prefix WHERE kind='webhook' AND id IN (SELECT id FROM webhook_deliveries WHERE webhook_id=NEW.id);
END;
