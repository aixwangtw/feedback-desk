-- 開單分類：選項由 FEEDBACK_REPORT_CATEGORIES 設定，沒設定的站維持空值。
ALTER TABLE reports ADD COLUMN category TEXT;
