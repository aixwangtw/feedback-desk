-- 待審留言（草稿）：團隊或排程先寫好，團隊在單頁審過按「送出」才變成正式留言。
-- 放在獨立的表，客戶端讀留言的查詢完全碰不到；附圖先記在 attachments（JSON：object_key、original_name、
-- mime_type、size），R2 物件已存在，送出時才建立 attachments 紀錄。replaces_message_id 有值時，
-- 送出改寫那則團隊留言（不新增一則、原時間不變）。新增的表，既有資料不受影響。
CREATE TABLE message_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
    replaces_message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    author_developer_id INTEGER REFERENCES developers(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    author_agent TEXT,
    body TEXT NOT NULL,
    attachments TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX message_drafts_report_idx ON message_drafts (report_id, id);
