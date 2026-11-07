import { describe, expect, it } from 'vitest';
import { config } from '../../src/worker/env';
import type { Attachment, Report } from '../../src/worker/lib/models';
import type { PortalRow } from '../../src/worker/views/portal';
import { BoardCard, ListRow } from '../../src/worker/views/rows-reference';
import { boardCardHtml, listRowHtml } from '../../src/worker/views/rows';
import { workerEnv } from './helpers';

const png: Attachment = { id: 11, report_id: 1, message_id: null, kind: 'feedback', object_key: 'k', original_name: '圖一 <紅框>.png', mime_type: 'image/png', size: 5, uploader_client_account_id: null, uploader_developer_id: null, created_at: '' };
const mp4: Attachment = { ...png, id: 12, original_name: '操作.mp4', mime_type: 'video/mp4' };
const thumbOf = (attachment: Attachment) => ({ url: `/p/demo/reports/0199c3a1-0000-4000-8000-000000000001/attachments/${attachment.id}`, name: attachment.original_name, isVideo: attachment.mime_type.startsWith('video/') });

function row(overrides: Partial<Report>, unread = 0, attachments: Attachment[] = [], extraTotal = 0): PortalRow {
    const report: Report = {
        id: 1, project_id: 1, public_id: '0199c3a1-0000-4000-8000-000000000001', reporter_token_hash: '', reporter_name: null, category: null, creator_type: 'client', creator_developer_id: null, creator_client_account_id: null, creator_agent: null, claimed_by_developer_id: null, claimed_agent: null, claimed_at: null,
        title: '標題 <b>"引號" & \'單引號\'</b>', description: 'd', adjustment_note: null, page_url: null, status: 'needs_input', completed_at: null, client_deleted_at: null, shared_with_client: 0,
        latest_activity_at: '2026-10-14T02:30:00.000Z', owner_last_read_at: null, client_last_read_at: null, adjustment_updated_at: null,
        created_at: '2026-10-13T02:30:00.000Z', updated_at: '', ...overrides,
    };
    return { report, number: 7, creatorLabel: '王老師 & <客戶>', unread, thumbs: attachments.map(thumbOf), thumbTotal: attachments.length + extraTotal };
}

const cases: Array<[string, PortalRow]> = [
    ['plain', row({})],
    ['client deleted', row({ client_deleted_at: '2026-10-15T00:00:00.000Z' })],
    ['completed', row({ status: 'completed' })],
    ['waiting on the team', row({ status: 'new' })],
    ['unread', row({}, 2)],
    ['with an image and a video', row({ category: '版面 & 字型' }, 0, [png, mp4])],
    ['an unlisted category', row({ category: '舊分類' }, 1, [png])],
    ['with a plus counter', row({}, 0, [png, mp4], 4)],
    ['over 99 unread', row({}, 120)],
    ['a long title and creator with markup', row({ title: '很長的標題 '.repeat(20) })],
];

const v = { cfg: config(workerEnv), now: Date.parse('2026-10-19T00:00:00Z') };
const backPath = '/p/demo?status=new&q=a"b';

describe('string-rendered rows match the JSX reference', () => {
    for (const isOwner of [true, false]) {
        for (const [name, portalRow] of cases) {
            it(`${name} (${isOwner ? 'owner' : 'client'})`, () => {
                for (const categories of [[], ['版面 & 字型', '其他']]) {
                    const showCategory = categories.length > 0;
                    const ctx = { v, slug: 'demo', isOwner, backPath, showCategory, categories };
                    const jsxRow = String(<ListRow v={v} row={portalRow} slug="demo" isOwner={isOwner} backPath={backPath} showCategory={showCategory} categories={categories} />);
                    expect(jsxRow.length).toBeGreaterThan(800);
                    expect(listRowHtml(ctx, portalRow)).toBe(jsxRow);
                    const jsxCard = String(<BoardCard v={v} row={portalRow} order={3} slug="demo" isOwner={isOwner} backPath={backPath} categories={categories} />);
                    expect(boardCardHtml(ctx, portalRow, 3)).toBe(jsxCard);
                }
            });
        }
    }
});

describe('Jira-style list rows and board cards', () => {
    const ctx = { v, slug: 'demo', isOwner: true, backPath: '/p/demo' };

    it('keeps the old columns except the three removed (title tags, per-row chat button, adjustment column)', () => {
        const catCtx = { ...ctx, showCategory: true, categories: ['版面 & 字型'] };
        const html = listRowHtml(catCtx, row({ adjustment_note: '舊的調整重點', category: '版面 & 字型' }, 3, [png, mp4]));
        for (const gone of ['data-report-flags', 'data-chat-open', 'data-unread-flag', '待審留言', 'data-draft-badge', 'data-adjustment', '調整重點']) {
            expect(html, gone).not.toContain(gone);
        }
        // number, title, status, category, attachments, creator, created, last update, actions
        expect(html.match(/<td /g)).toHaveLength(9);
        expect(html).toContain('data-category-autosave');
        expect(html).toContain('建立：');
        expect(html).toContain('最後更新：');
        expect(html).toContain('data-dialog-open="edit-report-');
        expect(html).toContain('data-delete-report');
        // image thumbnail and a video thumbnail with a play icon
        expect(html.match(/data-open-album/g)).toHaveLength(2);
        expect(html).toContain('data-attachment-video');
        // the order follows the pre-redesign table
        const order = ['data-report-number', 'data-status-text', 'data-report-category', 'data-attachment-thumbs', 'data-report-creator', '建立：', '最後更新：', 'data-dialog-open="edit-report-'];
        const positions = order.map((needle) => html.indexOf(needle));
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        expect(positions.every((position) => position >= 0)).toBe(true);

        const card = boardCardHtml(catCtx, row({ category: '版面 & 字型' }, 3, [png, mp4]), 0);
        for (const needle of ['data-card-action', 'data-attachment-thumbs', 'data-category-autosave', 'data-dialog-open="edit-report-', 'data-delete-report']) {
            expect(card, needle).toContain(needle);
        }
        for (const gone of ['data-chat-open', '調整重點']) {
            expect(card, gone).not.toContain(gone);
        }
        // both sides get the complete button; the team's opens the request-completion dialog, the client's is a status form
        const clientRow = listRowHtml({ ...ctx, isOwner: false }, row({}));
        expect(clientRow).toContain('data-complete-report');
        expect(clientRow).not.toContain('data-request-completion');
        const teamRow = listRowHtml(ctx, row({}));
        expect(teamRow).toContain('data-request-completion="0199c3a1-0000-4000-8000-000000000001"');
        expect(teamRow).toContain('data-dialog-open="request-completion-0199c3a1-0000-4000-8000-000000000001"');
        expect(boardCardHtml(ctx, row({}), 0)).toContain('data-request-completion=');
        // a completed report has no button on either side
        expect(listRowHtml(ctx, row({ status: 'completed' }))).not.toContain('data-complete-report');
        expect(boardCardHtml(ctx, row({ status: 'completed' }), 0)).not.toContain('data-complete-report');
    });

    it('row click ignores the action buttons and thumbnails (they are links, buttons or forms)', () => {
        const html = listRowHtml({ ...ctx, isOwner: false }, row({}, 0, [png]));
        // every clickable control sits in an <a>, <button> or <form>, which row-link.js already skips
        expect(html).toContain('<a href="/p/demo/reports/');
        expect(html).toMatch(/<button [^>]*data-open-album/);
        expect(html).toMatch(/<button [^>]*data-dialog-open="edit-report-/);
    });

    it('shows the unread count as a plain dot beside the title (not a button or link), on both sides', () => {
        const portalRow = row({}, 3);
        for (const isOwner of [true, false]) {
            const html = listRowHtml({ ...ctx, isOwner }, portalRow);
            const slot = /<span class="inline-flex shrink-0 items-center" data-unread-slot="[^"]+">(.*?)<\/span><\/span>|<span class="inline-flex shrink-0 items-center" data-unread-slot="[^"]+">(.*?)<\/div>/.exec(html);
            expect(slot).not.toBeNull();
            expect(html).toContain('data-unread-dot=""');
            expect(html).toContain('title="3 則未讀留言"');
            expect(html).toContain('>3</span>');
            // The dot is not inside a link or a button.
            expect(html).not.toMatch(/<(a|button)[^>]*>[^<]*<span[^>]*data-unread-dot/);
        }
        // No unread: only the empty container stays, for the panel script to fill in.
        const calm = listRowHtml(ctx, row({}, 0));
        expect(calm).toContain('data-unread-slot=');
        expect(calm).not.toContain('data-unread-dot');
        expect(listRowHtml(ctx, row({}, 120))).toContain('>99+</span>');
    });

    it('makes number and title blue links that open the detail, and the whole row and card clickable', () => {
        const portalRow = row({});
        const html = listRowHtml(ctx, portalRow);
        const card = boardCardHtml(ctx, portalRow, 0);
        for (const output of [html, card]) {
            expect(output).toContain('text-blue-700');
            expect(output).toContain('hover:underline');
            expect(output).toContain('cursor-pointer');
            expect(output).toContain(`data-row-link="detail-report-${portalRow.report.public_id}"`);
            expect(output).toContain(`href="/p/demo/reports/${portalRow.report.public_id}"`);
            // number link + title link
            expect(output.match(/data-report-detail-open="true"/g)).toHaveLength(2);
        }
        expect(card).toContain('hover:shadow-lg');
        expect(card).toContain('hover:-translate-y-0.5');
    });
});
