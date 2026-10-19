-- When the team and the client last opened each report, and when the adjustment note or its
-- images last actually changed. They drive "新留言 N" on the team side and "有新回覆" for clients.
ALTER TABLE reports ADD COLUMN owner_last_read_at TEXT;
ALTER TABLE reports ADD COLUMN client_last_read_at TEXT;
ALTER TABLE reports ADD COLUMN adjustment_updated_at TEXT;

-- Existing reports start as read on both sides, so nothing lights up right after the upgrade.
UPDATE reports
SET owner_last_read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    client_last_read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- Except: the newest message (by id) was written by the client, nothing happened on the report
-- after it, and it is newer than the last team action (team message or adjustment image).
-- The team read time goes back to that action (NULL when there is none), so that message and
-- any client messages after the action count as unread.
UPDATE reports
SET owner_last_read_at = NULLIF(MAX(
        COALESCE((SELECT MAX(created_at) FROM messages WHERE report_id = reports.id AND author_type IN ('owner', 'agent')), ''),
        COALESCE((SELECT MAX(created_at) FROM attachments WHERE report_id = reports.id AND kind = 'adjustment'), '')
    ), '')
WHERE EXISTS (
    SELECT 1 FROM messages last
    WHERE last.id = (SELECT MAX(id) FROM messages WHERE report_id = reports.id)
      AND last.author_type = 'reporter'
      AND last.created_at >= reports.latest_activity_at
      AND last.created_at > MAX(
          COALESCE((SELECT MAX(created_at) FROM messages WHERE report_id = reports.id AND author_type IN ('owner', 'agent')), ''),
          COALESCE((SELECT MAX(created_at) FROM attachments WHERE report_id = reports.id AND kind = 'adjustment'), '')
      )
);
