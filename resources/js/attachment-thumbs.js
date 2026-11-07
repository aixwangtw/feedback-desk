// 清單與看板的附件縮圖（最多 3 張＋「+N」）：有人上傳新附件時，這一格跟著伺服器更新。
// 伺服器畫面只有一份（feedback.reports._attachment-thumbs），這裡只負責定時取回、有變才換掉，不自己組 HTML。
// 點縮圖或「+N」直接開附件燈箱（attachment-lightbox.js 讀 data-lightbox-gallery），不開詳情。

const POLL_MS = 8000;

/** 頁面上所有縮圖格的單編號（去重）。 */
export const thumbReportIds = (root) => [...new Set(Array.from(root.querySelectorAll('[data-attachment-thumbs]'), (node) => node.dataset.attachmentThumbs))];

/** 去掉相對時間文字等會自己變動的部分後再比對，沒變就不換節點。 */
export const sameMarkup = (a, b) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/** 依伺服器回應更新一格縮圖；回傳是否有換掉。 */
export const applyThumbs = (node, entry) => {
    const isCard = node.hasAttribute('data-card-action');
    const html = isCard ? entry.card_html : entry.row_html;
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
    const query = ids.map((id) => `ids[]=${encodeURIComponent(id)}`).join('&');
    try {
        const response = await fetch(`${url}?${query}`, {
            headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin',
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
        // 在詳情視窗、面板留言或相簿有變動時立刻同步清單，不用等下一輪。
        ['feedback:messages-changed', 'feedback:album-changed'].forEach((name) => document.addEventListener(name, () => refresh(url)));
    }
}
