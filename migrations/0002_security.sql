-- Team accounts can be disabled; their logins and API tokens stop working.
ALTER TABLE developers ADD COLUMN disabled_at TEXT;

-- Optional expiry for API tokens (NULL = no expiry).
ALTER TABLE api_tokens ADD COLUMN expires_at TEXT;

-- Shown on the CLI authorization page so the person approving can spot a request they did not make.
ALTER TABLE device_codes ADD COLUMN requester_ip TEXT;

-- Requested lifetime of the token issued at the end of `feedback-desk login --expires`.
ALTER TABLE device_codes ADD COLUMN token_days INTEGER;

-- Signed upload URLs handed to agents work once.
CREATE TABLE used_upload_nonces (
    nonce TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);

CREATE INDEX uploads_purpose_created_idx ON uploads (purpose, created_at);
