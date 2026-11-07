import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openKeys, replaceKeepingOpen, restoreOpenKeys } from '../../resources/js/thread-details.js';

/** 假的 root：detailsList 是目前畫面上的 <details data-keep-open>。 */
const makeRoot = (initial) => {
    const root = {
        details: initial,
        querySelectorAll: () => root.details,
    };

    return root;
};
const details = (key, open) => ({ dataset: { keepOpen: key }, open });

test('只記下展開中的 details', () => {
    const root = makeRoot([details('album', true), details('past-notes', false)]);

    assert.deepEqual([...openKeys(root)], ['album']);
});

test('換新後依鍵重新展開，沒展開的維持收合', () => {
    const root = makeRoot([details('album', false), details('past-notes', false)]);

    restoreOpenKeys(root, new Set(['album']));

    assert.deepEqual(root.details.map((item) => item.open), [true, false]);
});

test('整段換新時，使用者展開的相簿維持展開', () => {
    const root = makeRoot([details('album', true), details('past-notes', false)]);

    replaceKeepingOpen(root, () => {
        root.details = [details('album', false), details('past-notes', false)];
    });

    assert.deepEqual(root.details.map((item) => item.open), [true, false]);
});

test('使用者收合的相簿換新後維持收合', () => {
    const root = makeRoot([details('album', false)]);

    replaceKeepingOpen(root, () => {
        root.details = [details('album', false)];
    });

    assert.equal(root.details[0].open, false);
});

test('有展開中的留言編輯表單才算編輯中，定時刷新不能換掉內容', async () => {
    const { isEditingMessage } = await import('../../resources/js/thread-details.js');
    const root = (found) => ({ querySelector: (selector) => (selector === '[data-message-edit-form]:not([hidden])' && found ? {} : null) });

    assert.equal(isEditingMessage(root(true)), true);
    assert.equal(isEditingMessage(root(false)), false);
    assert.equal(isEditingMessage(null), false);
});
