-- Several people and AI tools working on the same reports: client accounts get their own API
-- tokens, every action records the account and the AI tool (Claude Code, Codex), and reports can
-- be claimed and carry handoff notes for whoever continues the work.

-- API tokens may belong to a team account or a client account (exactly one). The table is rebuilt
-- because SQLite cannot drop NOT NULL from developer_id; ids, hashes and dates are kept, so
-- existing tokens keep working. Nothing references api_tokens.
CREATE TABLE api_tokens_next (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    developer_id INTEGER REFERENCES developers(id) ON DELETE CASCADE,
    client_account_id INTEGER REFERENCES client_accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- AI tool the token was made for by `mcp install` ('Claude Code' or 'Codex'); NULL for CLI logins.
    agent TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    last_used_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    CHECK ((developer_id IS NULL) <> (client_account_id IS NULL))
);

INSERT INTO api_tokens_next (id, developer_id, client_account_id, name, agent, token_hash, last_used_at, expires_at, created_at)
SELECT id, developer_id, NULL, name,
    CASE name WHEN 'Claude Code MCP' THEN 'Claude Code' WHEN 'Codex MCP' THEN 'Codex' ELSE NULL END,
    token_hash, last_used_at, expires_at, created_at
FROM api_tokens;

DROP TABLE api_tokens;
ALTER TABLE api_tokens_next RENAME TO api_tokens;
CREATE INDEX api_tokens_developer_idx ON api_tokens (developer_id);
CREATE INDEX api_tokens_client_account_idx ON api_tokens (client_account_id);

-- `feedback-desk login` approved by a client account.
ALTER TABLE device_codes ADD COLUMN client_account_id INTEGER REFERENCES client_accounts(id) ON DELETE CASCADE;

-- AI tool that wrote the report or message (NULL: a person on the web, or the CLI by hand).
ALTER TABLE reports ADD COLUMN creator_agent TEXT;
ALTER TABLE messages ADD COLUMN author_agent TEXT;

-- Who is working on the report now (team side). Others can still read it; through the API, CLI and
-- MCP, changing the status or the adjustment note while someone else holds it asks for an explicit
-- takeover, which is logged (the web page shows who holds it and offers a takeover button).
ALTER TABLE reports ADD COLUMN claimed_by_developer_id INTEGER REFERENCES developers(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN claimed_agent TEXT;
ALTER TABLE reports ADD COLUMN claimed_at TEXT;

-- Progress notes left when work stops halfway: what is done and what comes next. Team side only.
CREATE TABLE handoff_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    developer_id INTEGER REFERENCES developers(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    agent TEXT,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX handoff_notes_report_idx ON handoff_notes (report_id, id);

-- What happened to a report and who did it: created, message, adjustment, status, claim, release,
-- takeover, handoff. Shown to the team as "名字（Codex）".
CREATE TABLE report_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    developer_id INTEGER REFERENCES developers(id) ON DELETE SET NULL,
    client_account_id INTEGER REFERENCES client_accounts(id) ON DELETE SET NULL,
    actor_name TEXT NOT NULL,
    agent TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX report_events_report_idx ON report_events (report_id, id);
