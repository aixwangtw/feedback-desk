import assert from 'node:assert/strict';
import { test } from 'node:test';

import { completionErrorMessage, detailDialogIdFor } from '../../resources/js/completion.js';
import { readMarkerSelector } from '../../resources/js/report-read.js';

test('確認留言視窗 id 對應到同一張單的詳情視窗', () => {
    assert.equal(detailDialogIdFor('request-completion-abc-123'), 'detail-report-abc-123');
});

test('錯誤訊息一律是中文，優先用伺服器說明', () => {
    assert.equal(completionErrorMessage(422, { errors: { body: ['留言內容不能超過 10000 字。'] } }), '留言內容不能超過 10000 字。');
    assert.equal(completionErrorMessage(422, { message: '這張單已經完成，不用再請老師確認。' }), '這張單已經完成，不用再請老師確認。');
    assert.equal(completionErrorMessage(403, { message: '只有開發團隊能請老師確認完成。' }), '只有開發團隊能請老師確認完成。');
    assert.equal(completionErrorMessage(403, {}), '這個操作你沒有權限。');
    assert.match(completionErrorMessage(419, {}), /過期/);
    assert.match(completionErrorMessage(429, {}), /太頻繁/);
    assert.equal(completionErrorMessage(500, null), '操作失敗，請稍後再試。');
});

test('讀過一張單時清掉清單上的未讀圓點、舊留言按鈕數字與重點已更新標籤', () => {
    globalThis.CSS = { escape: (value) => value };

    const selector = readMarkerSelector('r-1');

    assert.match(selector, /\[data-unread-slot="r-1"\] \[data-unread-dot\]/);
    assert.match(selector, /\[data-chat-open="r-1"\] \[data-unread-badge\]/);
    assert.match(selector, /\[data-adjustment-updated="r-1"\]/);
});
