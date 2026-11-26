import { describe, expect, it } from 'vitest';
import { Browser, seedProject, seedReport } from './helpers';

/** 右下角對話面板開單時，最上面要看得到開單內容（對應 Laravel 版 FeedbackConversationPanelTest）。 */
const JSON_HEADERS = { accept: 'application/json' };

describe('對話面板的開單內容', () => {
    it('shows the report description on both sides, not just the title', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project, { title: '只看標題看不懂的單', description: '匯入後第 3 題的圖不見了\n請幫忙看' });

        for (const browser of [await new Browser().asOwner(seeded), await new Browser().asClient(seeded)]) {
            const data = (await (await browser.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS)).json()) as { html: string };
            expect(data.html).toContain('data-chat-report-description');
            expect(data.html).toContain('匯入後第 3 題的圖不見了');
            expect(data.html).toContain('請幫忙看');
        }
    });
});
