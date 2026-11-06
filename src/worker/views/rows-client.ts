/**
 * Large portal pages ship their rows as JSON and the browser builds them with the same functions
 * the server uses for small pages (rows.ts), so the markup is identical either way.
 */
import type { ReportStatus, StatusLabels } from '../../shared/status';
import type { FeedbackConfig } from '../env';
import type { Report } from '../lib/models';
import type { PortalRow } from './portal';
import { boardCardHtml, listRowHtml, type RowContext } from './rows';

/** Above this many rows on one page, rendering moves to the browser to stay within the CPU budget. */
export const SERVER_ROW_LIMIT = 20;

export const PORTAL_ROWS_ELEMENT_ID = 'portal-rows-data';

export interface PortalRowsPayload {
    view: 'list' | 'board';
    slug: string;
    isOwner: boolean;
    backPath: string;
    now: number;
    labels: { client: string; owner: string };
    statusLabels: StatusLabels;
    utcOffsetMinutes: number;
    timezoneName: string;
    rows: Array<{
        report: Pick<Report, 'public_id' | 'title' | 'status' | 'client_deleted_at' | 'latest_activity_at'>;
        number: number;
        creatorLabel: string;
        unread: number;
    }>;
}

export function buildPayload(ctx: RowContext, view: 'list' | 'board', rows: PortalRow[]): PortalRowsPayload {
    return {
        view,
        slug: ctx.slug,
        isOwner: ctx.isOwner,
        backPath: ctx.backPath,
        now: ctx.v.now,
        labels: { client: ctx.v.cfg.labels.client, owner: ctx.v.cfg.labels.owner },
        statusLabels: ctx.v.cfg.statusLabels,
        utcOffsetMinutes: ctx.v.cfg.utcOffsetMinutes,
        timezoneName: ctx.v.cfg.timezoneName,
        rows: rows.map((row) => ({
            report: {
                public_id: row.report.public_id,
                title: row.report.title,
                status: row.report.status,
                client_deleted_at: row.report.client_deleted_at,
                latest_activity_at: row.report.latest_activity_at,
            },
            number: row.number,
            creatorLabel: row.creatorLabel,
            // Already computed for this viewer side (the team's unread state never reaches the client).
            unread: row.unread,
        })),
    };
}

/** JSON that is safe inside <script type="application/json">. */
export function payloadScript(payload: PortalRowsPayload): string {
    return JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function contextFrom(payload: PortalRowsPayload): RowContext {
    const cfg = { labels: payload.labels, statusLabels: payload.statusLabels, utcOffsetMinutes: payload.utcOffsetMinutes, timezoneName: payload.timezoneName } as unknown as FeedbackConfig;
    return { v: { cfg, now: payload.now }, slug: payload.slug, isOwner: payload.isOwner, backPath: payload.backPath };
}

function toRows(payload: PortalRowsPayload): PortalRow[] {
    return payload.rows as unknown as PortalRow[];
}

/** HTML of every row for a list page. */
export function listHtml(payload: PortalRowsPayload): string {
    const ctx = contextFrom(payload);
    return toRows(payload).map((row) => listRowHtml(ctx, row)).join('');
}

/** HTML of the cards of one board column; `order` is the row's position on the page. */
export function boardColumnHtml(payload: PortalRowsPayload, status: ReportStatus): string {
    const ctx = contextFrom(payload);
    return toRows(payload)
        .map((row, order) => (row.report.status === status ? boardCardHtml(ctx, row, order) : ''))
        .join('');
}
