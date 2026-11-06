// 清單整列、看板整張卡片可點：點到列上任何不是連結、按鈕、輸入元件的地方，就開啟這一列的詳情視窗（data-row-link＝視窗 id）。
// 列上的連結（編號、標題）照舊由 feedback.js 的 data-dialog-open 處理；選取文字、按住修飾鍵不算點擊。
// 詳情視窗是第一次開啟時才載入的（feedback.js），所以這裡不直接找視窗，而是點一下列上的詳情連結，走同一條載入流程。

export const INTERACTIVE_SELECTOR = 'a, button, input, select, textarea, label, summary, form, dialog, [data-no-row-link]';

/** 點到的是不是列上自己會處理點擊的元件。 */
export const isInteractiveTarget = (target) => Boolean(target?.closest?.(INTERACTIVE_SELECTOR));

/** 這次點擊要不要當成「開詳情」。 */
export const shouldOpenRowDetail = (event, { selection = '' } = {}) => {
    if (event.defaultPrevented || (event.button ?? 0) !== 0) {
        return false;
    }
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return false;
    }
    if (selection !== '') {
        return false;
    }

    return !isInteractiveTarget(event.target);
};

export const bindRowLinks = (doc = document) => {
    doc.addEventListener('click', (event) => {
        const row = event.target.closest?.('[data-row-link]');
        if (!row || !shouldOpenRowDetail(event, { selection: String(window.getSelection?.() ?? '') })) {
            return;
        }
        row.querySelector('[data-report-detail-open]')?.click();
    });
};

if (typeof document !== 'undefined') {
    bindRowLinks();
}
