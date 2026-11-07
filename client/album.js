// 附件（相簿）區：預設只顯示一排縮圖，超過一排才出現「顯示全部」；展開狀態依單的編號記住，內容定時換新時不會被收回去。
// 右下角面板的附件頁（data-album-force-all）永遠全部顯示，不用這顆按鈕。

const expandedKeys = new Set();

/** 縮圖的頂端位置有不只一種，就表示排成了不只一排。 */
export const spansMultipleRows = (offsets) => offsets.length > 1 && Math.max(...offsets) > Math.min(...offsets);

/** 依記住的展開狀態與目前版面，更新一個附件區的收合與按鈕。 */
export const syncAlbum = (section) => {
    const grid = section.querySelector('[data-album-grid]');
    const toggle = section.querySelector('[data-album-toggle]');
    if (!grid || !toggle) {
        return;
    }
    const expanded = expandedKeys.has(section.dataset.albumKey);
    grid.toggleAttribute('data-collapsed', !expanded);
    const offsets = Array.from(grid.querySelectorAll('[data-album-item]')).map((item) => item.offsetTop);
    toggle.hidden = !spansMultipleRows(offsets);
    toggle.textContent = expanded ? '收合' : '顯示全部';
    toggle.setAttribute('aria-expanded', String(expanded));
};

export const syncAllAlbums = (root = document) => root.querySelectorAll('[data-chat-album]').forEach(syncAlbum);

export const bindAlbums = (doc = document) => {
    doc.addEventListener('click', (event) => {
        const toggle = event.target.closest?.('[data-album-toggle]');
        const section = toggle?.closest('[data-chat-album]');
        if (!section) {
            return;
        }
        const key = section.dataset.albumKey;
        if (expandedKeys.has(key)) {
            expandedKeys.delete(key);
        } else {
            expandedKeys.add(key);
        }
        syncAlbum(section);
    });

    let scheduled = false;
    const schedule = () => {
        if (scheduled) {
            return;
        }
        scheduled = true;
        window.requestAnimationFrame(() => {
            scheduled = false;
            syncAllAlbums(doc);
        });
    };
    // 換新內容、視窗開啟、改變視窗寬度後重新判斷要不要出現「顯示全部」。
    new MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    window.addEventListener('resize', schedule);
    schedule();

    // 單頁的附件區：活動時間軸有新內容（新留言、新附件、編輯、收回）時重新取一次；內容沒變就維持原樣。
    doc.querySelectorAll('[data-album-region][data-refresh-url]').forEach((region) => {
        const normalize = (html) => html.replace(/(<time\b[^>]*>)[^<]*(<\/time>)/g, '$1$2');
        let last = normalize(region.innerHTML);
        doc.addEventListener('feedback:activity-changed', async () => {
            try {
                const response = await fetch(region.dataset.refreshUrl, { headers: { 'X-Requested-With': 'XMLHttpRequest' }, cache: 'no-store' });
                if (response.ok) {
                    const html = await response.text();
                    if (normalize(html) !== last) {
                        region.innerHTML = html;
                        last = normalize(html);
                    }
                }
            } catch {
                // 暫時失敗不影響頁面。
            }
        });
    });
};

if (typeof document !== 'undefined' && document.body) {
    bindAlbums();
}
