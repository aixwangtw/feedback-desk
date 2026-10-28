-- 開單分類改成每個專案各自設定（JSON 陣列，NULL＝不分類）。
-- 舊版的整站設定 FEEDBACK_REPORT_CATEGORIES 已不再讀取；D1 migration 讀不到 vars，無法自動搬。
-- 升級前有設這個值的站，升級後請到「我的帳號」→「專案設定」或用
-- feedback-desk project categories <slug|all> "分類1,分類2" 補回，否則開單不會顯示分類。
ALTER TABLE projects ADD COLUMN report_categories TEXT;
