import assert from 'node:assert/strict';
import { test } from 'node:test';

import { INTERACTIVE_SELECTOR, isInteractiveTarget, shouldOpenRowDetail } from '../../resources/js/row-link.js';

/** 只有 closest 的假元素：命中選擇器裡任一個標籤就回自己。 */
const element = (tag) => ({
    closest: (selector) => (selector === INTERACTIVE_SELECTOR && ['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'form'].includes(tag) ? { tag } : null),
});

test('連結、按鈕、輸入元件不當成整列點擊', () => {
    for (const tag of ['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', 'form']) {
        assert.equal(isInteractiveTarget(element(tag)), true, tag);
    }
    assert.equal(isInteractiveTarget(element('td')), false);
    assert.equal(isInteractiveTarget(null), false);
});

test('點到列上空白處、左鍵、沒按修飾鍵、沒選取文字才開詳情', () => {
    const base = { target: element('td'), button: 0 };

    assert.equal(shouldOpenRowDetail(base), true);
    assert.equal(shouldOpenRowDetail({ ...base, target: element('a') }), false);
    assert.equal(shouldOpenRowDetail({ ...base, button: 1 }), false);
    assert.equal(shouldOpenRowDetail({ ...base, ctrlKey: true }), false);
    assert.equal(shouldOpenRowDetail({ ...base, metaKey: true }), false);
    assert.equal(shouldOpenRowDetail({ ...base, shiftKey: true }), false);
    assert.equal(shouldOpenRowDetail({ ...base, defaultPrevented: true }), false);
    assert.equal(shouldOpenRowDetail(base, { selection: '正在選取的文字' }), false);
});
