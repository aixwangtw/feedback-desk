import Sortable from 'sortablejs';

const renderImagePreviews = (input) => {
    const targetId = input.dataset.previewTarget;
    const target = targetId ? document.getElementById(targetId) : null;

    if (!target) {
        return;
    }

    target.replaceChildren();

    Array.from(input.files).slice(0, 5).forEach((file) => {
        const figure = document.createElement('figure');
        const image = document.createElement('img');
        const caption = document.createElement('figcaption');
        const objectUrl = URL.createObjectURL(file);

        figure.className = 'min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white';
        image.className = 'aspect-video w-full object-cover';
        image.alt = '';
        image.src = objectUrl;
        image.addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
        caption.className = 'truncate px-2 py-1.5 text-[11px] text-slate-600';
        caption.textContent = file.name;
        figure.append(image, caption);
        target.append(figure);
    });
};

document.addEventListener('change', (event) => {
    if (event.target.matches('[data-image-input]')) {
        renderImagePreviews(event.target);
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
    let done = 0;
    form.dataset.uploadState = 'busy';
    form.querySelectorAll('input[data-upload-id]').forEach((hidden) => hidden.remove());
    if (submit) {
        submit.disabled = true;
        submit.textContent = `上傳截圖中 0/${total}…`;
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
                    submit.textContent = `上傳截圖中 ${done}/${total}…`;
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

const imageLightbox = document.querySelector('[data-image-lightbox]');
if (imageLightbox) {
    const image = imageLightbox.querySelector('[data-lightbox-image]');
    const title = imageLightbox.querySelector('[data-lightbox-title]');
    const scaleOutput = imageLightbox.querySelector('[data-lightbox-scale]');
    const openOriginal = imageLightbox.querySelector('[data-lightbox-original]');
    const stage = imageLightbox.querySelector('[data-lightbox-stage]');
    let activeTrigger = null;
    let scale = 1;

    const applyScale = () => {
        image.style.transform = `scale(${scale})`;
        scaleOutput.value = `${Math.round(scale * 100)}%`;
        stage.scrollTo({ left: 0, top: 0 });
    };

    const changeScale = (amount) => {
        scale = Math.min(3, Math.max(0.5, scale + amount));
        applyScale();
    };

    const closeLightbox = () => imageLightbox.close();

    document.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-lightbox-trigger]');
        if (!trigger || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
            return;
        }

        event.preventDefault();
        activeTrigger = trigger;
        scale = 1;
        image.src = trigger.href;
        image.alt = trigger.dataset.lightboxAlt || '截圖預覽';
        title.textContent = image.alt;
        openOriginal.href = trigger.href;
        applyScale();
        imageLightbox.showModal();
        document.body.classList.add('overflow-hidden');
        imageLightbox.querySelector('[data-lightbox-close]').focus();
    });

    imageLightbox.querySelector('[data-lightbox-zoom-out]').addEventListener('click', () => changeScale(-0.25));
    imageLightbox.querySelector('[data-lightbox-zoom-in]').addEventListener('click', () => changeScale(0.25));
    imageLightbox.querySelector('[data-lightbox-reset]').addEventListener('click', () => {
        scale = 1;
        applyScale();
    });
    imageLightbox.querySelector('[data-lightbox-close]').addEventListener('click', closeLightbox);
    imageLightbox.addEventListener('click', (event) => {
        if (event.target === imageLightbox) {
            closeLightbox();
        }
    });
    imageLightbox.addEventListener('close', () => {
        document.body.classList.remove('overflow-hidden');
        image.removeAttribute('src');
        activeTrigger?.focus();
        activeTrigger = null;
    });
    imageLightbox.addEventListener('keydown', (event) => {
        if (event.key === '+' || event.key === '=') {
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

const activity = document.querySelector('[data-activity]');
if (activity) {
    const refresh = async () => {
        if (document.hidden) {
            return;
        }

        try {
            const response = await fetch(activity.dataset.refreshUrl, {
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
            });

            if (response.ok) {
                activity.innerHTML = await response.text();
            }
        } catch {
            // A temporary polling failure should not interrupt the conversation form.
        }
    };

    window.setInterval(refresh, 5000);
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

document.addEventListener('click', async (event) => {
    const opener = event.target.closest('[data-dialog-open]');
    if (opener) {
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
        dialog?.showModal();

        return;
    }

    event.target.closest('[data-dialog-close]')?.closest('dialog')?.close();
});

document.addEventListener('click', (event) => {
    if (event.target instanceof HTMLDialogElement) {
        event.target.close();
    }
});

document.querySelectorAll('dialog[data-open-on-load]').forEach((dialog) => dialog.showModal());

const persistStatus = async (form, status) => {
    const body = new URLSearchParams(new FormData(form));
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

document.querySelectorAll('[data-kanban-list]').forEach((list) => {
    Sortable.create(list, {
        group: 'feedback-kanban',
        sort: false,
        animation: 160,
        draggable: '[data-kanban-card]',
        filter: 'a, form, input, select, textarea, [data-card-action]',
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
