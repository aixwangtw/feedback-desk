// 確認視窗：帶 data-confirm-message 的表單送出前，先開全站共用的 <dialog data-confirm-dialog>（不用瀏覽器 confirm()）。
// 文字由伺服器（FeedbackConfirmText）放在表單的 data-confirm-* 屬性；按「確認」才真的送出，「取消」、Esc、點背景都只關閉視窗。

/** 表單屬性 → 視窗內容；沒寫的欄位用預設值。 */
export const confirmOptions = (dataset) => ({
    title: dataset.confirmTitle || '確定要繼續嗎？',
    message: dataset.confirmMessage || '',
    label: dataset.confirmLabel || '確認',
    tone: dataset.confirmTone === 'success' ? 'success' : 'danger',
});

const TONE_CLASSES = {
    danger: ['bg-rose-600', 'hover:bg-rose-700', 'focus-visible:ring-rose-600'],
    success: ['bg-emerald-600', 'hover:bg-emerald-700', 'focus-visible:ring-emerald-600'],
};

/** 開視窗，回傳 Promise<boolean>：按確認 true，其他方式關閉 false。 */
export const askConfirm = (dialog, options) => new Promise((resolve) => {
    dialog.querySelector('[data-confirm-title-text]').textContent = options.title;
    dialog.querySelector('[data-confirm-message-text]').textContent = options.message;
    const ok = dialog.querySelector('[data-confirm-ok]');
    ok.textContent = options.label;
    Object.values(TONE_CLASSES).flat().forEach((name) => ok.classList.remove(name));
    ok.classList.add(...TONE_CLASSES[options.tone]);

    let answer = false;
    const onOk = (event) => {
        event.preventDefault();
        answer = true;
        dialog.close();
    };
    ok.addEventListener('click', onOk);
    dialog.addEventListener('close', () => {
        ok.removeEventListener('click', onOk);
        resolve(answer);
    }, { once: true });
    dialog.showModal();
    dialog.querySelector('[data-confirm-cancel]')?.focus();
});

if (typeof document !== 'undefined') {
    document.addEventListener('submit', (event) => {
        const form = event.target;
        const dialog = document.querySelector('dialog[data-confirm-dialog]');
        if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-confirm-message') || !dialog || form.dataset.confirmed === '1') {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const submitter = event.submitter;
        askConfirm(dialog, confirmOptions(form.dataset)).then((yes) => {
            if (!yes) {
                return;
            }
            // 已確認：同一個表單再送一次，後面原本的處理（AJAX 或一般送出）照常執行。
            form.dataset.confirmed = '1';
            try {
                form.requestSubmit(submitter ?? undefined);
            } finally {
                delete form.dataset.confirmed;
            }
        });
    }, true);
}
