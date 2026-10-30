-- Scheduled patrol (a cloud routine that checks reports on its own): its own tokens and a log of
-- what it wrote. A patrol token acts as one team account but can only list projects, read reports,
-- leave messages, write the adjustment note and set a report to needs_input; it cannot complete or
-- delete. Only the SHA-256 hash is stored; revoked tokens stay listed. New tables only.
CREATE TABLE patrol_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    developer_id INTEGER NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    last_used_at TEXT,
    revoked_at TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX patrol_tokens_developer_idx ON patrol_tokens (developer_id);

-- Write actions through a patrol token: which token, what, which report, whether it worked. Only a
-- summary (lengths, previous status, error code) is kept, never the message or note text.
CREATE TABLE patrol_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patrol_token_id INTEGER NOT NULL REFERENCES patrol_tokens(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    project_slug TEXT,
    report_public_id TEXT,
    succeeded INTEGER NOT NULL,
    detail TEXT,
    ip TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX patrol_logs_token_idx ON patrol_logs (patrol_token_id, id);
