-- One login per client person instead of one shared login per project, and passwords that people
-- choose themselves. Safe on an existing deployment: it only adds tables and columns, copies the
-- project's single client login into the new table, and keeps the old columns.

-- 1 when the account holder chose the password (web "change password", or bootstrap with a typed
-- password). Other members cannot reset it through the web, API, MCP or CLI; only the deployer can,
-- by writing D1 directly with `account recover`, which sets it back to 0.
ALTER TABLE developers ADD COLUMN password_set_by_self INTEGER NOT NULL DEFAULT 0;

CREATE TABLE client_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Login name. New names are unique across the deployment (team accounts included, compared
    -- without case); older per-project logins copied below may repeat across projects.
    username TEXT NOT NULL,
    -- Display name, changeable by the holder.
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_set_by_self INTEGER NOT NULL DEFAULT 0,
    disabled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX client_accounts_project_username_idx ON client_accounts (project_id, username);
CREATE INDEX client_accounts_username_idx ON client_accounts (username);

-- The project's existing client login becomes its first client account (same name and password).
INSERT INTO client_accounts (project_id, username, name, password_hash, created_at, updated_at)
SELECT id, client_username, COALESCE(NULLIF(TRIM(client_display_name), ''), client_username), client_password_hash,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM projects
WHERE client_username IS NOT NULL AND client_username <> '' AND client_password_hash IS NOT NULL AND client_password_hash <> '';

-- Which account wrote what. NULL means the client entry link (no account) or older data.
ALTER TABLE reports ADD COLUMN creator_client_account_id INTEGER REFERENCES client_accounts(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN author_client_account_id INTEGER REFERENCES client_accounts(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN author_developer_id INTEGER REFERENCES developers(id) ON DELETE SET NULL;
ALTER TABLE attachments ADD COLUMN uploader_client_account_id INTEGER REFERENCES client_accounts(id) ON DELETE SET NULL;
ALTER TABLE attachments ADD COLUMN uploader_developer_id INTEGER REFERENCES developers(id) ON DELETE SET NULL;

-- Existing client-side data belongs to the copied account.
UPDATE reports
SET creator_client_account_id = (SELECT ca.id FROM client_accounts ca WHERE ca.project_id = reports.project_id)
WHERE creator_type = 'client';

UPDATE messages
SET author_client_account_id = (
    SELECT ca.id FROM client_accounts ca JOIN reports r ON r.project_id = ca.project_id
    WHERE r.id = messages.report_id AND r.creator_type <> 'public'
)
WHERE author_type = 'reporter';

UPDATE attachments
SET uploader_client_account_id = (
    SELECT ca.id FROM client_accounts ca JOIN reports r ON r.project_id = ca.project_id
    WHERE r.id = attachments.report_id AND r.creator_type = 'client'
)
WHERE kind = 'feedback' AND message_id IS NULL;

UPDATE attachments
SET uploader_client_account_id = (SELECT m.author_client_account_id FROM messages m WHERE m.id = attachments.message_id)
WHERE message_id IS NOT NULL;

-- When each client account last opened each report. Replaces the shared client read time for
-- signed-in client accounts; client entry links (no account) keep using reports.client_last_read_at.
CREATE TABLE client_reads (
    client_account_id INTEGER NOT NULL REFERENCES client_accounts(id) ON DELETE CASCADE,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    last_read_at TEXT NOT NULL,
    PRIMARY KEY (client_account_id, report_id)
) WITHOUT ROWID;

CREATE INDEX client_reads_report_idx ON client_reads (report_id);

-- The copied account starts with what the shared client side had read.
INSERT INTO client_reads (client_account_id, report_id, last_read_at)
SELECT ca.id, r.id, r.client_last_read_at
FROM reports r JOIN client_accounts ca ON ca.project_id = r.project_id
WHERE r.client_last_read_at IS NOT NULL;

-- The password now lives in client_accounts. Clearing the old copy makes an older Worker version
-- fail closed (no password login) instead of accepting a password the client has since changed.
UPDATE projects SET client_password_hash = NULL WHERE client_password_hash IS NOT NULL;
