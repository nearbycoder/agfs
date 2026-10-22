-- Quota checks otherwise scan every namespace's pinned-object usage records.
CREATE INDEX object_usage_owner_key_size_idx ON object_usage(owner_id,object_key,size);
