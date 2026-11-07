// 附件燈箱：清單縮圖、看板縮圖、詳情／單頁相簿、留言附件共用同一個 <dialog data-image-lightbox>。
// 開啟時帶入一組附件（只含這一張單的附件）與起始位置：可左右切換、影片直接播放、下方顯示名稱與來源（哪則留言）與時間。
// 清單縮圖的附件清單來自 data-lightbox-gallery（伺服器用 FeedbackAlbum 產生，草稿附件不會出現在客戶端）；
// 相簿的連結用同一個相簿區塊內的全部連結；其他單張連結（留言附件）只開那一張。

/** 上一張／下一張的位置（頭尾相接）。 */
export const stepIndex = (index, delta, length) => (length <= 0 ? 0 : (((index + delta) % length) + length) % length);

/** 把縮圖格上的 JSON 轉成燈箱項目；壞資料回空清單。 */
export const parseGallery = (raw) => {
    try {
        const list = JSON.parse(raw ?? '[]');

        return Array.isArray(list)
            ? list.filter((item) => item && typeof item.url === 'string').map((item) => ({
                url: item.url,
                name: String(item.name ?? ''),
                video: Boolean(item.video),
                source: String(item.source ?? ''),
                at: String(item.at ?? ''),
            }))
            : [];
    } catch {
        return [];
    }
};

/** 下方說明文字：名稱，以及「來自 誰的留言．時間」。 */
export const captionText = (item) => ({
    name: item.name || (item.video ? '影片' : '附件'),
    meta: [item.source ? `來自：${item.source}` : '', item.at].filter(Boolean).join('　'),
});

const itemFromAnchor = (anchor) => {
    const cell = anchor.closest('[data-album-item]');
    const time = cell?.querySelector('time');

    return {
        url: anchor.href,
        name: anchor.dataset.lightboxAlt || '',
        video: Boolean(anchor.querySelector('[data-attachment-video]')),
        source: (cell?.querySelector('[data-album-source]')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        at: time?.getAttribute('title')?.replace('（台北時間）', '') ?? time?.textContent ?? '',
    };
};

if (typeof document !== 'undefined') {
    const dialog = document.querySelector('[data-image-lightbox]');
    if (dialog) {
        const q = (name) => dialog.querySelector(`[data-lightbox-${name}]`);
        const image = q('image');
        const video = q('video');
        const title = q('title');
        const scaleOutput = q('scale');
        const original = q('original');
        const stage = q('stage');
        const zoomGroup = q('zoom-group');
        const prev = q('prev');
        const next = q('next');
        const captionName = q('caption-name');
        const captionMeta = q('caption-meta');
        const counter = q('counter');
        let items = [];
        let index = 0;
        let opener = null;
        let scale = 1;

        const applyScale = () => {
            image.style.transform = `scale(${scale})`;
            scaleOutput.value = `${Math.round(scale * 100)}%`;
            stage.scrollTo?.({ left: 0, top: 0 });
        };
        const changeScale = (amount) => {
            scale = Math.min(3, Math.max(0.5, scale + amount));
            applyScale();
        };

        const show = (target) => {
            index = stepIndex(target, 0, items.length);
            const item = items[index];
            scale = 1;
            video.pause?.();
            image.hidden = item.video;
            video.hidden = !item.video;
            zoomGroup.hidden = item.video;
            if (item.video) {
                image.removeAttribute('src');
                video.src = item.url;
                video.play?.().catch(() => {});
            } else {
                video.removeAttribute('src');
                image.src = item.url;
            }
            const caption = captionText(item);
            image.alt = caption.name;
            title.textContent = caption.name;
            captionName.textContent = caption.name;
            captionMeta.textContent = caption.meta;
            counter.textContent = `${index + 1} / ${items.length}`;
            prev.hidden = next.hidden = items.length < 2;
            original.href = item.url;
            original.textContent = item.video ? '開啟原檔' : '開啟原圖';
            applyScale();
        };

        const open = (list, start, from) => {
            if (list.length === 0) {
                return;
            }
            items = list;
            opener = from;
            show(start);
            if (!dialog.open) {
                dialog.showModal();
            }
            document.body.classList.add('overflow-hidden');
            q('close').focus();
        };

        document.addEventListener('click', (event) => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
                return;
            }
            const thumb = event.target.closest?.('[data-lightbox-index]');
            const gallery = thumb?.closest('[data-lightbox-gallery]');
            if (thumb && gallery) {
                event.preventDefault();
                event.stopPropagation();
                open(parseGallery(gallery.dataset.lightboxGallery), Number(thumb.dataset.lightboxIndex) || 0, thumb);

                return;
            }
            const trigger = event.target.closest?.('[data-lightbox-trigger]');
            if (!trigger) {
                return;
            }
            const isVideo = Boolean(trigger.querySelector('[data-attachment-video]'));
            // 影片縮圖不進燈箱：照連結在新分頁開；只有相簿（data-lightbox-play）在燈箱裡直接播放。
            if (isVideo && !('lightboxPlay' in trigger.dataset)) {
                return;
            }
            event.preventDefault();
            const album = trigger.closest('[data-chat-album]');
            const anchors = album ? Array.from(album.querySelectorAll('[data-lightbox-trigger]')) : [trigger];
            open(anchors.map(itemFromAnchor), Math.max(0, anchors.indexOf(trigger)), trigger);
        }, true);

        prev.addEventListener('click', () => show(stepIndex(index, -1, items.length)));
        next.addEventListener('click', () => show(stepIndex(index, 1, items.length)));
        q('zoom-out').addEventListener('click', () => changeScale(-0.25));
        q('zoom-in').addEventListener('click', () => changeScale(0.25));
        q('reset').addEventListener('click', () => {
            scale = 1;
            applyScale();
        });
        q('close').addEventListener('click', () => dialog.close());
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog || event.target === stage) {
                dialog.close();
            }
        });
        dialog.addEventListener('close', () => {
            document.body.classList.remove('overflow-hidden');
            image.removeAttribute('src');
            video.pause?.();
            video.removeAttribute('src');
            video.load?.();
            opener?.focus?.();
            opener = null;
            items = [];
        });
        dialog.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowLeft' && items.length > 1) {
                event.preventDefault();
                show(stepIndex(index, -1, items.length));
            } else if (event.key === 'ArrowRight' && items.length > 1) {
                event.preventDefault();
                show(stepIndex(index, 1, items.length));
            } else if (event.key === '+' || event.key === '=') {
                event.preventDefault();
                changeScale(0.25);
            } else if (event.key === '-') {
                event.preventDefault();
                changeScale(-0.25);
            } else if (event.key === '0') {
                event.preventDefault();
                scale = 1;
                applyScale();
            }
        });
    }
}
