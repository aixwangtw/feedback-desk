// 清單與看板的附件縮圖（最多 3 張＋「+N」）：有人上傳新附件時，這一格跟著伺服器更新。
// 伺服器畫面只有一份（views/rows.ts 的 attachmentThumbsHtml），這裡只負責定時取回、有變才換掉，不自己組 HTML。
// 點縮圖或「+N」會打開該單詳情並捲到相簿（捲動由 report-dialog-thread.js 在相簿載入後執行）。

const POLL_MS = 8000;

/** 頁面上所有縮圖格的單編號（去重）。 */
export const thumbReportIds = (root) => [...new Set(Array.from(root.querySelectorAll('[data-attachment-thumbs]'), (node) => node.dataset.attachmentThumbs))];

/** 空白差異不算變動，沒變就不換節點。 */
export const sameMarkup = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/** 依伺服器回應更新一格縮圖；回傳是否有換掉。 */
export const applyThumbs = (node, entry) => {
    const html = node.hasAttribute('data-card-action') ? entry.card_html : entry.row_html;
    if (typeof html !== 'string' || sameMarkup(node.outerHTML, html)) {
        return false;
    }
    const template = document.createElement('template');
    template.innerHTML = html;
    node.replaceWith(template.content);

    return true;
};

const refresh = async (url) => {
    const ids = thumbReportIds(document);
    if (ids.length === 0) {
        return;
    }
    try {
        const response = await fetch(`${url}?${ids.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&')}`, {
            headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin',
            cache: 'no-store',
        });
        if (!response.ok) {
            return;
        }
        const data = await response.json();
        document.querySelectorAll('[data-attachment-thumbs]').forEach((node) => {
            const entry = data.reports?.[node.dataset.attachmentThumbs];
            if (entry) {
                applyThumbs(node, entry);
            }
        });
    } catch {
        // 暫時失敗不影響清單。
    }
};

if (typeof document !== 'undefined') {
    const source = document.querySelector('[data-attachment-thumbs-url]');
    if (source) {
        const url = source.dataset.attachmentThumbsUrl;
        window.setInterval(() => {
            if (!document.hidden) {
                refresh(url);
            }
        }, POLL_MS);
        ['feedback:activity-changed', 'feedback:album-changed'].forEach((name) => document.addEventListener(name, () => refresh(url)));
    }

    document.addEventListener('click', (event) => {
        const opener = event.target.closest?.('[data-open-album]');
        if (opener) {
            const id = opener.dataset.dialogOpen?.replace(/^detail-report-/, '');
            if (id) {
                document.documentElement.dataset.scrollAlbumFor = id;
            }
        }
    });
}
