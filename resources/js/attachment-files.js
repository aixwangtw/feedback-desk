// 留言附件（圖片、mp4 影片）的檔案檢查與待送出清單邏輯。純函式，不碰 DOM；
// 規則（數字與文字）由伺服器 FeedbackAttachmentRules::browserRules() 經 data-attachment-rules 帶進來，這裡不寫死。
// DOM 與拖曳在 attachment-composer.js。

const EXTENSION_TYPES = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
};

const megabytes = (bytes) => Math.floor(bytes / 1024 / 1024);

/** 瀏覽器有給 MIME 就用；沒給（部分系統拖進來的檔案）才看副檔名。application/mp4 與 video/mp4 是同一種檔案。 */
export const fileMimeType = (file) => {
    if (file.type) {
        return file.type === 'application/mp4' ? 'video/mp4' : file.type;
    }
    const extension = String(file.name ?? '').split('.').pop().toLowerCase();

    return EXTENSION_TYPES[extension] ?? '';
};

/** 'image'、'video'，不收的格式回 null（影片在只收圖片的地方也回 null）。 */
export const attachmentKind = (file, rules) => {
    const mime = fileMimeType(file);
    if (rules.imageTypes.includes(mime)) {
        return 'image';
    }

    return rules.allowVideo && rules.videoTypes.includes(mime) ? 'video' : null;
};

/** 單一檔案的問題說明（中文）；沒問題回 null。 */
export const fileProblem = (file, rules) => {
    const kind = attachmentKind(file, rules);
    if (kind === null) {
        return `${file.name}：${rules.typeMessage}。`;
    }
    if (kind === 'video' && file.size > rules.maxVideoBytes) {
        return `${file.name}：每支影片不可超過 ${megabytes(rules.maxVideoBytes)} MB。`;
    }
    if (kind === 'image' && file.size > rules.maxImageBytes) {
        return `${file.name}：每張圖片不可超過 ${megabytes(rules.maxImageBytes)} MB。`;
    }

    return null;
};

/** 附件的一行短標題：檔名去掉副檔名（與伺服器 FeedbackAttachmentRules::displayTitle 一致）；顯示端用 CSS 截斷、title 放完整檔名。 */
export const attachmentTitle = (name) => {
    const title = String(name ?? '').replace(/\.[A-Za-z0-9]{1,5}$/u, '');

    return title === '' ? String(name ?? '') : title;
};

export const fileKey = (file) => `${file.name}|${file.size}|${file.lastModified}`;

/**
 * 把新選或拖進來的檔案加進待送出清單。
 * 不合格的不加入並回報原因；同一個檔案重複給不會加兩次；超過每則上限的多出幾個不加入。
 *
 * @returns {{ files: File[], added: File[], messages: string[] }}
 */
export const addAttachments = (current, incoming, rules) => {
    const files = [...current];
    const added = [];
    const messages = [];
    const seen = new Set(files.map(fileKey));
    let overLimit = 0;

    Array.from(incoming).forEach((file) => {
        const problem = fileProblem(file, rules);
        if (problem !== null) {
            messages.push(problem);

            return;
        }
        if (seen.has(fileKey(file))) {
            return;
        }
        if (files.length >= rules.maxFiles) {
            overLimit += 1;

            return;
        }
        seen.add(fileKey(file));
        files.push(file);
        added.push(file);
    });

    if (overLimit > 0) {
        messages.push(`${rules.fieldName}每則最多 ${rules.maxFiles} 個，多出的 ${overLimit} 個沒有加入。`);
    }

    return { files, added, messages };
};

export const removeAttachmentAt = (files, index) => files.filter((_, position) => position !== index);

/** 預覽清單：每個待送出檔案一筆（圖片縮圖、影片可播放），index 給「移除」用。 */
export const attachmentPreviewItems = (files, rules) => files.map((file, index) => ({
    key: fileKey(file),
    kind: attachmentKind(file, rules) ?? 'image',
    name: file.name,
    index,
}));

/** 拖曳的內容是檔案（而不是選取的文字、連結）才處理。 */
export const dragHasFiles = (dataTransfer) => Array.from(dataTransfer?.types ?? []).includes('Files');

/** 放置提示文字。 */
export const dropHintText = (rules) => (rules.allowVideo ? '放開即可加入圖片或影片' : '放開即可加入圖片');

export const parseAttachmentRules = (json) => {
    try {
        const rules = JSON.parse(json);

        return rules && Array.isArray(rules.imageTypes) && Array.isArray(rules.videoTypes) && rules.maxFiles > 0 ? rules : null;
    } catch {
        return null;
    }
};
