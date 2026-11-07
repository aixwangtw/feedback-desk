-- 留言「收回」用軟刪除：畫面、API、未讀數、通知都當它不存在，資料庫裡仍救得回來。
ALTER TABLE messages ADD COLUMN deleted_at TEXT;

-- 編輯、收回留言也要讓右下角對話面板的版本號前進（面板用它判斷要不要重新載入）。
CREATE TRIGGER messages_chat_version_update AFTER UPDATE ON messages
BEGIN
    UPDATE projects SET chat_version_owner = chat_version_owner + 1, chat_version_client = chat_version_client + 1 WHERE id = (SELECT project_id FROM reports WHERE id = NEW.report_id);
END;
