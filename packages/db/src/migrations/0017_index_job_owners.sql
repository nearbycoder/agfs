-- Keep the small pending queue searchable by owner without walking live files.
-- A separate projection preserves the existing index_jobs insert contract.
CREATE TABLE index_job_owners (
 entry_id TEXT PRIMARY KEY NOT NULL REFERENCES index_jobs(entry_id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX index_job_owners_owner_entry_idx ON index_job_owners(owner_id,entry_id);

INSERT INTO index_job_owners(entry_id,owner_id)
 SELECT j.entry_id,e.owner_id FROM index_jobs j JOIN entries e ON e.id=j.entry_id;

CREATE TRIGGER index_job_owner_insert AFTER INSERT ON index_jobs BEGIN
 INSERT INTO index_job_owners(entry_id,owner_id)
 SELECT NEW.entry_id,e.owner_id FROM entries e WHERE e.id=NEW.entry_id;
END;

CREATE TRIGGER index_job_owner_transfer AFTER UPDATE OF owner_id ON entries
 WHEN OLD.owner_id IS NOT NEW.owner_id BEGIN
 UPDATE index_job_owners SET owner_id=NEW.owner_id WHERE entry_id=NEW.id;
END;
