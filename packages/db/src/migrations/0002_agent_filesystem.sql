ALTER TABLE api_tokens ADD COLUMN path_prefix TEXT NOT NULL DEFAULT '/';
ALTER TABLE api_tokens ADD COLUMN permissions TEXT NOT NULL DEFAULT '["read","write","delete","share","manage"]';
ALTER TABLE uploads ADD COLUMN multipart_id TEXT;
ALTER TABLE uploads ADD COLUMN fingerprint TEXT;
CREATE INDEX uploads_expiry_idx ON uploads(status, expires_at);
CREATE TABLE recovery (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 group_id TEXT NOT NULL, reason TEXT NOT NULL CHECK(reason IN ('trash','version')),
 path TEXT NOT NULL, kind TEXT NOT NULL, size INTEGER, content_type TEXT, etag TEXT, r2_key TEXT,
 created_at INTEGER NOT NULL, retained_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX recovery_owner_idx ON recovery(owner_id, retained_at);
CREATE INDEX recovery_expiry_idx ON recovery(expires_at);
CREATE TABLE activity (
 id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 action TEXT NOT NULL, path TEXT, actor TEXT NOT NULL, token_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX activity_owner_idx ON activity(owner_id, created_at, id);
CREATE TABLE upload_parts (
 upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
 part_number INTEGER NOT NULL, digest TEXT NOT NULL, etag TEXT NOT NULL, size INTEGER NOT NULL,
 PRIMARY KEY(upload_id,part_number)
);
-- Capture the actual old row atomically, including simultaneous overwrites.
CREATE TRIGGER retain_file_version BEFORE UPDATE OF r2_key ON entries
WHEN OLD.r2_key IS NOT NULL AND OLD.r2_key IS NOT NEW.r2_key
BEGIN
 INSERT INTO recovery(id,owner_id,group_id,reason,path,kind,size,content_type,etag,r2_key,created_at,retained_at,expires_at)
 VALUES(lower(hex(randomblob(16))),OLD.owner_id,OLD.id,'version',OLD.path,OLD.kind,OLD.size,OLD.content_type,OLD.etag,OLD.r2_key,OLD.created_at,unixepoch()*1000,(unixepoch()+2592000)*1000);
END;
