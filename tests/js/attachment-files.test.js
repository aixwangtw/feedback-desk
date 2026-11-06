import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addAttachments,
    attachmentKind,
    attachmentTitle,
    attachmentPreviewItems,
    dragHasFiles,
    dropHintText,
    fileMimeType,
    fileProblem,
    parseAttachmentRules,
    removeAttachmentAt,
} from '../../resources/js/attachment-files.js';

const MB = 1024 * 1024;
const rules = {
    allowVideo: true,
    maxFiles: 5,
    maxImageBytes: 10 * MB,
    maxVideoBytes: 50 * MB,
    imageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    videoTypes: ['video/mp4'],
    fieldName: '圖片／影片',
    typeMessage: '只能附 jpg、png、webp 圖片或 mp4 影片',
};
const imagesOnly = { ...rules, allowVideo: false, maxFiles: 3, maxImageBytes: 5 * MB, fieldName: '截圖', typeMessage: '只能附 jpg、png、webp 圖片' };

let counter = 0;
const file = (name, type, size = 1000) => ({ name, type, size, lastModified: ++counter });

test('MIME 優先、沒有 MIME 才看副檔名；application/mp4 當成影片', () => {
    assert.equal(fileMimeType(file('a.png', 'image/png')), 'image/png');
    assert.equal(fileMimeType(file('a.MP4', '')), 'video/mp4');
    assert.equal(fileMimeType(file('a.mp4', 'application/mp4')), 'video/mp4');
    assert.equal(fileMimeType(file('a.pdf', '')), '');
});

test('圖片與影片分類；只收圖片的地方影片不收', () => {
    assert.equal(attachmentKind(file('a.jpg', 'image/jpeg'), rules), 'image');
    assert.equal(attachmentKind(file('a.mp4', 'video/mp4'), rules), 'video');
    assert.equal(attachmentKind(file('a.mp4', 'video/mp4'), imagesOnly), null);
    assert.equal(attachmentKind(file('a.gif', 'image/gif'), rules), null);
});

test('不符合的格式顯示中文錯誤，文字來自規則', () => {
    assert.equal(fileProblem(file('doc.pdf', 'application/pdf'), rules), 'doc.pdf：只能附 jpg、png、webp 圖片或 mp4 影片。');
    assert.equal(fileProblem(file('v.mp4', 'video/mp4'), imagesOnly), 'v.mp4：只能附 jpg、png、webp 圖片。');
});

test('大小上限讀規則：圖片 10 MB、影片 50 MB，剛好等於上限可以', () => {
    assert.equal(fileProblem(file('a.png', 'image/png', 10 * MB), rules), null);
    assert.equal(fileProblem(file('a.png', 'image/png', 10 * MB + 1), rules), 'a.png：每張圖片不可超過 10 MB。');
    assert.equal(fileProblem(file('a.mp4', 'video/mp4', 50 * MB), rules), null);
    assert.equal(fileProblem(file('a.mp4', 'video/mp4', 50 * MB + 1), rules), 'a.mp4：每支影片不可超過 50 MB。');
    assert.equal(fileProblem(file('b.png', 'image/png', 5 * MB + 1), imagesOnly), 'b.png：每張圖片不可超過 5 MB。');
});

test('加入：合格的進清單，不合格的不加並回報；順序保持', () => {
    const png = file('a.png', 'image/png');
    const bad = file('x.pdf', 'application/pdf');
    const mp4 = file('b.mp4', 'video/mp4');
    const result = addAttachments([], [png, bad, mp4], rules);
    assert.deepEqual(result.files, [png, mp4]);
    assert.deepEqual(result.added, [png, mp4]);
    assert.deepEqual(result.messages, ['x.pdf：只能附 jpg、png、webp 圖片或 mp4 影片。']);
});

test('按鈕選檔與拖曳走同一個函式：接在既有清單後面，同一個檔案不重複', () => {
    const first = file('a.png', 'image/png');
    const second = file('b.png', 'image/png');
    const step1 = addAttachments([], [first], rules);
    const step2 = addAttachments(step1.files, [first, second], rules);
    assert.deepEqual(step2.files, [first, second]);
    assert.deepEqual(step2.added, [second]);
    assert.deepEqual(step2.messages, []);
});

test('每則最多 5 個：多出的不加入並說明', () => {
    const six = Array.from({ length: 6 }, (_, i) => file(`p${i}.png`, 'image/png'));
    const result = addAttachments([], six, rules);
    assert.equal(result.files.length, 5);
    assert.deepEqual(result.messages, ['圖片／影片每則最多 5 個，多出的 1 個沒有加入。']);
    const more = addAttachments(result.files, [file('z.png', 'image/png')], rules);
    assert.equal(more.files.length, 5);
    assert.equal(more.added.length, 0);
});

test('不合格的檔案不佔名額', () => {
    const current = Array.from({ length: 4 }, (_, i) => file(`p${i}.png`, 'image/png'));
    const result = addAttachments(current, [file('x.gif', 'image/gif'), file('ok.png', 'image/png')], rules);
    assert.equal(result.files.length, 5);
    assert.equal(result.messages.length, 1);
});

test('移除只拿掉指定那一個', () => {
    const a = file('a.png', 'image/png');
    const b = file('b.mp4', 'video/mp4');
    const c = file('c.webp', 'image/webp');
    assert.deepEqual(removeAttachmentAt([a, b, c], 1), [a, c]);
    assert.deepEqual(removeAttachmentAt([a], 5), [a]);
    assert.deepEqual(removeAttachmentAt([a], 0), []);
});

test('預覽清單：圖片縮圖、影片可播，各自帶移除用的位置', () => {
    const a = file('a.png', 'image/png');
    const b = file('b.mp4', 'video/mp4');
    assert.deepEqual(
        attachmentPreviewItems([a, b], rules).map(({ kind, name, index }) => ({ kind, name, index })),
        [{ kind: 'image', name: 'a.png', index: 0 }, { kind: 'video', name: 'b.mp4', index: 1 }],
    );
    assert.deepEqual(attachmentPreviewItems([], rules), []);
});

test('只處理拖進來的檔案，選取的文字或連結不處理', () => {
    assert.equal(dragHasFiles({ types: ['Files'] }), true);
    assert.equal(dragHasFiles({ types: ['text/plain'] }), false);
    assert.equal(dragHasFiles(null), false);
});

test('放置提示與規則解析', () => {
    assert.equal(dropHintText(rules), '放開即可加入圖片或影片');
    assert.equal(dropHintText(imagesOnly), '放開即可加入圖片');
    assert.deepEqual(parseAttachmentRules(JSON.stringify(rules)), rules);
    assert.equal(parseAttachmentRules('not json'), null);
    assert.equal(parseAttachmentRules('{}'), null);
});

test('附件短標題：去掉副檔名，沒有副檔名或只有副檔名就照原名', () => {
    assert.equal(attachmentTitle('圖一-缺圖十七十九的位置.png'), '圖一-缺圖十七十九的位置');
    assert.equal(attachmentTitle('影片-操作.MP4'), '影片-操作');
    assert.equal(attachmentTitle('a.b.webp'), 'a.b');
    assert.equal(attachmentTitle('無副檔名'), '無副檔名');
    assert.equal(attachmentTitle('.png'), '.png');
});
