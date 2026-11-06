import { describe, expect, it } from 'vitest';
import {
    addAttachments,
    attachmentKind,
    attachmentPreviewItems,
    attachmentTitle,
    dragHasFiles,
    dropHintText,
    fileMimeType,
    removeAttachmentAt,
    singleFileProblem,
} from '../../src/shared/attachment-list';
import { ATTACHMENT_TYPE_ERROR, MAX_FILES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, imageTooLarge, VIDEO_TOO_LARGE } from '../../src/shared/attachment-rules';

const options = { maxFiles: MAX_FILES, maxImageBytes: MAX_IMAGE_BYTES, allowVideo: true };
const imagesOnly = { maxFiles: 3, maxImageBytes: 5 * 1024 * 1024, allowVideo: false };
let counter = 0;
const file = (name: string, type: string, size = 1000) => ({ name, type, size, lastModified: ++counter });

describe('留言附件清單（拖曳與按鈕共用）', () => {
    it('MIME 優先，沒有才看副檔名', () => {
        expect(fileMimeType(file('a.png', 'image/png'))).toBe('image/png');
        expect(fileMimeType(file('a.MP4', ''))).toBe('video/mp4');
        expect(fileMimeType(file('a.pdf', ''))).toBe('');
    });

    it('圖片、影片分類；只收圖片的地方影片不收', () => {
        expect(attachmentKind(file('a.jpg', 'image/jpeg'), options)).toBe('image');
        expect(attachmentKind(file('a.mp4', 'video/mp4'), options)).toBe('video');
        expect(attachmentKind(file('a.mp4', 'video/mp4'), imagesOnly)).toBeNull();
        expect(attachmentKind(file('a.gif', 'image/gif'), options)).toBeNull();
    });

    it('不符合的格式與大小顯示中文，文字與數字都讀共用常數', () => {
        expect(singleFileProblem(file('x.pdf', 'application/pdf'), options)).toBe(`x.pdf：${ATTACHMENT_TYPE_ERROR}`);
        expect(singleFileProblem(file('a.png', 'image/png', MAX_IMAGE_BYTES), options)).toBeNull();
        expect(singleFileProblem(file('a.png', 'image/png', MAX_IMAGE_BYTES + 1), options)).toContain(imageTooLarge(MAX_IMAGE_BYTES));
        expect(singleFileProblem(file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES), options)).toBeNull();
        expect(singleFileProblem(file('a.mp4', 'video/mp4', MAX_VIDEO_BYTES + 1), options)).toContain(VIDEO_TOO_LARGE);
        expect(singleFileProblem(file('a.mp4', 'video/mp4'), imagesOnly)).toContain('只接受 JPG、PNG、WebP');
    });

    it('合格的進清單、不合格的不加並回報、順序不變', () => {
        const png = file('a.png', 'image/png');
        const bad = file('x.pdf', 'application/pdf');
        const mp4 = file('b.mp4', 'video/mp4');
        const result = addAttachments([], [png, bad, mp4], options);
        expect(result.files).toEqual([png, mp4]);
        expect(result.added).toEqual([png, mp4]);
        expect(result.messages).toEqual([`x.pdf：${ATTACHMENT_TYPE_ERROR}`]);
    });

    it('接在既有清單後面，同一個檔案不重複', () => {
        const first = file('a.png', 'image/png');
        const second = file('b.png', 'image/png');
        const step1 = addAttachments([], [first], options);
        const step2 = addAttachments(step1.files, [first, second], options);
        expect(step2.files).toEqual([first, second]);
        expect(step2.added).toEqual([second]);
        expect(step2.messages).toEqual([]);
    });

    it('每則最多 5 個，多出的不加入並說明；不合格的不佔名額', () => {
        const six = Array.from({ length: 6 }, (_, i) => file(`p${i}.png`, 'image/png'));
        const result = addAttachments([], six, options);
        expect(result.files).toHaveLength(MAX_FILES);
        expect(result.messages).toEqual([`附件每則最多 ${MAX_FILES} 個，多出的 1 個沒有加入。`]);
        const four = Array.from({ length: 4 }, (_, i) => file(`q${i}.png`, 'image/png'));
        const mixed = addAttachments(four, [file('x.gif', 'image/gif'), file('ok.png', 'image/png')], options);
        expect(mixed.files).toHaveLength(5);
        expect(mixed.messages).toHaveLength(1);
    });

    it('移除只拿掉指定那一個；預覽清單圖片縮圖、影片可播', () => {
        const a = file('a.png', 'image/png');
        const b = file('b.mp4', 'video/mp4');
        const c = file('c.webp', 'image/webp');
        expect(removeAttachmentAt([a, b, c], 1)).toEqual([a, c]);
        expect(removeAttachmentAt([a], 5)).toEqual([a]);
        expect(attachmentPreviewItems([a, b], options).map(({ kind, name, index }) => ({ kind, name, index }))).toEqual([
            { kind: 'image', name: 'a.png', index: 0 },
            { kind: 'video', name: 'b.mp4', index: 1 },
        ]);
    });

    it('附件短標題去掉副檔名', () => {
        expect(attachmentTitle('圖一-缺圖十七十九的位置.png')).toBe('圖一-缺圖十七十九的位置');
        expect(attachmentTitle('影片-操作.MP4')).toBe('影片-操作');
        expect(attachmentTitle('無副檔名')).toBe('無副檔名');
        expect(attachmentTitle('.png')).toBe('.png');
    });

    it('只處理拖進來的檔案；放置提示依是否收影片', () => {
        expect(dragHasFiles({ types: ['Files'] })).toBe(true);
        expect(dragHasFiles({ types: ['text/plain'] })).toBe(false);
        expect(dragHasFiles(null)).toBe(false);
        expect(dropHintText(options)).toBe('放開即可加入圖片或影片');
        expect(dropHintText(imagesOnly)).toBe('放開即可加入圖片');
    });
});
