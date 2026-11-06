// 待審留言（草稿）的操作，單頁、清單／看板的詳情視窗、右下角對話面板三處共用這一份。
// 畫面是伺服器渲染的 DraftsSection（src/worker/views/report.tsx；單頁直接輸出，視窗與面板經對話端點的 drafts_html 取得）；
// 這裡只負責按鈕：送出（paths.draftSend）、儲存（update）、捨棄（discard），一律打同一組端點，成功後交給各處的 onChanged 重新載入。

/** 伺服器回應 → 給老師看的中文錯誤。 */
export const draftRequestError = (status, payload) => {
    if (status === 422) {
        return Object.values(payload?.errors ?? {})[0]?.[0] ?? payload?.message ?? '內容有誤，請修改後再試。';
    }
    if (status === 404) {
        return '這則待審留言已經送出或被捨棄，請重新整理。';
    }
    if (status === 419) {
        return '頁面停留太久已過期，請重新整理頁面後再試。';
    }
    if (status === 403) {
        return '只有開發團隊能處理待審留言。';
    }

    return '操作失敗，請稍後再試。';
};

/** 比對草稿區有沒有變：相對時間（「3 分鐘前」）每次不同，先拿掉。 */
export const draftsSignature = (html) => html.replace(/(<time\b[^>]*>)[^<]*(<\/time>)/g, '$1$2');

const postDraftForm = async (url, params) => {
    const response = await fetch(url, {
        method: 'POST',
        body: params,
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));

    return { ok: response.ok, status: response.status, payload };
};

const showDraftError = (item, message) => {
    const box = item.querySelector('[data-draft-error]');
    if (box) {
        box.textContent = message;
        box.hidden = false;
    }
};

const runDraftAction = async (root, item, run, onChanged) => {
    const buttons = Array.from(item.querySelectorAll('button'));
    buttons.forEach((each) => { each.disabled = true; });
    const box = item.querySelector('[data-draft-error]');
    if (box) {
        box.hidden = true;
    }
    try {
        const result = await run();
        if (result.ok) {
            // 剛操作完的那則（編輯框還開著）也要換成最新內容，下一次載入不能因為編輯框展開而跳過。
            root.dataset.forceRender = '1';
            onChanged();

            return;
        }
        showDraftError(item, draftRequestError(result.status, result.payload));
    } catch {
        showDraftError(item, '網路連線失敗，請稍後再試。');
    } finally {
        buttons.forEach((each) => { each.disabled = false; });
    }
};

/**
 * 在容器（或整頁）上綁一次：處理裡面所有草稿的送出、儲存、捨棄。
 * 沒有 JS 時這些 <form> 仍照原本的方式送出（單頁會整頁重新載入）。
 */
export const bindMessageDrafts = (root, { onChanged }) => {
    if (root.dataset.draftsBound) {
        return;
    }
    root.dataset.draftsBound = '1';

    root.addEventListener('submit', (event) => {
        const form = event.target.closest?.('form[data-draft-form]');
        const item = form?.closest('[data-message-draft]');
        if (!form || !item || event.defaultPrevented) {
            return;
        }
        event.preventDefault();
        runDraftAction(root, item, () => postDraftForm(form.action, new URLSearchParams(new FormData(form))), onChanged);
    });

    root.addEventListener('click', (event) => {
        const button = event.target.closest?.('[data-draft-save-send]');
        const item = button?.closest('[data-message-draft]');
        if (!button || !item) {
            return;
        }
        // 編輯框裡（可能改過）的文字直接送出：帶 body 打 send 端點。
        const form = button.closest('form');
        const data = new URLSearchParams([['body', form.querySelector('[data-draft-edit-body]').value]]);
        runDraftAction(root, item, () => postDraftForm(item.dataset.draftSendUrl, data), onChanged);
    });
};

/**
 * 把伺服器給的草稿區放進容器（視窗、面板用）：沒變就不動；老師正在編輯（編輯框展開）時也不覆蓋，免得蓋掉打到一半的字。
 */
export const renderMessageDrafts = (container, html, { onChanged }) => {
    bindMessageDrafts(container, { onChanged });
    const signature = draftsSignature(html ?? '');
    if (container.dataset.signature === signature) {
        return;
    }
    if (container.dataset.forceRender !== '1' && container.querySelector('details[open]')) {
        return;
    }
    delete container.dataset.forceRender;
    container.dataset.signature = signature;
    const template = document.createElement('template');
    template.innerHTML = html ?? '';
    container.replaceChildren(template.content);
};

/** 單頁：草稿區是伺服器直接輸出的，綁上按鈕行為；變動後整頁重新載入（留言串與草稿一起更新）。 */
export const bindPageMessageDrafts = () => {
    const page = document.querySelector('#message-drafts');
    if (page) {
        bindMessageDrafts(page, { onChanged: () => window.location.reload() });
    }
};
