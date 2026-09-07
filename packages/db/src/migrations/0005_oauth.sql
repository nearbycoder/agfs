-- Better Auth OAuth 2.1 and JWT plugin storage.
CREATE TABLE oauth_client (
 id TEXT PRIMARY KEY NOT NULL,
 client_id TEXT NOT NULL UNIQUE,
 client_secret TEXT,
 client_discovery_id TEXT,
 disabled INTEGER,
 skip_consent INTEGER,
 enable_end_session INTEGER,
 subject_type TEXT,
 scopes TEXT,
 client_credentials_scopes TEXT,
 user_id TEXT REFERENCES user(id) ON DELETE NO ACTION,
 created_at INTEGER,
 updated_at INTEGER,
 name TEXT,
 uri TEXT,
 icon TEXT,
 contacts TEXT,
 tos TEXT,
 policy TEXT,
 software_id TEXT,
 software_version TEXT,
 software_statement TEXT,
 redirect_uris TEXT NOT NULL,
 post_logout_redirect_uris TEXT,
 backchannel_logout_uri TEXT,
 backchannel_logout_session_required INTEGER,
 token_endpoint_auth_method TEXT,
 application_type TEXT,
 jwks TEXT,
 jwks_uri TEXT,
 grant_types TEXT,
 response_types TEXT,
 require_p_k_c_e INTEGER,
 dpop_bound_access_tokens INTEGER,
 reference_id TEXT,
 metadata TEXT
);
CREATE INDEX oauth_client_user_id_idx ON oauth_client(user_id);
CREATE TABLE oauth_resource (
 id TEXT PRIMARY KEY NOT NULL,
 identifier TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 access_token_ttl INTEGER,
 refresh_token_ttl INTEGER,
 signing_algorithm TEXT,
 signing_key_id TEXT,
 allowed_scopes TEXT,
 custom_claims TEXT,
 dpop_bound_access_tokens_required INTEGER,
 disabled INTEGER,
 created_at INTEGER,
 updated_at INTEGER,
 policy_version INTEGER,
 metadata TEXT
);
CREATE TABLE oauth_client_resource (
 id TEXT PRIMARY KEY NOT NULL,
 client_id TEXT NOT NULL REFERENCES oauth_client(client_id) ON DELETE CASCADE,
 resource_id TEXT NOT NULL REFERENCES oauth_resource(identifier) ON DELETE CASCADE,
 metadata TEXT,
 created_at INTEGER
);
CREATE INDEX oauth_client_resource_client_id_idx ON oauth_client_resource(client_id);
CREATE INDEX oauth_client_resource_resource_id_idx ON oauth_client_resource(resource_id);
CREATE UNIQUE INDEX oauth_client_resource_client_id_resource_id_idx ON oauth_client_resource(client_id,resource_id);
CREATE TABLE oauth_refresh_token (
 id TEXT PRIMARY KEY NOT NULL,
 token TEXT NOT NULL UNIQUE,
 client_id TEXT NOT NULL REFERENCES oauth_client(client_id) ON DELETE NO ACTION,
 session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE NO ACTION,
 reference_id TEXT,
 authorization_code_id TEXT,
 resources TEXT,
 requested_user_info_claims TEXT,
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 revoked INTEGER,
 rotated_at INTEGER,
 rotation_replay_response TEXT,
 rotation_replay_expires_at INTEGER,
 auth_time INTEGER,
 confirmation TEXT,
 scopes TEXT NOT NULL
);
CREATE INDEX oauth_refresh_token_client_id_idx ON oauth_refresh_token(client_id);
CREATE INDEX oauth_refresh_token_session_id_idx ON oauth_refresh_token(session_id);
CREATE INDEX oauth_refresh_token_user_id_idx ON oauth_refresh_token(user_id);
CREATE INDEX oauth_refresh_token_authorization_code_id_idx ON oauth_refresh_token(authorization_code_id);
CREATE TABLE oauth_access_token (
 id TEXT PRIMARY KEY NOT NULL,
 token TEXT NOT NULL UNIQUE,
 client_id TEXT NOT NULL REFERENCES oauth_client(client_id) ON DELETE NO ACTION,
 session_id TEXT REFERENCES session(id) ON DELETE SET NULL,
 user_id TEXT REFERENCES user(id) ON DELETE NO ACTION,
 reference_id TEXT,
 authorization_code_id TEXT,
 resources TEXT,
 requested_user_info_claims TEXT,
 refresh_id TEXT REFERENCES oauth_refresh_token(id) ON DELETE NO ACTION,
 expires_at INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 revoked INTEGER,
 confirmation TEXT,
 scopes TEXT NOT NULL
);
CREATE INDEX oauth_access_token_client_id_idx ON oauth_access_token(client_id);
CREATE INDEX oauth_access_token_session_id_idx ON oauth_access_token(session_id);
CREATE INDEX oauth_access_token_user_id_idx ON oauth_access_token(user_id);
CREATE INDEX oauth_access_token_authorization_code_id_idx ON oauth_access_token(authorization_code_id);
CREATE INDEX oauth_access_token_refresh_id_idx ON oauth_access_token(refresh_id);
CREATE TABLE oauth_consent (
 id TEXT PRIMARY KEY NOT NULL,
 client_id TEXT NOT NULL REFERENCES oauth_client(client_id) ON DELETE NO ACTION,
 user_id TEXT REFERENCES user(id) ON DELETE NO ACTION,
 reference_id TEXT,
 resources TEXT,
 requested_user_info_claims TEXT,
 scopes TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX oauth_consent_client_id_idx ON oauth_consent(client_id);
CREATE INDEX oauth_consent_user_id_idx ON oauth_consent(user_id);
CREATE TABLE oauth_client_assertion (
 id TEXT PRIMARY KEY NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE jwks (
 id TEXT PRIMARY KEY NOT NULL,
 public_key TEXT NOT NULL,
 private_key TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER,
 alg TEXT,
 crv TEXT
);
