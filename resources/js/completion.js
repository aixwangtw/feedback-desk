// 「完成」的兩個動作：
//  1. 開發團隊按「完成」→ 跳出可改字的確認留言，送出只發一則附「通過」按鈕的留言，單維持等老師，不會結案；
//  2. 老師在確認留言上按「通過」→ 單改成已完成（走原本的狀態端點，只有老師按得了）。
// 沒有 JS 時兩個 <form> 都照一般表單送出。成功後整頁重新載入，並記下要重新開啟的詳情視窗。

const REOPEN_KEY = 'feedback:reopen-dialog';

/** 伺服器回應 → 給人看的中文錯誤。 */
export const completionErrorMessage = (status, payload) => {
    if (status === 422) {
        return Object.values(payload?.errors ?? {})[0]?.[0] ?? payload?.message ?? '內容有誤，請修改後再試。';
    }
    if (status === 403) {
        return payload?.message ?? '這個操作你沒有權限。';
    }
    if (status === 419) {
        return '頁面停留太久已過期，請重新整理頁面後再試。';
    }
    if (status === 429) {
        return '操作太頻繁，請稍後再試。';
    }

    return payload?.message ?? '操作失敗，請稍後再試。';
};

/** 確認留言視窗 id（request-completion-<單>）→ 該張單的詳情視窗 id。 */
export const detailDialogIdFor = (completionDialogId) => completionDialogId.replace(/^request-completion-/, 'detail-report-');

const storage = () => {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
};

export const rememberReopen = (dialogId) => {
    try {
        storage()?.setItem(REOPEN_KEY, dialogId);
    } catch {
        // 沒有儲存空間就不重新開啟視窗，不影響操作。
    }
};

/** 取出並清掉要重新開啟的視窗 id。 */
export const consumeReopen = () => {
    try {
        const id = storage()?.getItem(REOPEN_KEY) ?? null;
        storage()?.removeItem(REOPEN_KEY);

        return id;
    } catch {
        return null;
    }
};

const post = async (form) => {
    const response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));

    return { ok: response.ok, status: response.status, payload };
};

const reload = (reopenDialogId) => {
    if (reopenDialogId) {
        rememberReopen(reopenDialogId);
    }
    window.location.reload();
};

if (typeof document !== 'undefined') {
    document.addEventListener('submit', async (event) => {
        const requestForm = event.target.closest?.('form[data-request-completion-form]');
        const approveForm = event.target.closest?.('form[data-completion-approve-form]');
        if (!requestForm && !approveForm) {
            return;
        }
        event.preventDefault();

        if (requestForm) {
            const dialog = requestForm.closest('dialog');
            const errorBox = requestForm.querySelector('[data-request-completion-error]');
            const send = requestForm.querySelector('[data-request-completion-send]');
            send.disabled = true;
            errorBox.hidden = true;
            try {
                const result = await post(requestForm);
                if (result.ok) {
                    const detail = document.getElementById(detailDialogIdFor(dialog.id));
                    reload(detail?.open ? detail.id : null);

                    return;
                }
                errorBox.textContent = completionErrorMessage(result.status, result.payload);
            } catch {
                errorBox.textContent = '網路連線失敗，確認留言尚未送出。';
            }
            errorBox.hidden = false;
            send.disabled = false;

            return;
        }

        const button = approveForm.querySelector('button[type=submit]');
        button.disabled = true;
        try {
            const result = await post(approveForm);
            if (result.ok) {
                reload(approveForm.closest('dialog[data-report-detail]')?.id ?? null);

                return;
            }
            window.alert(completionErrorMessage(result.status, result.payload));
        } catch {
            window.alert('網路連線失敗，請稍後再試。');
        }
        button.disabled = false;
    });

    const reopenId = consumeReopen();
    const reopenDialog = reopenId ? document.getElementById(reopenId) : null;
    if (reopenDialog && !reopenDialog.open) {
        reopenDialog.showModal();
    }
}
