-- Counters on the project that move whenever anything shown in the chat panel list may have
-- changed for that side: a report is created, edited, deleted, or gets a message. Reading a report
-- only moves the counter of the side that read it. The panel polls its list, and comparing this one
-- value (already loaded with the project) answers 304 without reading every report of the project,
-- which keeps D1 reads low on the free plan.
ALTER TABLE projects ADD COLUMN chat_version_owner INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN chat_version_client INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER reports_chat_version_insert AFTER INSERT ON reports
BEGIN
    UPDATE projects SET chat_version_owner = chat_version_owner + 1, chat_version_client = chat_version_client + 1 WHERE id = NEW.project_id;
END;

CREATE TRIGGER reports_chat_version_update AFTER UPDATE ON reports
WHEN NEW.updated_at IS NOT OLD.updated_at
    OR NEW.latest_activity_at IS NOT OLD.latest_activity_at
    OR NEW.title IS NOT OLD.title
    OR NEW.status IS NOT OLD.status
    OR NEW.client_deleted_at IS NOT OLD.client_deleted_at
    OR NEW.adjustment_updated_at IS NOT OLD.adjustment_updated_at
    OR NEW.creator_type IS NOT OLD.creator_type
    OR NEW.project_id IS NOT OLD.project_id
BEGIN
    UPDATE projects SET chat_version_owner = chat_version_owner + 1, chat_version_client = chat_version_client + 1 WHERE id IN (NEW.project_id, OLD.project_id);
END;

CREATE TRIGGER reports_chat_version_owner_read AFTER UPDATE OF owner_last_read_at ON reports
WHEN NEW.owner_last_read_at IS NOT OLD.owner_last_read_at
BEGIN
    UPDATE projects SET chat_version_owner = chat_version_owner + 1 WHERE id = NEW.project_id;
END;

CREATE TRIGGER reports_chat_version_client_read AFTER UPDATE OF client_last_read_at ON reports
WHEN NEW.client_last_read_at IS NOT OLD.client_last_read_at
BEGIN
    UPDATE projects SET chat_version_client = chat_version_client + 1 WHERE id = NEW.project_id;
END;

CREATE TRIGGER reports_chat_version_delete AFTER DELETE ON reports
BEGIN
    UPDATE projects SET chat_version_owner = chat_version_owner + 1, chat_version_client = chat_version_client + 1 WHERE id = OLD.project_id;
END;

CREATE TRIGGER messages_chat_version_insert AFTER INSERT ON messages
BEGIN
    UPDATE projects SET chat_version_owner = chat_version_owner + 1, chat_version_client = chat_version_client + 1 WHERE id = (SELECT project_id FROM reports WHERE id = NEW.report_id);
END;

CREATE TRIGGER messages_chat_version_delete AFTER DELETE ON messages
BEGIN
    UPDATE projects SET chat_version_owner = chat_version_owner + 1, chat_version_client = chat_version_client + 1 WHERE id = (SELECT project_id FROM reports WHERE id = OLD.report_id);
END;
