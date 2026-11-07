import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { listThumbsForReports } from '../../src/worker/lib/album';
import type { Report } from '../../src/worker/lib/models';
// @ts-expect-error client script without type declarations
import { sameMarkup, thumbReportIds } from '../../client/attachment-thumbs.js';
import { Browser, PNG_BYTES, seedAttachment, seedProject, seedReport, type SeededProject } from './helpers';

/**
 * 附件即時更新（對應 Laravel 版 FeedbackAttachmentLiveUpdateTest）：列表、看板、詳情、面板的附件都來自同一套規則（lib/album.ts）。
 * 列表含留言附件（最新在前、最多 3 張＋「+N」）、收回的不算、草稿附件只有團隊的相簿看得到且列表不顯示。
 */
const JSON_HEADERS = { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' };
const slugOf = (seeded: SeededProject) => seeded.project.slug;

async function seedMessage(report: Report, author: 'owner' | 'reporter' = 'reporter', at = new Date().toISOString()): Promise<number> {
    const row = await env.DB.prepare("INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, ?, '某人', '附件留言', ?, ?) RETURNING id").bind(report.id, author, at, at).first<{ id: number }>();
    return row?.id ?? 0;
}

async function seedDatedAttachment(report: Report, messageId: number | null, name: string, at: string): Promise<number> {
    const id = await seedAttachment(report, { messageId, name });
    await env.DB.prepare('UPDATE attachments SET created_at = ? WHERE id = ?').bind(at, id).run();
    return id;
}

async function setup() {
    const seeded = await seedProject();
    const { report } = await seedReport(seeded.project, { title: '附件即時更新' });
    const owner = await new Browser().asOwner(seeded);
    const client = await new Browser().asClient(seeded);
    return { seeded, report, owner, client };
}

const thumbsUrl = (seeded: SeededProject, ids: string[]) => `/p/${slugOf(seeded)}/attachment-thumbs?${ids.map((id) => `ids[]=${id}`).join('&')}`;

describe('列表與看板的附件縮圖含留言附件', () => {
    it('lists message attachments newest first, at most 3 thumbnails plus a +N counter that opens the album', async () => {
        const { seeded, report, owner } = await setup();
        await seedDatedAttachment(report, null, 'original.png', '2026-11-07T01:00:00.000Z');
        const message = await seedMessage(report);
        await seedDatedAttachment(report, message, 'm-old.png', '2026-11-07T02:00:00.000Z');
        await seedDatedAttachment(report, message, 'm-mid.png', '2026-11-07T03:00:00.000Z');
        await seedDatedAttachment(report, message, 'm-new.png', '2026-11-07T04:00:00.000Z');

        for (const view of ['', '&view=board']) {
            const html = await (await owner.get(`/p/${slugOf(seeded)}?tab=all${view}`)).text();
            const cell = html.slice(html.indexOf(`data-attachment-thumbs="${report.public_id}"`));
            const block = cell.slice(0, cell.indexOf('</div>'));
            expect(block).toContain('data-attachment-count="4"');
            expect(block.match(/<img /g)).toHaveLength(3);
            expect(block.indexOf('m-new.png')).toBeLessThan(block.indexOf('m-mid.png'));
            expect(block.indexOf('m-mid.png')).toBeLessThan(block.indexOf('m-old.png'));
            expect(block).not.toContain('alt="original.png"');
            expect(block).toContain('>+1</button>');
            expect(block).toContain('data-lightbox-gallery=');
            expect(block).toContain('data-lightbox-index="3"');
            expect(block).not.toContain('data-open-album');
            expect(block).not.toContain('data-dialog-open');
            expect(html).toContain('data-attachment-thumbs-url');
        }
    });

    it('does not count withdrawn messages or drafts, and the album badge count matches', async () => {
        const { seeded, report, owner, client } = await setup();
        const kept = await seedMessage(report);
        await seedDatedAttachment(report, kept, 'kept.png', '2026-11-07T01:00:00.000Z');
        const withdrawn = await seedMessage(report);
        await seedDatedAttachment(report, withdrawn, 'withdrawn.png', '2026-11-07T02:00:00.000Z');
        await env.DB.prepare("UPDATE messages SET deleted_at = '2026-11-07T03:00:00.000Z' WHERE id = ?").bind(withdrawn).run();
        const key = `p/${report.project_id}/${crypto.randomUUID()}`;
        await env.FILES.put(key, PNG_BYTES, { httpMetadata: { contentType: 'image/png' } });
        const now = new Date().toISOString();
        await env.DB.prepare("INSERT INTO message_drafts (report_id, author_name, body, attachments, created_at, updated_at) VALUES (?, '開發團隊', '草稿', ?, ?, ?)")
            .bind(report.id, JSON.stringify([{ object_key: key, original_name: 'secret-draft.png', mime_type: 'image/png', size: 1 }]), now, now)
            .run();

        const list = await (await owner.get(`/p/${slugOf(seeded)}?tab=all`)).text();
        expect(list).toContain('data-attachment-count="1"');
        expect(list).not.toContain('withdrawn.png');
        expect(list).not.toContain('secret-draft.png');

        const polled = (await (await owner.get(thumbsUrl(seeded, [report.public_id]))).json()) as { reports: Record<string, { count: number; row_html: string }> };
        expect(polled.reports[report.public_id].count).toBe(1);
        expect(polled.reports[report.public_id].row_html).not.toContain('secret-draft');

        // Badge number in the panel: the team's album includes the draft (2), the client's does not (1).
        const teamThread = (await (await owner.get(`/p/${slugOf(seeded)}/conversations/${report.public_id}`, JSON_HEADERS)).json()) as { album_count: number; album_html: string };
        expect(teamThread.album_count).toBe(2);
        expect(teamThread.album_html).toContain('secret-draft.png');
        const clientThread = (await (await client.get(`/p/${slugOf(seeded)}/conversations/${report.public_id}`, JSON_HEADERS)).json()) as { album_count: number; album_html: string };
        expect(clientThread.album_count).toBe(1);
        expect(JSON.stringify(clientThread)).not.toContain('secret-draft');
        const clientPolled = await (await client.get(thumbsUrl(seeded, [report.public_id]))).text();
        expect(clientPolled).not.toContain('secret-draft');
    });

    it('the polling endpoint reflects a newly uploaded attachment and the unit rule matches the album', async () => {
        const { seeded, report, owner } = await setup();
        const url = thumbsUrl(seeded, [report.public_id]);
        const before = (await (await owner.get(url)).json()) as { reports: Record<string, { count: number }> };
        expect(before.reports[report.public_id].count).toBe(0);

        const message = await seedMessage(report);
        await seedDatedAttachment(report, message, 'fresh.png', '2026-11-07T05:00:00.000Z');
        const after = (await (await owner.get(url)).json()) as { reports: Record<string, { count: number; row_html: string; card_html: string }> };
        expect(after.reports[report.public_id].count).toBe(1);
        expect(after.reports[report.public_id].row_html).toContain('fresh.png');
        expect(after.reports[report.public_id].card_html).toContain('data-card-action');
        expect(after.reports[report.public_id].row_html).not.toContain('data-card-action');

        const unit = await listThumbsForReports(env.DB, slugOf(seeded), [report], { authorLabel: () => 'x', formatAt: (iso) => iso });
        expect(unit.get(report.id)?.total).toBe(1);
    });

    it('hides reports the client cannot see from the polling endpoint', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project, { title: '團隊自己的單', creator: 'developer' });
        const message = await seedMessage(report, 'owner');
        await seedDatedAttachment(report, message, 'private.png', '2026-11-07T05:00:00.000Z');
        const client = await new Browser().asClient(seeded);
        const data = (await (await client.get(thumbsUrl(seeded, [report.public_id]))).json()) as { reports: Record<string, unknown> };
        expect(data.reports).toEqual({});
    });
});

describe('面板相簿鈕與前端輔助函式', () => {
    it('keeps the album button in the panel header (always visible, badge, back pane)', async () => {
        const { seeded, owner } = await setup();
        const html = await (await owner.get(`/p/${slugOf(seeded)}?tab=all`)).text();
        expect(html).toMatch(/<button[^>]*data-chat-album-open="true">(?:(?!<\/button>).)*data-chat-album-count/s);
        expect(html).not.toContain('data-chat-album-open="true" hidden');
        expect(html).toContain('data-chat-album-back');
        expect(html).toContain('data-chat-album-new-hint');
    });

    it('dedupes the report ids to poll and ignores whitespace-only differences', () => {
        const nodes = [{ dataset: { attachmentThumbs: 'a1' } }, { dataset: { attachmentThumbs: 'b2' } }, { dataset: { attachmentThumbs: 'a1' } }];
        expect(thumbReportIds({ querySelectorAll: () => nodes })).toEqual(['a1', 'b2']);
        expect(sameMarkup('<div> a  b </div>\n', '<div> a b </div>')).toBe(true);
        expect(sameMarkup('<div data-attachment-count="1"></div>', '<div data-attachment-count="2"></div>')).toBe(false);
    });
});

describe('團隊也有「完成」鈕與新的詳細資料排版', () => {
    it('shows the complete button in list and board for the team, hidden once completed', async () => {
        const { seeded, report, owner } = await setup();
        for (const view of ['', '&view=board']) {
            const html = await (await owner.get(`/p/${slugOf(seeded)}?tab=all${view}`)).text();
            expect(html).toContain(`data-request-completion="${report.public_id}"`);
            expect(html).toContain(`data-dialog-open="request-completion-${report.public_id}"`);
        }
        const dialogs = await (await owner.get(`/p/${slugOf(seeded)}/reports/${report.public_id}/dialogs`)).text();
        expect(dialogs).toContain(`id="request-completion-${report.public_id}"`);
        await env.DB.prepare("UPDATE reports SET status = 'completed' WHERE id = ?").bind(report.id).run();
        const done = await (await owner.get(`/p/${slugOf(seeded)}?tab=all`)).text();
        expect(done).not.toContain(`data-request-completion="${report.public_id}"`);
    });

    it('lays out the side column as label|value rows with an overflow menu and no wrapped long hint', async () => {
        const { seeded, report, owner } = await setup();
        const data = (await (await owner.get(`/p/${slugOf(seeded)}/conversations/${report.public_id}`, JSON_HEADERS)).json()) as { side_html: string };
        expect(data.side_html).toContain('data-detail-fields');
        for (const label of ['狀態', '建立者', '建立時間', '最後更新']) {
            expect(data.side_html).toContain(`>${label}</dt>`);
        }
        expect(data.side_html).toContain('data-request-completion');
        expect(data.side_html).not.toContain('不會直接結案。</p>');
        const dialogs = await (await owner.get(`/p/${slugOf(seeded)}/reports/${report.public_id}/dialogs`)).text();
        const menu = dialogs.slice(dialogs.indexOf('data-action-menu'));
        expect(menu).toContain('text-rose-700');
        expect(menu).toContain('data-delete-report');
        expect(menu).toContain('data-chat-open');
        // the heading is 留言, not 活動
        expect(dialogs).toContain('>留言</h3>');
        expect(dialogs).not.toContain('>活動<');
        const page = await (await owner.get(`/p/${slugOf(seeded)}/reports/${report.public_id}`)).text();
        expect(page).not.toContain('>活動<');
    });
});

describe('附件燈箱（點縮圖只看這張單的附件）', () => {
    it('the thumbnail cell carries every attachment of this report with name, source and time, and no draft files', async () => {
        const { seeded, report, owner } = await setup();
        const other = (await seedReport(seeded.project, { title: '別張單' })).report;
        await seedDatedAttachment(other, null, 'someone-elses.png', '2026-11-07T01:00:00.000Z');
        await seedDatedAttachment(report, null, 'original.png', '2026-11-07T01:00:00.000Z');
        const message = await seedMessage(report);
        for (const [index, name] of ['a.png', 'b.png', 'c.png', 'd.png'].entries()) {
            await seedDatedAttachment(report, message, name, `2026-11-07T0${2 + index}:00:00.000Z`);
        }
        const data = (await (await owner.get(thumbsUrl(seeded, [report.public_id]))).json()) as { reports: Record<string, { row_html: string }> };
        const html = data.reports[report.public_id].row_html;
        const raw = /data-lightbox-gallery="([^"]*)"/.exec(html)?.[1] ?? '';
        const gallery = JSON.parse(raw.replaceAll('&quot;', '"').replaceAll('&amp;', '&')) as Array<{ url: string; name: string; video: boolean; source: string; at: string }>;
        expect(gallery.map((item) => item.name)).toEqual(['d.png', 'c.png', 'b.png', 'a.png', 'original.png']);
        expect(gallery[0].source).toContain('的留言');
        expect(gallery[4].source).toBe('原始附件');
        expect(gallery[0].at).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
        expect(raw).not.toContain('someone-elses');
        expect(html).not.toContain('data-open-album');
        expect(html).not.toContain('data-dialog-open');
        expect(html.match(/data-lightbox-index=/g)).toHaveLength(4);
    });
});
