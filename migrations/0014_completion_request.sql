-- 「請客戶確認完成」：開發團隊（網頁、CLI、MCP、巡檢 API）不能直接結案，只能發一則確認留言，
-- 留言上給客戶按「通過」，客戶按了單才變已完成。這個欄位標記哪些留言是確認留言（1）。既有留言都是一般留言（0）。
ALTER TABLE messages ADD COLUMN is_completion_request INTEGER NOT NULL DEFAULT 0;
