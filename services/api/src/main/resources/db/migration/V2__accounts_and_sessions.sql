ALTER TABLE app_users ADD COLUMN site_owner BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE external_identities (
    provider VARCHAR(16) NOT NULL CHECK (provider IN ('email', 'google')),
    subject VARCHAR(320) NOT NULL,
    user_id UUID NOT NULL REFERENCES app_users(id),
    email VARCHAR(254) NOT NULL,
    PRIMARY KEY (provider, subject),
    UNIQUE (user_id, provider)
);

CREATE TABLE magic_link_tokens (
    token_hash CHAR(64) PRIMARY KEY,
    email VARCHAR(254) NOT NULL,
    link_user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ
);
CREATE INDEX magic_link_created_idx ON magic_link_tokens(created_at);
CREATE INDEX magic_link_email_created_idx ON magic_link_tokens(email, created_at);

CREATE TABLE spring_session (
    primary_id CHAR(36) NOT NULL PRIMARY KEY,
    session_id CHAR(36) NOT NULL,
    creation_time BIGINT NOT NULL,
    last_access_time BIGINT NOT NULL,
    max_inactive_interval INT NOT NULL,
    expiry_time BIGINT NOT NULL,
    principal_name VARCHAR(100)
);
CREATE UNIQUE INDEX spring_session_ix1 ON spring_session(session_id);
CREATE INDEX spring_session_ix2 ON spring_session(expiry_time);
CREATE INDEX spring_session_ix3 ON spring_session(principal_name);

CREATE TABLE spring_session_attributes (
    session_primary_id CHAR(36) NOT NULL REFERENCES spring_session(primary_id) ON DELETE CASCADE,
    attribute_name VARCHAR(200) NOT NULL,
    attribute_bytes BYTEA NOT NULL,
    PRIMARY KEY (session_primary_id, attribute_name)
);
