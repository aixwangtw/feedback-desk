import { describe, expect, it } from 'vitest';
import { config } from '../../src/worker/env';
import type { Report } from '../../src/worker/lib/models';
import type { PortalRow } from '../../src/worker/views/portal';
import { BoardCard, ListRow } from '../../src/worker/views/rows-reference';
import { boardCardHtml, listRowHtml } from '../../src/worker/views/rows';
import { workerEnv } from './helpers';

function row(overrides: Partial<Report>, unread = 0): PortalRow {
    const report: Report = {
        id: 1, project_id: 1, public_id: '0199c3a1-0000-4000-8000-000000000001', reporter_token_hash: '', reporter_name: null, category: null, creator_type: 'client', creator_developer_id: null, creator_client_account_id: null, creator_agent: null, claimed_by_developer_id: null, claimed_agent: null, claimed_at: null,
        title: '標題 <b>"引號" & \'單引號\'</b>', description: 'd', adjustment_note: null, page_url: null, status: 'needs_input', completed_at: null, client_deleted_at: null, shared_with_client: 0,
        latest_activity_at: '2026-10-14T02:30:00.000Z', owner_last_read_at: null, client_last_read_at: null, adjustment_updated_at: null,
        created_at: '2026-10-13T02:30:00.000Z', updated_at: '', ...overrides,
    };
    return { report, number: 7, creatorLabel: '王老師 & <客戶>', unread };
}

const cases: Array<[string, PortalRow]> = [
    ['plain', row({})],
    ['client deleted', row({ client_deleted_at: '2026-10-15T00:00:00.000Z' })],
    ['completed', row({ status: 'completed' })],
    ['waiting on the team', row({ status: 'new' })],
    ['unread', row({}, 2)],
    ['over 99 unread', row({}, 120)],
    ['a long title and creator with markup', row({ title: '很長的標題 '.repeat(20) })],
];

const v = { cfg: config(workerEnv), now: Date.parse('2026-10-19T00:00:00Z') };
const backPath = '/p/demo?status=new&q=a"b';

describe('string-rendered rows match the JSX reference', () => {
    for (const isOwner of [true, false]) {
        for (const [name, portalRow] of cases) {
            it(`${name} (${isOwner ? 'owner' : 'client'})`, () => {
                const ctx = { v, slug: 'demo', isOwner, backPath };
                const jsxRow = String(<ListRow v={v} row={portalRow} slug="demo" isOwner={isOwner} backPath={backPath} />);
                expect(jsxRow.length).toBeGreaterThan(800);
                expect(listRowHtml(ctx, portalRow)).toBe(jsxRow);
                const jsxCard = String(<BoardCard v={v} row={portalRow} order={3} slug="demo" isOwner={isOwner} backPath={backPath} />);
                expect(boardCardHtml(ctx, portalRow, 3)).toBe(jsxCard);
            });
        }
    }
});

describe('Jira-style list rows and board cards', () => {
    const ctx = { v, slug: 'demo', isOwner: true, backPath: '/p/demo' };

    it('keeps only number, title, status, creator and last update; no badges, buttons, thumbnails or adjustment', () => {
        const html = listRowHtml(ctx, row({ adjustment_note: '舊的調整重點' }, 3));
        for (const gone of ['data-report-flags', 'data-chat-open', 'data-unread-flag', '待審留言', 'data-draft-badge', 'data-adjustment', '調整重點', 'data-lightbox-trigger', 'data-dialog-open="edit-report', 'data-complete-report', 'data-delete-report', 'data-category-autosave', 'data-report-category']) {
            expect(html, gone).not.toContain(gone);
        }
        expect(html.match(/<td /g)).toHaveLength(5);
        expect(html).toContain('data-report-creator');
        expect(html).toContain('最後更新：');
        expect(boardCardHtml(ctx, row({ adjustment_note: '舊的' }, 3), 0)).not.toContain('調整重點');
        const card = boardCardHtml(ctx, row({}, 3), 0);
        for (const gone of ['data-card-action', 'data-lightbox-trigger', 'data-category-autosave', 'data-complete-report', 'data-chat-open']) {
            expect(card, gone).not.toContain(gone);
        }
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
