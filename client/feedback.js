import './chat-panel.js';
import './album.js';
import './message-edit.js';
import { bindPageAttachmentComposers } from './attachment-composer.js';
import { bindPageMessageDrafts } from './message-drafts.js';
import { fileProblem, isVideoMime } from '../src/shared/attachment-rules';
import { openDialogThread } from './report-dialog-thread.js';
import { reopenPendingReport } from './completion.js';
import './row-link.js';
import './attachment-thumbs.js';
import './attachment-lightbox.js';
import './confirm-dialog.js';
import { isEditingMessage, replaceKeepingOpen } from './thread-details.js';
import { boardColumnHtml, listHtml, PORTAL_ROWS_ELEMENT_ID } from '../src/worker/views/rows-client';

// Long portal pages send their rows as JSON; build them before anything below binds to the rows.
const portalRowsData = document.getElementById(PORTAL_ROWS_ELEMENT_ID);
if (portalRowsData) {
    const payload = JSON.parse(portalRowsData.textContent || '{}');
    if (payload.view === 'board') {
        document.querySelectorAll('[data-kanban-list]').forEach((list) => {
            list.querySelector('[data-kanban-empty]')?.insertAdjacentHTML('beforebegin', boardColumnHtml(payload, list.dataset.status));
        });
    } else {
        document.querySelector('[data-report-table] tbody')?.insertAdjacentHTML('afterbegin', listHtml(payload));
    }
}

// 留言區的附件（data-attachment-composer）由 attachment-composer.js 處理預覽、拖曳與檢查。
bindPageAttachmentComposers();
// 單頁的待審留言（與詳情視窗、對話面板同一份畫面與按鈕行為，見 message-drafts.js）。
bindPageMessageDrafts();

const renderImagePreviews = (input) => {
    const targetId = input.dataset.previewTarget;
    const target = targetId ? document.getElementById(targetId) : null;

    if (!target) {
        return;
    }

    target.replaceChildren();

    Array.from(input.files).slice(0, 5).forEach((file) => {
        const figure = document.createElement('figure');
        const caption = document.createElement('figcaption');
        figure.className = 'min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white';
        caption.className = 'truncate px-2 py-1.5 text-[11px] text-slate-600';
        caption.textContent = file.name;
        if (isVideoMime(file.type)) {
            // 影片不產生縮圖（不解碼大檔），只顯示「影片」與檔名。
            const label = document.createElement('div');
            label.className = 'grid aspect-video w-full place-items-center bg-slate-900 text-xs font-semibold text-white';
            label.textContent = '影片';
            label.dataset.videoPreview = '';
            figure.append(label, caption);
            target.append(figure);

            return;
        }
        const image = document.createElement('img');
        const objectUrl = URL.createObjectURL(file);

        image.className = 'aspect-video w-full object-cover';
        image.alt = '';
        image.src = objectUrl;
        image.addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
        figure.append(image, caption);
        target.append(figure);
    });
};

document.addEventListener('change', (event) => {
    if (event.target.matches('[data-image-input]:not([data-attachment-composer])')) {
        renderImagePreviews(event.target);
    }
    if (event.target.matches('[data-project-switcher]')) {
        const url = event.target.value;
        if (url) {
            window.location.href = url;
        }
    }
});


const uploadErrorFor = (input) => {
    const holder = input.closest('label')?.parentElement ?? input.parentElement;
    let error = holder?.querySelector('[data-upload-error]');
    if (!error && holder) {
        error = document.createElement('p');
        error.className = 'mt-2 text-xs text-rose-700';
        error.setAttribute('data-upload-error', '');
        error.setAttribute('role', 'alert');
        holder.append(error);
    }
    return error;
};

const showUploadError = (input, message) => {
    const error = uploadErrorFor(input);
    if (error) {
        error.textContent = message;
    }
};

const formatMegabytes = (bytes) => `${Math.round(bytes / 1024 / 1024)} MB`;

// Each screenshot is sent in its own PUT request before the form is submitted; the form then only
// carries the returned upload ids. The Workers free plan allows 10 ms of CPU per request, and
// streaming one file straight into storage stays well inside it, while parsing a multipart body does not.
document.addEventListener('submit', async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches('[data-upload-form]') || form.dataset.uploadState === 'done') {
        return;
    }

    const inputs = Array.from(form.querySelectorAll('input[type="file"][data-upload-url]')).filter((input) => input.files.length > 0);
    if (inputs.length === 0) {
        return;
    }

    event.preventDefault();
    if (form.dataset.uploadState === 'busy') {
        return;
    }

    for (const input of inputs) {
        const error = input.closest('label')?.parentElement?.querySelector('[data-upload-error]');
        if (error) {
            error.textContent = '';
        }
        const max = Number(input.dataset.uploadMax || 5);
        const maxBytes = Number(input.dataset.uploadMaxBytes || 10 * 1024 * 1024);
        // 留言欄位（data-upload-allow-video）另收 mp4 影片，規則與伺服器同一份。
        if (input.dataset.uploadAllowVideo !== undefined) {
            const problem = fileProblem(Array.from(input.files), { maxFiles: max, maxImageBytes: maxBytes, allowVideo: true });
            if (problem) {
                showUploadError(input, problem);
                input.focus();
                return;
            }
            continue;
        }
        if (input.files.length > max) {
            showUploadError(input, `截圖最多 ${max} 張。`);
            input.focus();
            return;
        }
        const tooLarge = Array.from(input.files).find((file) => file.size > maxBytes);
        if (tooLarge) {
            showUploadError(input, `「${tooLarge.name}」超過 ${formatMegabytes(maxBytes)}。`);
            input.focus();
            return;
        }
    }

    const submit = event.submitter || form.querySelector('[type="submit"]');
    const originalLabel = submit?.textContent;
    const total = inputs.reduce((sum, input) => sum + input.files.length, 0);
    const uploadingLabel = inputs.some((input) => input.dataset.uploadAllowVideo !== undefined) ? '上傳圖片／影片中' : '上傳截圖中';
    let done = 0;
    form.dataset.uploadState = 'busy';
    form.querySelectorAll('input[data-upload-id]').forEach((hidden) => hidden.remove());
    if (submit) {
        submit.disabled = true;
        submit.textContent = `${uploadingLabel} 0/${total}…`;
    }

    try {
        for (const input of inputs) {
            for (const file of Array.from(input.files)) {
                const response = await fetch(input.dataset.uploadUrl, {
                    method: 'PUT',
                    body: file,
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': file.type || 'application/octet-stream',
                        'X-Filename': encodeURIComponent(file.name),
                    },
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result.id) {
                    throw Object.assign(new Error(result.message || `上傳失敗（HTTP ${response.status}）`), { input });
                }
                const hidden = document.createElement('input');
                hidden.type = 'hidden';
                hidden.name = input.dataset.uploadName;
                hidden.value = result.id;
                hidden.setAttribute('data-upload-id', '');
                form.append(hidden);
                done += 1;
                if (submit) {
                    submit.textContent = `${uploadingLabel} ${done}/${total}…`;
                }
            }
        }
    } catch (error) {
        form.dataset.uploadState = '';
        if (submit) {
            submit.disabled = false;
            submit.textContent = originalLabel;
        }
        showUploadError(error.input || inputs[0], `${error.message}，請重新選擇檔案後再送出。`);
        return;
    }

    form.dataset.uploadState = 'done';
    form.submit();
});

const issueEntry = document.querySelector('[data-issue-entry]');
if (issueEntry) {
    const issueList = issueEntry.querySelector('[data-issue-list]');
    const issueTemplate = issueEntry.querySelector('[data-issue-template]');
    const addIssue = issueEntry.querySelector('[data-add-issue]');
    let nextIndex = issueList.querySelectorAll('[data-issue-row]').length;

    const updateIssueRows = () => {
        const rows = Array.from(issueList.querySelectorAll('[data-issue-row]'));

        rows.forEach((row, index) => {
            row.querySelector('[data-issue-number]').textContent = String(index + 1);
            row.querySelector('[data-remove-issue]').classList.toggle('invisible', rows.length === 1);
        });

        addIssue.disabled = rows.length >= 20;
        addIssue.classList.toggle('opacity-50', addIssue.disabled);
    };

    addIssue.addEventListener('click', () => {
        if (issueList.querySelectorAll('[data-issue-row]').length >= 20) {
            return;
        }

        issueList.insertAdjacentHTML('beforeend', issueTemplate.innerHTML.replaceAll('__INDEX__', String(nextIndex)));
        nextIndex += 1;
        updateIssueRows();
        issueList.lastElementChild?.querySelector('input')?.focus();
    });

    issueList.addEventListener('click', (event) => {
        const removeButton = event.target.closest('[data-remove-issue]');
        if (!removeButton || issueList.querySelectorAll('[data-issue-row]').length === 1) {
            return;
        }

        removeButton.closest('[data-issue-row]').remove();
        updateIssueRows();
    });

    updateIssueRows();
}

document.querySelectorAll('[data-private-url]').forEach((input) => {
    input.addEventListener('focus', () => input.select());
});

document.querySelectorAll('[data-copy-button]').forEach((button) => {
    button.addEventListener('click', async () => {
        const input = button.parentElement?.querySelector('[data-copy-source]');
        if (!input) {
            return;
        }

        await navigator.clipboard.writeText(input.value);
        button.textContent = '已複製';
    });
});

document.querySelectorAll('[data-auto-submit]').forEach((input) => {
    input.addEventListener('change', () => input.form?.requestSubmit());
});

document.querySelectorAll('[data-keyword-search]').forEach((input) => {
    let searchTimer;
    let composing = false;
    const scheduleSearch = () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => input.form?.requestSubmit(), 450);
    };

    input.addEventListener('input', () => {
        if (!composing) {
            scheduleSearch();
        }
    });
    input.addEventListener('compositionstart', () => {
        composing = true;
        window.clearTimeout(searchTimer);
    });
    input.addEventListener('compositionend', () => {
        composing = false;
        scheduleSearch();
    });
});

// 附件燈箱（放大、播放、上一張／下一張）在 attachment-lightbox.js，清單縮圖、相簿、詳情共用。

const activity = document.querySelector('[data-activity]');
if (activity) {
    // Poll for new messages: the server answers 304 when nothing changed. The wait doubles after
    // each unchanged answer (5 s up to 60 s), resets when something changes, and polling stops
    // while the tab is hidden.
    const minDelay = 5000;
    const maxDelay = 60000;
    let delay = minDelay;
    let etag = activity.dataset.etag || null;
    let timer = null;

    const schedule = () => {
        window.clearTimeout(timer);
        if (!document.hidden) {
            timer = window.setTimeout(refresh, delay);
        }
    };

    const refresh = async () => {
        window.clearTimeout(timer);
        try {
            const headers = { 'X-Requested-With': 'XMLHttpRequest' };
            if (etag) {
                headers['If-None-Match'] = etag;
            }
            const response = await fetch(activity.dataset.refreshUrl, { headers, cache: 'no-store' });
            if (response.status === 304) {
                delay = Math.min(maxDelay, delay * 2);
            } else if (response.ok) {
                // A full answer means something changed: show it and check again soon.
                const html = await response.text();
                // 正在編輯留言時先不換掉內容（免得打到一半的字被洗掉）；etag 不更新，編輯完下一輪再換。
                if (!isEditingMessage(activity)) {
                    // 使用者展開的過去的處理說明換新後維持展開。
                    replaceKeepingOpen(activity, () => {
                        activity.innerHTML = html;
                    });
                    etag = response.headers.get('ETag');
                    // 附件區（相簿）的內容只會跟著活動一起變，通知 album.js 重新取。
                    document.dispatchEvent(new CustomEvent('feedback:activity-changed'));
                }
                delay = minDelay;
            } else {
                delay = Math.min(maxDelay, delay * 2);
            }
        } catch {
            // A temporary polling failure should not interrupt the conversation form.
            delay = Math.min(maxDelay, delay * 2);
        }
        schedule();
    };

    // 編輯、收回留言後馬上重新取（message-edit.js）。
    document.addEventListener('feedback:messages-changed', refresh);

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            window.clearTimeout(timer);
        } else {
            delay = minDelay;
            refresh();
        }
    });
    schedule();
}

// Report dialogs on the list page are loaded the first time one of them is opened.
const loadReportDialogs = async (opener) => {
    const source = opener.closest('[data-dialogs-src]');
    const container = document.querySelector('[data-report-dialogs]');
    if (!source || !container) {
        return;
    }
    if (!source.dialogsLoading) {
        source.dialogsLoading = fetch(source.dataset.dialogsSrc, { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then((response) => (response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`))))
            .then((html) => container.insertAdjacentHTML('beforeend', html))
            .catch((error) => {
                source.dialogsLoading = null;
                throw error;
            });
    }
    await source.dialogsLoading;
};

// 詳情窄欄的「⋯」選單：點選單外面或選了選單裡的動作就收起來。
document.addEventListener('click', (event) => {
    document.querySelectorAll('details[data-action-menu][open]').forEach((menu) => {
        if (!menu.contains(event.target) || event.target.closest('[data-dialog-open], [data-chat-open], button[type=submit]')) {
            menu.open = false;
        }
    });
});

document.addEventListener('click', async (event) => {
    const opener = event.target.closest('[data-dialog-open]');
    if (opener) {
        // 連結（清單的編號、標題）按住修飾鍵或用滑鼠中鍵時照瀏覽器預設開新分頁；一般點擊開視窗。
        if (opener.tagName === 'A') {
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
                return;
            }
            event.preventDefault();
        }
        let dialog = document.getElementById(opener.dataset.dialogOpen);
        if (!dialog) {
            opener.setAttribute('aria-busy', 'true');
            try {
                await loadReportDialogs(opener);
            } catch {
                window.alert('載入失敗，請重新整理頁面後再試。');
            } finally {
                opener.removeAttribute('aria-busy');
            }
            dialog = document.getElementById(opener.dataset.dialogOpen);
        }
        if (dialog && !dialog.open) {
            dialog.showModal();
        }
        openDialogThread(dialog);

        return;
    }

    event.target.closest('[data-dialog-close]')?.closest('dialog')?.close();
});

document.addEventListener('click', (event) => {
    if (event.target instanceof HTMLDialogElement) {
        event.target.close();
    }
});

document.querySelectorAll('dialog[data-open-on-load]').forEach((dialog) => {
    dialog.showModal();
    openDialogThread(dialog);
});

// 狀態不再由人在網頁上拖拉或下拉切換（留言時自動切換、客戶按「完成」），看板只是依狀態分欄顯示。

// 詳細對話框與詳細頁的分類下拉：選了就存，失敗時回到原值並顯示中文說明。
const CATEGORY_ERROR_MESSAGES = {
    401: '登入已過期，請重新登入後再試。',
    403: '你沒有權限修改這張單的分類。',
    404: '找不到這張單，可能已被刪除，請重新整理頁面。',
    419: '頁面已過期，請重新整理後再試。',
    429: '操作太頻繁，請稍等一下再試。',
};

document.addEventListener('focusin', (event) => {
    const select = event.target.closest?.('[data-category-autosave]');
    if (select && select.dataset.savedValue === undefined) {
        select.dataset.savedValue = select.value;
    }
});

document.addEventListener('change', async (event) => {
    const select = event.target.closest?.('[data-category-autosave]');
    if (!select) {
        return;
    }
    const form = select.form;
    const feedback = form?.querySelector('[data-category-feedback]');
    const savedValue = select.dataset.savedValue ?? '';
    const body = new URLSearchParams(new FormData(form));
    select.disabled = true;
    if (feedback) feedback.textContent = '儲存中…';
    try {
        const response = await fetch(form.action, {
            method: 'PATCH',
            body,
            headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(result.message || CATEGORY_ERROR_MESSAGES[response.status] || '儲存失敗，請重新整理後再試。');
        }
        select.dataset.savedValue = result.category ?? '';
        if (feedback) feedback.textContent = '已儲存';
        // 同一張單在頁面上可能有好幾個下拉（清單、看板、詳細視窗），存好後一起同步。
        const saved = result.category ?? '';
        document.querySelectorAll(`[data-category-form][data-report-public-id="${CSS.escape(form.dataset.reportPublicId)}"] [data-category-autosave]`).forEach((other) => {
            if (saved !== '' && !Array.from(other.options).some((option) => option.value === saved)) {
                other.add(new Option(saved, saved));
            }
            other.value = saved;
            other.dataset.savedValue = saved;
        });
    } catch (error) {
        select.value = savedValue;
        if (feedback) feedback.textContent = error instanceof Error && /[一-鿿]/.test(error.message) ? error.message : '儲存失敗，請檢查網路後再試。';
    } finally {
        select.disabled = false;
    }
});

// 完成／確認完成後整頁重新載入，要把剛才開著的那張單的詳情再開起來（要等上面的點擊處理都綁好）。
reopenPendingReport();
