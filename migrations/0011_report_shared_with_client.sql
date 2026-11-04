-- 團隊開的單可以分享給客戶：1 時客戶的清單、看板、編號與附圖都看得到這張單。既有資料維持 0。
ALTER TABLE reports ADD COLUMN shared_with_client INTEGER NOT NULL DEFAULT 0;
