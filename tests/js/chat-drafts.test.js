import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftFormFields, draftMeta, nextDraftIndex, shouldFillComposer } from '../../resources/js/chat-drafts.js';

test('輸入框空白、或還是上次帶入的草稿原文時才帶入；使用者改過就不覆蓋', () => {
    assert.equal(shouldFillComposer('', null), true);
    assert.equal(shouldFillComposer('   ', '舊草稿'), true);
    assert.equal(shouldFillComposer('舊草稿', '舊草稿'), true);
    assert.equal(shouldFillComposer('我改過了', '舊草稿'), false);
});

test('多則草稿輪流切換', () => {
    assert.equal(nextDraftIndex(0, 3), 1);
    assert.equal(nextDraftIndex(2, 3), 0);
    assert.equal(nextDraftIndex(5, 0), 0);
});

test('草稿說明列：作者、第幾則、附圖數', () => {
    assert.equal(draftMeta({ author: 'Alex（Claude Code）', attachments_count: 0 }, 0, 1), 'Alex（Claude Code）寫的');
    assert.equal(draftMeta({ author: 'Alex', attachments_count: 2 }, 1, 3), 'Alex寫的・第 2／3 則・附圖 2 張會一起送出');
});

test('送出草稿只帶 CSRF token 與輸入框文字，不帶面板的附圖', () => {
    assert.deepEqual(draftFormFields('tok', '  改過的文字  '), [['_token', 'tok'], ['body', '  改過的文字  ']]);
});
