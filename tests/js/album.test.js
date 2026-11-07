import assert from 'node:assert/strict';
import { test } from 'node:test';

import { spansMultipleRows } from '../../resources/js/album.js';

test('縮圖頂端位置只有一種就是一排，不出現「顯示全部」', () => {
    assert.equal(spansMultipleRows([]), false);
    assert.equal(spansMultipleRows([12]), false);
    assert.equal(spansMultipleRows([12, 12, 12]), false);
});

test('縮圖頂端位置不只一種就是超過一排，要出現「顯示全部」', () => {
    assert.equal(spansMultipleRows([12, 12, 220]), true);
    assert.equal(spansMultipleRows([220, 12]), true);
});
