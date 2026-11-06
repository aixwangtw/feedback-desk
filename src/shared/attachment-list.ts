/**
 * 留言待送出附件清單的邏輯（對話面板、詳情視窗、單頁留言區共用）：按「附件」選檔與拖進輸入區走同一套。
 * 純函式，不碰 DOM；檔案檢查的規則與文字來自 attachment-rules.ts，這裡不寫死數字。DOM 在 client/attachment-composer.js。
 */
import { IMAGE_MIME_TYPES, VIDEO_MIME_TYPES, fileProblem as filesProblem } from './attachment-rules';

export interface AttachmentFile {
    name: string;
    type: string;
    size: number;
    lastModified?: number;
}

export interface AttachmentOptions {
    maxFiles: number;
    maxImageBytes: number;
    allowVideo: boolean;
}

const EXTENSION_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4' };

/** MIME 優先；瀏覽器沒給（部分系統拖進來的檔案）才看副檔名。 */
export function fileMimeType(file: AttachmentFile): string {
    if (file.type) {
        return file.type;
    }
    return EXTENSION_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? '';
}

/** 'image'、'video'；不收的格式（影片在只收圖片的地方也算）回 null。 */
export function attachmentKind(file: AttachmentFile, options: AttachmentOptions): 'image' | 'video' | null {
    const mime = fileMimeType(file);
    if ((IMAGE_MIME_TYPES as readonly string[]).includes(mime)) {
        return 'image';
    }
    return options.allowVideo && (VIDEO_MIME_TYPES as readonly string[]).includes(mime) ? 'video' : null;
}

/** 附件的一行短標題：檔名去掉副檔名（「圖一-缺圖的位置.png」顯示成「圖一-缺圖的位置」）；顯示端用 CSS 截斷、title 放完整檔名。 */
export function attachmentTitle(name: string): string {
    const title = name.replace(/\.[A-Za-z0-9]{1,5}$/u, '');
    return title === '' ? name : title;
}

export function fileKey(file: AttachmentFile): string {
    return `${file.name}|${file.size}|${file.lastModified ?? 0}`;
}

/** 單一檔案的問題說明（中文），沒問題回 null；訊息文字用 attachment-rules.ts 的同一份。 */
export function singleFileProblem(file: AttachmentFile, options: AttachmentOptions): string | null {
    const problem = filesProblem([{ name: file.name, type: fileMimeType(file), size: file.size }], { ...options, maxFiles: 1 });
    return problem === null ? null : `${file.name}：${problem}`;
}

/**
 * 把新選或拖進來的檔案加進待送出清單：不合格的不加入並回報原因；同一個檔案不會加兩次；超過每則上限的多出幾個不加入。
 */
export function addAttachments<T extends AttachmentFile>(current: T[], incoming: T[], options: AttachmentOptions): { files: T[]; added: T[]; messages: string[] } {
    const files = [...current];
    const added: T[] = [];
    const messages: string[] = [];
    const seen = new Set(files.map(fileKey));
    let overLimit = 0;
    for (const file of incoming) {
        const problem = singleFileProblem(file, options);
        if (problem !== null) {
            messages.push(problem);
            continue;
        }
        if (seen.has(fileKey(file))) {
            continue;
        }
        if (files.length >= options.maxFiles) {
            overLimit += 1;
            continue;
        }
        seen.add(fileKey(file));
        files.push(file);
        added.push(file);
    }
    if (overLimit > 0) {
        messages.push(`${options.allowVideo ? '附件' : '附圖'}每則最多 ${options.maxFiles} 個，多出的 ${overLimit} 個沒有加入。`);
    }
    return { files, added, messages };
}

export function removeAttachmentAt<T>(files: T[], index: number): T[] {
    return files.filter((_, position) => position !== index);
}

/** 預覽清單：每個待送出檔案一筆（圖片縮圖、影片可播放），index 給「移除」用。 */
export function attachmentPreviewItems(files: AttachmentFile[], options: AttachmentOptions): Array<{ key: string; kind: 'image' | 'video'; name: string; index: number }> {
    return files.map((file, index) => ({ key: fileKey(file), kind: attachmentKind(file, options) ?? 'image', name: file.name, index }));
}

/** 拖曳的內容是檔案（而不是選取的文字、連結）才處理。 */
export function dragHasFiles(dataTransfer: { types?: readonly string[] | null } | null | undefined): boolean {
    return Array.from(dataTransfer?.types ?? []).includes('Files');
}

export function dropHintText(options: Pick<AttachmentOptions, 'allowVideo'>): string {
    return options.allowVideo ? '放開即可加入圖片或影片' : '放開即可加入圖片';
}
