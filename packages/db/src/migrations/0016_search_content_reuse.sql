-- Only bodies successfully read within the indexing size cap may be reused.
-- Existing documents get one fresh read; missing-object/metadata-only placeholders
-- must never turn an empty index entry into a permanently cached representation.
ALTER TABLE search_documents ADD COLUMN content_verified INTEGER NOT NULL DEFAULT 0;
