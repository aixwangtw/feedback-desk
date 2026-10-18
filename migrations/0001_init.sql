-- Feedback Desk schema for Cloudflare D1 (SQLite).
-- Timestamps are ISO-8601 UTC strings with millisecond precision ("2026-10-19T03:04:05.123Z"),
-- so they sort correctly as text.

CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    client_display_name TEXT,
    owner_token_hash TEXT NOT NULL,
    client_token_hash TEXT,
    client_username TEXT,
    client_password_hash TEXT,
    login_prefill_username TEXT,
    login_prefill_password TEXT,
    public_reporting_enabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE developers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    public_id TEXT NOT NULL UNIQUE,
    reporter_token_hash TEXT NOT NULL,
    reporter_name TEXT,
    creator_type TEXT NOT NULL DEFAULT 'client',
    creator_developer_id INTEGER REFERENCES developers(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    adjustment_note TEXT,
    page_url TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    completed_at TEXT,
    client_deleted_at TEXT,
    latest_activity_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX reports_project_created_idx ON reports (project_id, created_at, id);
CREATE INDEX reports_project_status_activity_idx ON reports (project_id, status, latest_activity_at);
CREATE INDEX reports_creator_type_idx ON reports (creator_type);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    author_type TEXT NOT NULL,
    author_name TEXT,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX messages_report_created_idx ON messages (report_id, created_at);

CREATE TABLE attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'feedback',
    object_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX attachments_report_idx ON attachments (report_id, kind);

-- Files uploaded one per request before the form that uses them is submitted.
-- Rows that are never claimed are removed by the cleanup job together with their R2 object.
CREATE TABLE uploads (
    id TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    report_id INTEGER REFERENCES reports(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL,
    object_key TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX uploads_created_idx ON uploads (created_at);

CREATE TABLE api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    developer_id INTEGER NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    last_used_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE device_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_code_hash TEXT NOT NULL UNIQUE,
    user_code TEXT NOT NULL UNIQUE,
    client_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    developer_id INTEGER REFERENCES developers(id) ON DELETE CASCADE,
    last_polled_at INTEGER,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
);

-- Fixed-window counters. `key` already contains the window number.
CREATE TABLE rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
);

CREATE INDEX rate_limits_reset_idx ON rate_limits (reset_at);
