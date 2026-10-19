import { describe, expect, it } from 'vitest';
import { config } from '../../src/worker/env';
import type { Attachment, Report } from '../../src/worker/lib/models';
import { paths } from '../../src/worker/routes/paths';
import type { PortalRow } from '../../src/worker/views/portal';
import { BoardCard, ListRow } from '../../src/worker/views/rows-reference';
import { boardCardHtml, listRowHtml } from '../../src/worker/views/rows';
import { workerEnv } from './helpers';

function attachment(id: number, kind: 'feedback' | 'adjustment', name: string): Attachment {
    return { id, report_id: 1, message_id: null, kind, object_key: 'k', original_name: name, mime_type: 'image/png', size: 1, created_at: '' };
}

function row(overrides: Partial<Report>, attachments: Attachment[] = [], adjustments: Attachment[] = [], badges: Partial<Pick<PortalRow, 'unread' | 'messagesCount'>> = {}): PortalRow {
    const report: Report = {
        id: 1, project_id: 1, public_id: '0199c3a1-0000-4000-8000-000000000001', reporter_token_hash: '', reporter_name: null, creator_type: 'client', creator_developer_id: null,
        title: '標題 <b>"引號" & \'單引號\'</b>', description: 'd', adjustment_note: null, page_url: null, status: 'needs_input', completed_at: null, client_deleted_at: null,
        latest_activity_at: '2026-10-14T02:30:00.000Z', owner_last_read_at: null, client_last_read_at: null, adjustment_updated_at: null,
        created_at: '2026-10-13T02:30:00.000Z', updated_at: '', ...overrides,
    };
    return { report, number: 7, creatorLabel: '王老師 & <客戶>', attachments, adjustmentAttachments: adjustments, unread: 0, messagesCount: 0, ...badges };
}

const cases: Array<[string, PortalRow]> = [
    ['plain', row({})],
    ['deleted with images and note', row({ client_deleted_at: '2026-10-15T00:00:00.000Z', adjustment_note: '已調整\n第二行 <script>' }, [attachment(3, 'feedback', 'a "b".png'), attachment(4, 'feedback', 'c.png')], [attachment(5, 'adjustment', 'after.png')])],
    ['adjustment images only', row({ status: 'completed' }, [], [attachment(6, 'adjustment', 'x.png'), attachment(8, 'adjustment', 'y.png')])],
    ['unread messages', row({}, [], [], { unread: 2, messagesCount: 5 })],
    ['over 99 unread', row({}, [], [], { unread: 120, messagesCount: 130 })],
    ['adjustment update only (unread without messages)', row({}, [], [], { unread: 1, messagesCount: 0 })],
    ['messages, none unread', row({}, [], [], { messagesCount: 3 })],
];

describe('string-rendered rows match the JSX reference', () => {
    const v = { cfg: config(workerEnv), now: Date.parse('2026-10-19T00:00:00Z') };
    const backPath = '/p/demo?status=new&q=a"b';
    const attachmentUrl = (report: Report, item: Attachment) => paths.attachment('demo', report.public_id, item.id);
    for (const isOwner of [true, false]) {
        for (const [name, portalRow] of cases) {
            it(`${name} (${isOwner ? 'owner' : 'client'})`, () => {
                const ctx = { v, slug: 'demo', isOwner, backPath };
                const jsxRow = String(<ListRow v={v} row={portalRow} slug="demo" isOwner={isOwner} backPath={backPath} attachmentUrl={attachmentUrl} />);
                expect(jsxRow.length).toBeGreaterThan(1500);
                expect(listRowHtml(ctx, portalRow)).toBe(jsxRow);
                const jsxCard = String(<BoardCard v={v} row={portalRow} order={3} slug="demo" isOwner={isOwner} backPath={backPath} attachmentUrl={attachmentUrl} />);
                expect(boardCardHtml(ctx, portalRow, 3)).toBe(jsxCard);
            });
        }
    }
});
