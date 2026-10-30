import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareConversations, orderConversations } from '../../resources/js/chat-order.js';

const item = (id, { unread = 0, messages = 0, latest = null, created, number }) => ({
    id,
    unread,
    messages_count: messages,
    latest_at: latest,
    created_at: created,
    number,
});

const ids = (items) => items.map((entry) => entry.id);

const fixtures = () => [
    item('empty-new', { created: '2026-10-19T09:00:00+00:00', number: 6 }),
    item('read-old', { messages: 2, latest: '2026-10-10T08:00:00+00:00', created: '2026-10-01T00:00:00+00:00', number: 1 }),
    item('unread-old', { unread: 1, messages: 1, latest: '2026-10-12T08:00:00+00:00', created: '2026-10-02T00:00:00+00:00', number: 2 }),
    item('empty-old', { created: '2026-10-05T00:00:00+00:00', number: 3 }),
    item('read-new', { messages: 1, latest: '2026-10-18T08:00:00+00:00', created: '2026-10-03T00:00:00+00:00', number: 4 }),
    item('unread-new', { unread: 3, messages: 4, latest: '2026-10-18T09:00:00+00:00', created: '2026-10-04T00:00:00+00:00', number: 5 }),
];

test('未讀最前、其次有留言已讀、最後沒有留言，各段依時間新到舊', () => {
    assert.deepEqual(ids(orderConversations(fixtures())), [
        'unread-new', 'unread-old', 'read-new', 'read-old', 'empty-new', 'empty-old',
    ]);
});

test('剛建立的沒留言單不會排到有留言的單前面', () => {
    const fresh = item('fresh', { created: '2026-10-19T12:00:00+00:00', number: 9 });
    const oldThread = item('old-thread', { messages: 1, latest: '2026-01-01T00:00:00+00:00', created: '2026-01-01T00:00:00+00:00', number: 1 });
    assert.ok(compareConversations(oldThread, fresh) < 0);
});

test('只有調整重點更新（沒有留言但未讀）也排在最前', () => {
    const adjustmentOnly = item('adjustment', { unread: 1, created: '2026-09-01T00:00:00+00:00', number: 7 });
    assert.equal(orderConversations([...fixtures(), adjustmentOnly])[2].id, 'adjustment');
});

test('同時間依編號新到舊（編號最新為 1）', () => {
    const newer = item('newer', { created: '2026-10-01T00:00:00+00:00', number: 1 });
    const older = item('older', { created: '2026-10-01T00:00:00+00:00', number: 2 });
    assert.deepEqual(ids(orderConversations([older, newer])), ['newer', 'older']);
});

test('不改動傳入的陣列', () => {
    const input = fixtures();
    const before = ids(input);
    orderConversations(input);
    assert.deepEqual(ids(input), before);
});

test('正在看的那張變已讀後留在原位，其餘照規則排', () => {
    const displayed = orderConversations(fixtures());
    const refreshed = fixtures().map((entry) => (entry.id === 'unread-new' ? { ...entry, unread: 0 } : entry));

    assert.deepEqual(ids(orderConversations(refreshed, { keepId: 'unread-new', previousIds: ids(displayed) })), [
        'unread-new', 'unread-old', 'read-new', 'read-old', 'empty-new', 'empty-old',
    ]);
    // 離開那張（不再固定）就回到依規則的位置：最新留言最新，排在已讀段第一。
    assert.deepEqual(ids(orderConversations(refreshed)), [
        'unread-old', 'unread-new', 'read-new', 'read-old', 'empty-new', 'empty-old',
    ]);
});

test('固定的那張不在清單或先前沒有位置時，照規則排', () => {
    const displayed = ids(orderConversations(fixtures()));
    assert.deepEqual(ids(orderConversations(fixtures(), { keepId: 'missing', previousIds: displayed })), displayed);
    assert.deepEqual(ids(orderConversations(fixtures(), { keepId: 'read-old', previousIds: [] })), displayed);
});
