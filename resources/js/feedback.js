import Sortable from 'sortablejs';
import { isEditingMessage, replaceKeepingOpen } from './thread-details';

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
        caption.className = 'truncate px-2 py-1.5 text-[11px] text-slate-600';
        caption.textContent = file.name;
        if (file.type.startsWith('video/')) {
            // 影片不產生縮圖，只顯示檔名與標示。
            const label = document.createElement('div');
            label.className = 'grid aspect-video w-full place-items-center bg-slate-900 text-xs font-semibold text-white';
            label.textContent = '影片';
            figure.className = 'min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white';
            figure.append(label, caption);
            target.append(figure);

            return;
        }
        const image = document.createElement('img');
        const objectUrl = URL.createObjectURL(file);

        figure.className = 'min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white';
        image.className = 'aspect-video w-full object-cover';
        image.alt = '';
        image.src = objectUrl;
        image.addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
        figure.append(image, caption);
        target.append(figure);
    });
};

document.addEventListener('change', (event) => {
    if (event.target.matches('[data-image-input]:not([data-attachment-rules])')) {
        renderImagePreviews(event.target);
    }
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

// 附件燈箱（圖片放大、影片播放、上一張／下一張）在 attachment-lightbox.js，詳情、相簿、清單縮圖共用。

const activity = document.querySelector('[data-activity]');
if (activity) {
    const refresh = async () => {
        if (document.hidden || isEditingMessage(activity)) {
            return;
        }

        try {
            const response = await fetch(activity.dataset.refreshUrl, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
            });

            if (response.ok) {
                const html = await response.text();
                replaceKeepingOpen(activity, () => {
                    activity.innerHTML = html;
                });
            }
        } catch {
            // A temporary polling failure should not interrupt the conversation form.
        }
    };

    window.setInterval(refresh, 5000);
    document.addEventListener('feedback:messages-changed', refresh);
}

document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-dialog-open]');
    if (opener) {
        // 連結（清單的編號、標題）按住修飾鍵或用滑鼠中鍵時照瀏覽器預設開新分頁；一般點擊開視窗。
        if (opener.tagName === 'A' && (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) {
            return;
        }
        event.preventDefault();
        const dialog = document.getElementById(opener.dataset.dialogOpen);
        if (dialog && !dialog.open) {
            dialog.showModal();
        }

        return;
    }

    event.target.closest('[data-dialog-close]')?.closest('dialog')?.close();
});

// 詳情窄欄的「⋯」選單：點選單外面或選了選單裡的動作就收起來。
document.addEventListener('click', (event) => {
    document.querySelectorAll('details[data-action-menu][open]').forEach((menu) => {
        if (!menu.contains(event.target) || event.target.closest('[data-dialog-open], [data-chat-open], button[type=submit]')) {
            menu.open = false;
        }
    });
});

document.addEventListener('click', (event) => {
    if (event.target instanceof HTMLDialogElement) {
        event.target.close();
    }
});

document.querySelectorAll('dialog[data-open-on-load]').forEach((dialog) => dialog.showModal());

const persistStatus = async (form, status) => {
    const body = new FormData(form);
    body.set('status', status);
    const response = await fetch(form.action, {
        method: 'POST',
        body,
        headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
};

const refreshKanbanPageCounts = () => {
    document.querySelectorAll('[data-kanban-column]').forEach((column) => {
        const cards = column.querySelectorAll('[data-kanban-card]');
        const count = column.querySelector('[data-kanban-page-count]');
        const empty = column.querySelector('[data-kanban-empty]');

        if (count) {
            count.textContent = String(cards.length);
        }
        if (empty) {
            empty.hidden = cards.length > 0;
        }
    });
};

const insertCardInPageOrder = (list, card) => {
    const order = Number(card.dataset.boardOrder);
    const nextCard = Array.from(list.querySelectorAll('[data-kanban-card]')).find(
        (candidate) => candidate !== card && Number(candidate.dataset.boardOrder) > order,
    );

    list.insertBefore(card, nextCard || list.querySelector('[data-kanban-empty]'));
};

const kanbanListForStatus = (status) => Array.from(document.querySelectorAll('[data-kanban-list]'))
    .find((list) => list.dataset.status === status);

const announceKanban = (message) => {
    const announcer = document.querySelector('[data-kanban-announcer]');
    if (announcer) {
        announcer.textContent = message;
    }
};

const syncStatusDot = (select) => {
    const dot = select.form?.querySelector('[data-status-dot]');
    const selected = select.selectedOptions[0];

    if (dot && selected?.dataset.dot) {
        dot.className = dot.className.replace(/\bbg-\S+/g, '').trim() + ' ' + selected.dataset.dot;
    }
};

document.querySelectorAll('[data-status-autosave]').forEach((select) => {
    const form = select.form;
    const feedback = form?.querySelector('[data-status-feedback]');
    select.dataset.savedValue = select.value;

    select.addEventListener('change', async () => {
        const requestedStatus = select.value;
        const savedValue = select.dataset.savedValue;
        const card = select.closest('[data-kanban-card]');
        select.disabled = true;
        feedback.textContent = '儲存中…';

        try {
            const result = await persistStatus(form, requestedStatus);
            select.dataset.savedValue = result.status;
            syncStatusDot(select);
            updateStatusSummary(result.counts);

            if (card) {
                const destination = kanbanListForStatus(result.status);
                if (destination) {
                    card.dataset.status = result.status;
                    insertCardInPageOrder(destination, card);
                    refreshKanbanPageCounts();
                }
            }

            feedback.textContent = '已儲存';
            announceKanban(result.message);
        } catch {
            select.value = savedValue;
            syncStatusDot(select);
            feedback.textContent = '儲存失敗，請重新整理後再試';
            announceKanban('狀態儲存失敗，卡片仍在原本的欄位。');
        } finally {
            select.disabled = false;
        }
    });
});

// 狀態不再由人拖拉或下拉切換（留言自動切換、客戶按「完成」），看板只在明確標了 data-kanban-sortable 時才可拖拉。
document.querySelectorAll('[data-kanban-list][data-kanban-sortable]').forEach((list) => {
    Sortable.create(list, {
        group: 'feedback-kanban',
        sort: false,
        animation: 160,
        draggable: '[data-kanban-card]',
        filter: 'a, form, input, select, textarea, [data-card-action], [data-chat-open]',
        preventOnFilter: false,
        chosenClass: 'kanban-card-chosen',
        ghostClass: 'kanban-card-ghost',
        dragClass: 'kanban-card-dragging',
        delay: 120,
        delayOnTouchOnly: true,
        touchStartThreshold: 4,
        async onEnd(event) {
            const card = event.item;
            const originalList = event.from;
            const destinationList = event.to;
            const originalStatus = card.dataset.status;
            const requestedStatus = destinationList.dataset.status;

            if (originalList === destinationList || originalStatus === requestedStatus) {
                insertCardInPageOrder(originalList, card);
                refreshKanbanPageCounts();

                return;
            }

            const form = card.querySelector('[data-kanban-status-form]');
            const select = form?.querySelector('[data-status-autosave]');
            const feedback = form?.querySelector('[data-status-feedback]');

            if (!form || !select || !feedback) {
                insertCardInPageOrder(originalList, card);
                refreshKanbanPageCounts();

                return;
            }

            card.classList.add('kanban-card-saving');
            select.disabled = true;
            select.value = requestedStatus;
            feedback.textContent = '儲存中…';
            refreshKanbanPageCounts();

            try {
                const result = await persistStatus(form, requestedStatus);
                card.dataset.status = result.status;
                select.dataset.savedValue = result.status;
                insertCardInPageOrder(destinationList, card);
                updateStatusSummary(result.counts);
                feedback.textContent = '已儲存';
                announceKanban(result.message);
            } catch {
                card.dataset.status = originalStatus;
                select.value = originalStatus;
                insertCardInPageOrder(originalList, card);
                feedback.textContent = '儲存失敗，已移回原欄';
                announceKanban('狀態儲存失敗，卡片已移回原本的欄位。');
            } finally {
                card.classList.remove('kanban-card-saving');
                select.disabled = false;
                refreshKanbanPageCounts();
            }
        },
    });
});

function updateStatusSummary(counts) {
    if (!counts) {
        return;
    }

    document.querySelectorAll('[data-status-summary-item]').forEach((link) => {
        const count = counts[link.dataset.statusSummaryItem] ?? 0;

        link.textContent = `${link.dataset.label} ${count} 題`;
    });

    document.querySelectorAll('[data-kanban-total-count]').forEach((count) => {
        count.textContent = String(counts[count.dataset.kanbanTotalCount] ?? 0);
    });
}

document.addEventListener('click', (event) => {
    const projectLink = event.target.closest('[data-project-link], [data-project-switcher] a');
    if (projectLink) {
        projectLink.closest('details')?.removeAttribute('open');
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
            const href = projectLink.getAttribute('href');
            if (href && href !== '#' && !href.startsWith('javascript:')) {
                window.location.assign(href);
            }
        }

        return;
    }

    document.querySelectorAll('[data-project-switcher][open]').forEach((details) => {
        if (!details.contains(event.target)) {
            details.removeAttribute('open');
        }
    });
});


document.querySelectorAll('[data-category-quick]').forEach((select) => {
    const form = select.form;
    const feedback = form?.querySelector('[data-category-quick-feedback]');
    select.dataset.savedValue = select.value;

    select.addEventListener('change', async () => {
        const savedValue = select.dataset.savedValue;
        const body = new FormData(form);
        select.disabled = true;
        feedback.textContent = '儲存中…';

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                body,
                headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                const messages = {
                    401: '登入已過期，請重新登入後再試。',
                    403: '你沒有權限改這張單的分類。',
                    404: '找不到這張單，可能已被刪除。',
                    419: '頁面停留太久，請重新整理後再試。',
                    429: '操作太頻繁，請稍後再試。',
                };
                const detail = response.status === 422 ? Object.values(result.errors ?? {}).flat()[0] : null;
                throw new Error(detail ?? messages[response.status] ?? '分類儲存失敗，請重新整理後再試。');
            }
            document.querySelectorAll('[data-category-quick-form]').forEach((other) => {
                const otherSelect = other.querySelector('[data-category-quick]');
                if (other.action === form.action && otherSelect) {
                    otherSelect.value = result.category ?? '';
                    otherSelect.dataset.savedValue = result.category ?? '';
                }
            });
            feedback.textContent = '已儲存';
        } catch (error) {
            select.value = savedValue;
            feedback.textContent = /[\u4e00-\u9fff]/.test(error.message) ? error.message : '分類儲存失敗，請檢查網路後再試。';
        } finally {
            select.disabled = false;
        }
    });
});
