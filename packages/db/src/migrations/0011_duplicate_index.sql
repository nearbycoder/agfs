CREATE INDEX entries_duplicate_lookup ON entries(owner_id,etag,size,path) WHERE kind='file';
