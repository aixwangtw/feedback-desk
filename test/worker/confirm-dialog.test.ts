import { describe, expect, it } from 'vitest';
import { discardDraftText, deleteReportText, withdrawMessageText } from '../../src/shared/confirm';
// @ts-expect-error client script without type declarations
import { captionText, parseGallery, stepIndex } from '../../client/attachment-lightbox.js';
// @ts-expect-error client script without type declarations
import { confirmOptions } from '../../client/confirm-dialog.js';
import { Browser, seedProject, seedReport } from './helpers';

/**
 * 確認視窗：只有「刪除單」「收回留言」（含捨棄待審留言）先跳，用網站自己的元件；完成、通過不跳確認。
 */
describe('確認視窗文字與元件', () => {
    it('names the report or message being deleted', () => {
        expect(deleteReportText('答案存不起來', true).message).toContain('「答案存不起來」');
        expect(deleteReportText('答案存不起來', false).message).toContain('「答案存不起來」');
        expect(withdrawMessageText('第一行\n第二行').message).toContain('「第一行 第二行」收回後會直接消失');
        expect(withdrawMessageText('字'.repeat(60)).message).toContain('…');
        expect(discardDraftText().confirm).toBe('確認捨棄');
    });

    it('the list dialogs use the shared component and no browser confirm() or data-confirm remains on complete', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project, { title: '要刪的單' });
        const owner = await new Browser().asOwner(seeded);
        const dialogs = await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}/dialogs`)).text();
        expect(dialogs).toContain(`id="delete-report-${report.public_id}"`);
        expect(dialogs).toContain('「要刪的單」與它的截圖、留言紀錄會被永久刪除');
        expect(dialogs).toContain('data-confirm-ok');
        expect(dialogs).not.toContain('data-confirm="');
        const page = await (await owner.get(`/p/${seeded.project.slug}?tab=all`)).text();
        expect(page).toContain('data-confirm-dialog');
        const client = await new Browser().asClient(seeded);
        const list = await (await client.get(`/p/${seeded.project.slug}?tab=all`)).text();
        expect(list).not.toContain('data-confirm="');
    });
});

describe('client modules', () => {
    it('steps through the lightbox with wrap-around', () => {
        expect(stepIndex(0, -1, 4)).toBe(3);
        expect(stepIndex(3, 1, 4)).toBe(0);
    });

    it('parses the gallery and builds the caption', () => {
        const list = parseGallery('[{"url":"/a.png","name":"a.png","video":true,"source":"原始附件","at":"2026/11/07 10:00"},{"name":"x"}]');
        expect(list).toHaveLength(1);
        expect(captionText(list[0])).toEqual({ name: 'a.png', meta: '來自：原始附件　2026/11/07 10:00' });
        expect(parseGallery('oops')).toEqual([]);
    });

    it('confirm options come from the form attributes', () => {
        expect(confirmOptions({ confirmTitle: 'T', confirmMessage: 'M', confirmLabel: 'L' })).toEqual({ title: 'T', message: 'M', label: 'L', tone: 'danger' });
    });
});
