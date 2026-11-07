import { describe, expect, it } from 'vitest';
// @ts-expect-error client script without type declarations
import { spansMultipleRows } from '../../client/album.js';
// @ts-expect-error client script without type declarations
import { isEditingMessage } from '../../client/thread-details.js';

describe('附件區（相簿）的「顯示全部」', () => {
    it('shows the toggle only when the thumbnails span more than one row', () => {
        expect(spansMultipleRows([])).toBe(false);
        expect(spansMultipleRows([10])).toBe(false);
        expect(spansMultipleRows([10, 10, 10])).toBe(false);
        expect(spansMultipleRows([10, 10, 250])).toBe(true);
    });

    it('does not replace a thread while a message is being edited', () => {
        const root = (match: boolean) => ({ querySelector: () => (match ? {} : null) });
        expect(isEditingMessage(root(true))).toBe(true);
        expect(isEditingMessage(root(false))).toBe(false);
        expect(isEditingMessage(null)).toBe(false);
    });
});
