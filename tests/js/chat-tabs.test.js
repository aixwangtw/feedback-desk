import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_DISMISSED_KEY, filterByTab, rememberDismissed, shouldAutoOpen, tabCounts } from '../../resources/js/chat-tabs.js';

const items = [
    { id: 'a', awaiting_reply: true },
    { id: 'b', awaiting_reply: false },
    { id: 'c', awaiting_reply: true },
];

const memoryStorage = () => {
    const data = new Map();
    return {
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
    };
};

const brokenStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
};

test('未回覆頁籤只留對方最後發言的單，已回覆是其餘', () => {
    assert.deepEqual(filterByTab(items, 'awaiting').map((item) => item.id), ['a', 'c']);
    assert.deepEqual(filterByTab(items, 'replied').map((item) => item.id), ['b']);
});

test('頁籤數量', () => {
    assert.deepEqual(tabCounts(items), { awaiting: 2, replied: 1 });
    assert.deepEqual(tabCounts([]), { awaiting: 0, replied: 0 });
});

test('有未回覆就自動展開；沒有就不展開', () => {
    assert.equal(shouldAutoOpen(2, memoryStorage()), true);
    assert.equal(shouldAutoOpen(0, memoryStorage()), false);
});

test('手動收合後同一次瀏覽不再自動展開', () => {
    const storage = memoryStorage();
    rememberDismissed(storage);
    assert.equal(storage.getItem(CHAT_DISMISSED_KEY), '1');
    assert.equal(shouldAutoOpen(3, storage), false);
});

test('sessionStorage 不能用時照常自動展開、記錄失敗也不丟錯', () => {
    assert.equal(shouldAutoOpen(1, brokenStorage), true);
    assert.doesNotThrow(() => rememberDismissed(brokenStorage));
    assert.equal(shouldAutoOpen(1, null), true);
});

import { autoSelectTarget, visibleItems } from '../../resources/js/chat-tabs.js';

const titled = [
    { id: 'a', awaiting_reply: true, title: '登入壞了', number: 3 },
    { id: 'b', awaiting_reply: false, title: '報表', number: 2 },
    { id: 'c', awaiting_reply: true, title: '登出', number: 1 },
];

test('visibleItems 依頁籤與搜尋（標題或編號）篩選', () => {
    assert.deepEqual(visibleItems(titled, 'awaiting').map((i) => i.id), ['a', 'c']);
    assert.deepEqual(visibleItems(titled, 'awaiting', '登出').map((i) => i.id), ['c']);
    assert.deepEqual(visibleItems(titled, 'awaiting', '#3').map((i) => i.id), ['a']);
    assert.deepEqual(visibleItems(titled, 'replied', '登').map((i) => i.id), []);
});

test('面板打開、還沒選任何一張：自動選目前頁籤的第一張', () => {
    assert.deepEqual(autoSelectTarget(visibleItems(titled, 'awaiting'), {}), { action: 'open', id: 'a' });
});

test('清單是空的：顯示空狀態', () => {
    assert.deepEqual(autoSelectTarget([], { currentId: 'a', viewing: true, force: true }), { action: 'empty' });
});

test('已經在看某張對話時，背景刷新不改選；切頁籤或搜尋（force）才改選第一張', () => {
    const items = visibleItems(titled, 'awaiting');
    assert.deepEqual(autoSelectTarget(items, { currentId: 'c', viewing: true }), { action: 'keep' });
    assert.deepEqual(autoSelectTarget(items, { currentId: 'c', viewing: true, force: true }), { action: 'open', id: 'a' });
    assert.deepEqual(autoSelectTarget(items, { currentId: 'a', viewing: true, force: true }), { action: 'keep' });
});

test('對話區目前是空的（viewing=false）時，一律選第一張', () => {
    assert.deepEqual(autoSelectTarget(visibleItems(titled, 'replied'), { currentId: 'a', viewing: false }), { action: 'open', id: 'b' });
});
