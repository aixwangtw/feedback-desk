import assert from 'node:assert/strict';
import { test } from 'node:test';

import { captionText, parseGallery, stepIndex } from '../../resources/js/attachment-lightbox.js';
import { confirmOptions } from '../../resources/js/confirm-dialog.js';

test('上一張、下一張頭尾相接', () => {
    assert.equal(stepIndex(0, -1, 4), 3);
    assert.equal(stepIndex(3, 1, 4), 0);
    assert.equal(stepIndex(1, 1, 4), 2);
    assert.equal(stepIndex(0, 1, 0), 0);
});

test('縮圖格的附件清單解析，壞資料回空清單', () => {
    const list = parseGallery('[{"url":"/a.png","name":"a.png","video":false,"source":"原始附件","at":"2026/11/07 10:00"},{"name":"沒網址"}]');
    assert.equal(list.length, 1);
    assert.equal(list[0].source, '原始附件');
    assert.deepEqual(parseGallery('不是 json'), []);
    assert.deepEqual(parseGallery(undefined), []);
});

test('說明文字：名稱、來自哪則留言、時間', () => {
    assert.deepEqual(captionText({ name: 'a.png', video: false, source: '王小明 的留言', at: '2026/11/07 10:00' }), { name: 'a.png', meta: '來自：王小明 的留言　2026/11/07 10:00' });
    assert.equal(captionText({ name: '', video: true, source: '', at: '' }).name, '影片');
});

test('確認視窗內容來自表單屬性，沒寫的用預設', () => {
    assert.deepEqual(confirmOptions({ confirmTitle: '確定？', confirmMessage: '「A」會消失', confirmLabel: '確認刪除', confirmTone: 'danger' }), { title: '確定？', message: '「A」會消失', label: '確認刪除', tone: 'danger' });
    assert.equal(confirmOptions({}).label, '確認');
});
