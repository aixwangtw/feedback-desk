// 留言輸入區的附件：按「附件」選檔與直接拖進輸入區走同一套檢查與預覽。
// 待送出清單存在這裡，並同步回 <input type="file"> 的 files，所以既有的上傳流程（讀 input.files）完全不用改。
// 檢查規則見 src/shared/attachment-list.ts；預覽用 URL.createObjectURL，移除、送出（表單重設）、離開頁面時 revoke。

import { addAttachments, attachmentPreviewItems, attachmentTitle, dragHasFiles, dropHintText, removeAttachmentAt } from '../src/shared/attachment-list';

const DISABLED_MESSAGE = '目前這則不能再加附件。';
const ERROR_CLASS = 'rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800';
const HINT_CLASS = 'pointer-events-none absolute inset-0 z-10 items-center justify-center rounded-xl border-2 border-dashed border-teal-600 bg-teal-50/90 text-sm font-semibold text-teal-900';

let guardInstalled = false;

/** 拖檔案到輸入區以外的地方，瀏覽器預設會直接開檔離開頁面：一律擋掉，只有輸入區（data-attachment-zone）收。 */
const installPageGuard = () => {
    if (guardInstalled) {
        return;
    }
    guardInstalled = true;
    document.addEventListener('dragover', (event) => {
        if (!dragHasFiles(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        if (!event.target.closest?.('[data-attachment-zone]')) {
            event.dataTransfer.dropEffect = 'none';
        }
    });
    document.addEventListener('drop', (event) => {
        if (dragHasFiles(event.dataTransfer)) {
            event.preventDefault();
        }
    });
};

const buildPreviewNode = (item, url, onRemove) => {
    const figure = document.createElement('figure');
    figure.className = `flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-1 ${item.kind === 'video' ? 'w-56 max-w-full' : 'attachment-tile'}`;
    figure.dataset.attachmentPreview = item.kind;
    let media;
    if (item.kind === 'video') {
        media = document.createElement('video');
        media.controls = true;
        media.playsInline = true;
        media.preload = 'metadata';
        media.src = url;
        media.title = item.name;
        media.className = 'h-28 w-full rounded bg-black';
    } else {
        media = document.createElement('img');
        media.src = url;
        media.alt = item.name;
        media.className = 'attachment-tile-thumb w-full rounded object-cover';
    }
    const caption = document.createElement('figcaption');
    caption.className = 'attachment-caption text-[11px] leading-4 text-slate-600';
    caption.textContent = attachmentTitle(item.name);
    caption.title = item.name;
    caption.dataset.attachmentTitle = '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '移除';
    remove.dataset.attachmentRemove = '';
    remove.setAttribute('aria-label', `移除 ${item.name}`);
    remove.className = 'self-start rounded px-1 text-[11px] font-semibold text-rose-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600';
    remove.addEventListener('click', () => onRemove(item.index));
    figure.append(media, caption, remove);

    return figure;
};

/**
 * @param input 檔案欄位（要有 data-preview-target 指向預覽區）
 * @param getOptions 回傳 { maxFiles, maxImageBytes, allowVideo }；面板與詳情視窗的上限要等伺服器回應才知道，所以每次檢查才取。
 */
export const bindAttachmentComposer = (input, getOptions) => {
    const form = input.closest('form');
    const preview = input.dataset.previewTarget ? document.getElementById(input.dataset.previewTarget) : null;
    if (!form || !preview || input.dataset.attachmentBound) {
        return null;
    }
    input.dataset.attachmentBound = '1';
    installPageGuard();

    let files = [];
    const urls = new Map();
    let errorShown = false;
    let errorBox = form.querySelector('[data-attachment-error]');
    if (!errorBox) {
        errorBox = document.createElement('p');
        errorBox.className = ERROR_CLASS;
        errorBox.setAttribute('role', 'alert');
        errorBox.hidden = true;
        errorBox.dataset.attachmentError = '';
        preview.before(errorBox);
    }
    const showError = (messages) => {
        errorBox.textContent = messages.join(' ');
        errorBox.hidden = false;
        errorShown = true;
    };
    const clearError = () => {
        if (errorShown) {
            errorBox.hidden = true;
            errorBox.textContent = '';
            errorShown = false;
        }
    };
    const syncInput = () => {
        const transfer = new DataTransfer();
        files.forEach((file) => transfer.items.add(file));
        input.files = transfer.files;
    };
    const urlFor = (file) => {
        if (!urls.has(file)) {
            urls.set(file, URL.createObjectURL(file));
        }

        return urls.get(file);
    };
    const render = () => {
        urls.forEach((url, file) => {
            if (!files.includes(file)) {
                URL.revokeObjectURL(url);
                urls.delete(file);
            }
        });
        const items = attachmentPreviewItems(files, getOptions());
        preview.replaceChildren(...items.map((item) => buildPreviewNode(item, urlFor(files[item.index]), (index) => {
            files = removeAttachmentAt(files, index);
            syncInput();
            render();
        })));
    };
    const accept = (incoming) => {
        if (input.disabled) {
            showError([DISABLED_MESSAGE]);

            return;
        }
        const result = addAttachments(files, incoming, getOptions());
        files = result.files;
        syncInput();
        render();
        if (result.messages.length > 0) {
            showError(result.messages);
        } else {
            clearError();
        }
    };
    const clear = () => {
        files = [];
        syncInput();
        render();
        clearError();
    };

    input.addEventListener('change', () => accept(Array.from(input.files)));
    form.addEventListener('reset', clear);
    window.addEventListener('pagehide', () => urls.forEach((url) => URL.revokeObjectURL(url)));

    // 拖曳：整個留言輸入區都收，拖進來時顯示放置提示。
    form.dataset.attachmentZone = '';
    form.classList.add('relative');
    const hint = document.createElement('div');
    hint.className = `hidden ${HINT_CLASS}`;
    hint.dataset.attachmentDropHint = '';
    form.append(hint);
    const setHint = (visible) => {
        if (visible) {
            hint.textContent = dropHintText(getOptions());
        }
        hint.classList.toggle('hidden', !visible);
        hint.classList.toggle('flex', visible);
    };
    let depth = 0;
    form.addEventListener('dragenter', (event) => {
        if (!dragHasFiles(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        depth += 1;
        setHint(!input.disabled);
    });
    form.addEventListener('dragover', (event) => {
        if (!dragHasFiles(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = input.disabled ? 'none' : 'copy';
    });
    form.addEventListener('dragleave', (event) => {
        if (!dragHasFiles(event.dataTransfer)) {
            return;
        }
        depth = Math.max(0, depth - 1);
        if (depth === 0) {
            setHint(false);
        }
    });
    form.addEventListener('drop', (event) => {
        if (!dragHasFiles(event.dataTransfer)) {
            return;
        }
        event.preventDefault();
        depth = 0;
        setHint(false);
        accept(Array.from(event.dataTransfer.files));
    });

    return { clear };
};

/** 單頁留言區：規則直接寫在欄位屬性上（data-upload-max、data-upload-max-bytes、data-upload-allow-video）。 */
export const bindPageAttachmentComposers = () => {
    document.querySelectorAll('input[data-attachment-composer="page"]').forEach((input) => {
        bindAttachmentComposer(input, () => ({
            maxFiles: Number(input.dataset.uploadMax) || 5,
            maxImageBytes: Number(input.dataset.uploadMaxBytes) || 10 * 1024 * 1024,
            allowVideo: input.dataset.uploadAllowVideo !== undefined,
        }));
    });
};
