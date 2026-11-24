-- 重複的單合併進另一張後，記下合併到哪一張（合併的單同時設 client_deleted_at，沿用客戶已刪除的隱藏規則）。
-- 新增可為 NULL 的欄位，既有資料不受影響；還原合併的單時清回 NULL。
ALTER TABLE reports ADD COLUMN merged_into_report_id INTEGER REFERENCES reports(id) ON DELETE SET NULL;
