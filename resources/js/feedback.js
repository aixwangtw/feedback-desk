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
