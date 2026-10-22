-- Share listing, version revocation, and cascading view cleanup.
CREATE INDEX share_links_owner_idx ON share_links(owner_id);
CREATE INDEX share_links_entry_idx ON share_links(entry_id);
CREATE INDEX share_link_views_share_idx ON share_link_views(share_id);

-- Only active multipart candidates participate in resume lookup.
CREATE INDEX uploads_resume_idx ON uploads(owner_id,path,fingerprint)
 WHERE status IN ('pending','completing') AND multipart_id IS NOT NULL;

-- High-volume retention sweeps should seek expired rows, not scan live history.
CREATE INDEX object_pins_expiry_idx ON object_pins(expires_at);
CREATE INDEX change_log_expiry_idx ON change_log(created_at,owner_id,seq);
CREATE INDEX operation_metrics_minute_idx ON operation_metrics(minute);
CREATE INDEX queue_outbox_created_idx ON queue_outbox(created_at);
CREATE INDEX webhook_deliveries_created_idx ON webhook_deliveries(created_at);
CREATE INDEX activity_created_idx ON activity(created_at);

-- Every activity insertion fans out to this owner's enabled webhooks only.
CREATE INDEX webhooks_owner_enabled_idx ON webhooks(owner_id,enabled);
