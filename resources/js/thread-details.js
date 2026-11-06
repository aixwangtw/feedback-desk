// 對話內容會定時整段換新（單頁、詳情視窗、右下角面板共用）：使用者展開的相簿、過去的處理說明（<details data-keep-open="鍵">）
// 換新後要維持展開，沒展開的維持收合。純 DOM 邏輯，與渲染無關。

/** 目前展開中的 details 鍵。 */
export const openKeys = (root) => new Set(
    Array.from(root.querySelectorAll('details[data-keep-open]'))
        .filter((details) => details.open)
        .map((details) => details.dataset.keepOpen),
);

/** 把換新後的 details 依先前展開的鍵重新展開。 */
export const restoreOpenKeys = (root, keys) => {
    root.querySelectorAll('details[data-keep-open]').forEach((details) => {
        if (keys.has(details.dataset.keepOpen)) {
            details.open = true;
        }
    });
};

/** 執行換新動作（replace 內容），前後保留展開狀態。 */
export const replaceKeepingOpen = (root, replace) => {
    const keys = openKeys(root);
    replace();
    restoreOpenKeys(root, keys);
};
