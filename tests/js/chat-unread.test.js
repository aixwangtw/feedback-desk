import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    badgeText,
    countUnreadReports,
    unreadById,
    unreadSummary,
    withUnreadInLabel,
    withUnreadInTitle,
} from '../../resources/js/chat-unread.js';

const items = [
    { id: 'a', unread: 2 },
    { id: 'b', unread: 0 },
    { id: 'c', unread: 1 },
];

test('有未讀的單數只算未讀數大於 0 的單', () => {
    assert.equal(countUnreadReports(items), 2);
    assert.equal(countUnreadReports([]), 0);
});

test('正在看的那張未讀一律當 0，其餘照面板資料', () => {
    const map = unreadById(items, 'a');
    assert.equal(map.get('a'), 0);
    assert.equal(map.get('c'), 1);
    assert.equal(unreadById(items).get('a'), 2);
});

test('看完最後一張未讀後提示變成「目前沒有未讀留言」且不給篩選', () => {
    assert.deepEqual(unreadSummary(0), { count: 0, tone: 'calm', filter: null });
    assert.deepEqual(unreadSummary(3), { count: 3, tone: 'alert', filter: 'unread-only' });
});

test('只看未讀留言時一律只給「顯示全部」', () => {
    assert.equal(unreadSummary(0, { unreadOnly: true }).filter, 'show-all');
    assert.equal(unreadSummary(2, { unreadOnly: true }).filter, 'show-all');
});

test('紅色數字超過 99 顯示 99+', () => {
    assert.equal(badgeText(5), '5');
    assert.equal(badgeText(100), '99+');
});

test('按鈕說明文字跟著未讀數更新', () => {
    const label = '開啟「登入失敗」的留言對話（共 5 則留言，2 則未讀）';
    assert.equal(withUnreadInLabel(label, 0), '開啟「登入失敗」的留言對話（共 5 則留言）');
    assert.equal(withUnreadInLabel(label, 3), '開啟「登入失敗」的留言對話（共 5 則留言，3 則未讀）');
    assert.equal(withUnreadInLabel('開啟「x」的留言對話（共 1 則留言）', 1), '開啟「x」的留言對話（共 1 則留言，1 則未讀）');
    assert.equal(withUnreadInTitle('留言 5 則，未讀 2', 0), '留言 5 則');
    assert.equal(withUnreadInTitle('留言 5 則', 4), '留言 5 則，未讀 4');
});
