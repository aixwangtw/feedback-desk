import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sameMarkup, thumbReportIds } from '../../resources/js/attachment-thumbs.js';

test('縮圖格的單編號去重後送去輪詢', () => {
    const nodes = [{ dataset: { attachmentThumbs: 'a1' } }, { dataset: { attachmentThumbs: 'b2' } }, { dataset: { attachmentThumbs: 'a1' } }];
    const root = { querySelectorAll: () => nodes };
    assert.deepEqual(thumbReportIds(root), ['a1', 'b2']);
});

test('只有空白不同的畫面視為沒變，不重換節點', () => {
    assert.equal(sameMarkup('<div> a  b </div>\n', '<div> a b </div>'), true);
    assert.equal(sameMarkup('<div data-attachment-count="1"></div>', '<div data-attachment-count="2"></div>'), false);
});
