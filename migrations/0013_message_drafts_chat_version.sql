-- 右下角對話面板的團隊端清單會標「有草稿」、有草稿的單算未回覆：待審留言新增、修改、送出或捨棄時，
-- 只動團隊端的清單版本（chat_version_owner），團隊面板的清單輪詢才不會一直拿到舊的 304。
-- 客戶端看不到草稿，chat_version_client 不動。只加觸發器，既有資料不受影響。
CREATE TRIGGER message_drafts_chat_version_insert AFTER INSERT ON message_drafts
BEGIN
    UPDATE projects SET chat_version_owner = chat_version_owner + 1 WHERE id = (SELECT project_id FROM reports WHERE id = NEW.report_id);
END;

CREATE TRIGGER message_drafts_chat_version_update AFTER UPDATE ON message_drafts
BEGIN
    UPDATE projects SET chat_version_owner = chat_version_owner + 1 WHERE id = (SELECT project_id FROM reports WHERE id = NEW.report_id);
END;

CREATE TRIGGER message_drafts_chat_version_delete AFTER DELETE ON message_drafts
BEGIN
    UPDATE projects SET chat_version_owner = chat_version_owner + 1 WHERE id = (SELECT project_id FROM reports WHERE id = OLD.report_id);
END;
