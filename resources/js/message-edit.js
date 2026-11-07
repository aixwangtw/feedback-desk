// 留言的編輯與收回（單頁、詳情視窗、右下角面板共用）：選單在每則自己的留言旁（x-feedback.message-menu），
// 編輯表單藏在泡泡裡（x-feedback.message-edit-form）。兩個動作都不留痕跡：編輯後不顯示「已編輯」，收回後整則消失。
// 編輯中的留言串不會被定時刷新換掉（isEditingMessage）；成功後發出 feedback:messages-changed，各處重新載入。

import { bindAttachmentComposer } from './attachment-composer';
import { isEditingMessage } from './thread-details';

let previewCounter = 0;

const notifyChanged = () => document.dispatchEvent(new CustomEvent('feedback:messages-changed'));

const failureText = (status) => {
    if (status === 422) {
        return '留言內容有誤，請檢查後再送出。';
    }
    if (status === 419) {
        return '頁面停留太久已過期，請重新整理頁面。';
    }
    if (status === 404) {
        return '找不到這則留言，可能已被收回。';
    }

    return '儲存失敗，請稍後再試。';
};

const post = (form, body) => fetch(form.action, {
    method: 'POST',
    body,
    headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    credentials: 'same-origin',
});

const setEditing = (item, editing) => {
    const form = item.querySelector('[data-message-edit-form]');
    form.hidden = !editing;
    item.querySelector('[data-chat-body]').hidden = editing;
    item.querySelectorAll('[data-chat-attachments]').forEach((box) => {
        box.hidden = editing;
    });
    item.querySelector('[data-message-menu]')?.removeAttribute('open');
    if (editing) {
        form.querySelector('[data-message-edit-body]').focus();
    }
};

const openEditor = (item) => {
    const form = item.querySelector('[data-message-edit-form]');
    const input = form.querySelector('[data-message-edit-files]');
    const preview = form.querySelector('[data-message-edit-preview]');
    if (!input.dataset.attachmentBound) {
        previewCounter += 1;
        preview.id = `message-edit-preview-${previewCounter}`;
        input.dataset.previewTarget = preview.id;
        bindAttachmentComposer(input);
    }
    setEditing(item, true);
};

document.addEventListener('click', (event) => {
    const open = event.target.closest('[data-message-edit-open]');
    if (open) {
        openEditor(open.closest('[data-chat-message]'));

        return;
    }
    const cancel = event.target.closest('[data-message-edit-cancel]');
    if (cancel) {
        const item = cancel.closest('[data-chat-message]');
        item.querySelector('[data-message-edit-form]').reset();
        setEditing(item, false);

        return;
    }
    // 點選單以外的地方就收起選單。
    document.querySelectorAll('[data-message-menu][open]').forEach((menu) => {
        if (!menu.contains(event.target)) {
            menu.removeAttribute('open');
        }
    });
});

document.addEventListener('submit', async (event) => {
    const withdraw = event.target.closest?.('[data-message-withdraw-form]');
    const edit = event.target.closest?.('[data-message-edit-form]');
    if (!withdraw && !edit) {
        return;
    }
    event.preventDefault();

    if (withdraw) {
        // 確認視窗由 confirm-dialog.js 在送出前處理（表單帶 data-confirm-*）。
        try {
            const response = await post(withdraw, new FormData(withdraw));
            if (response.ok) {
                notifyChanged();
            } else {
                window.alert(failureText(response.status));
            }
        } catch {
            window.alert('網路連線失敗，請稍後再試。');
        }

        return;
    }

    const item = edit.closest('[data-chat-message]');
    const error = edit.querySelector('[data-message-edit-error]');
    const save = edit.querySelector('[data-message-edit-save]');
    if (edit.querySelector('[data-message-edit-body]').value.trim() === '') {
        error.textContent = '留言內容不能是空白。';
        error.hidden = false;

        return;
    }
    save.disabled = true;
    error.hidden = true;
    try {
        const response = await post(edit, new FormData(edit));
        if (response.ok) {
            setEditing(item, false);
            notifyChanged();
        } else if (response.status === 422) {
            const data = await response.json().catch(() => ({}));
            error.textContent = Object.values(data.errors ?? {})[0]?.[0] ?? failureText(422);
            error.hidden = false;
        } else {
            error.textContent = failureText(response.status);
            error.hidden = false;
        }
    } catch {
        error.textContent = '網路連線失敗，請稍後再試。';
        error.hidden = false;
    } finally {
        save.disabled = false;
    }
});

export { isEditingMessage };
