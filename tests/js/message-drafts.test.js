import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftRequestError, draftsSignature } from '../../resources/js/message-drafts.js';

test('草稿操作失敗的中文說明：驗證訊息優先，其餘依狀態碼', () => {
    assert.equal(draftRequestError(422, { errors: { body: ['請輸入留言內容。'] } }), '請輸入留言內容。');
    assert.equal(draftRequestError(422, {}), '內容有誤，請修改後再試。');
    assert.equal(draftRequestError(404, {}), '這則待審留言已經送出或被捨棄，請重新整理。');
    assert.equal(draftRequestError(419, {}), '頁面停留太久已過期，請重新整理頁面後再試。');
    assert.equal(draftRequestError(403, {}), '只有開發團隊能處理待審留言。');
    assert.equal(draftRequestError(500, null), '操作失敗，請稍後再試。');
});

test('草稿區比對時忽略「幾分鐘前」', () => {
    const a = '<div><time datetime="x">3 分鐘前</time><p>內文</p></div>';
    const b = '<div><time datetime="x">4 分鐘前</time><p>內文</p></div>';
    const c = '<div><time datetime="x">4 分鐘前</time><p>改過</p></div>';
    assert.equal(draftsSignature(a), draftsSignature(b));
    assert.notEqual(draftsSignature(a), draftsSignature(c));
});
