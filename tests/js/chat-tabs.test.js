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
