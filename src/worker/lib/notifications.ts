/**
 * 頁首通知鈴鐺：只列「對方」發的、自己還沒讀的留言。
 * 開發團隊：客戶（回報者）的新留言，範圍是登入可看的專案（統一登入＝全部專案）；另列待審留言（草稿）。
 * 客戶：開發團隊（含 AI）在她看得到的單上的新留言；草稿永遠不列。
 *
 * Free-plan CPU budget: one batch of at most two queries, each returning at most MAX_ITEMS rows.
 * The newest message of each listed report is picked inside the query, not one query per report.
 */
import { CLIENT_VISIBLE_SQL } from './models';
import { clientReadAtSql, type ClientViewer, TEAM_AUTHOR_TYPES } from './reports';
import { placeholders } from './db';

export const MAX_BELL_ITEMS = 20;
/** Characters read from the newest message for the excerpt; the view shortens it further. */
const EXCERPT_SOURCE_CHARS = 200;

export interface BellItem {
    projectName: string;
    projectSlug: string;
    publicId: string;
    title: string;
    excerpt: string;
    at: string;
    unread: number;
}

export interface BellDraft {
    projectName: string;
    projectSlug: string;
    publicId: string;
    title: string;
    count: number;
}

export interface Notifications {
    isOwner: boolean;
    total: number;
    items: BellItem[];
    drafts: BellDraft[];
}

type ItemRow = { project_name: string; project_slug: string; public_id: string; title: string; unread: number; latest_body: string | null; latest_at: string | null; total_unread: number };

function toItems(rows: ItemRow[]): { total: number; items: BellItem[] } {
    return {
        total: rows[0]?.total_unread ?? 0,
        items: rows
            .filter((row) => row.latest_at !== null)
            .map((row) => ({
                projectName: row.project_name,
                projectSlug: row.project_slug,
                publicId: row.public_id,
                title: row.title,
                excerpt: (row.latest_body ?? '').replace(/\s+/gu, ' ').trim(),
                at: row.latest_at as string,
                unread: row.unread,
            })),
    };
}

/** Team bell over the given projects: client messages the team has not read, plus drafts. */
export async function teamNotifications(db: D1Database, projectIds: number[]): Promise<Notifications> {
    if (projectIds.length === 0) {
        return { isOwner: true, total: 0, items: [], drafts: [] };
    }
    const inProjects = `r.project_id IN (${placeholders(projectIds.length)})`;
    const [items, drafts] = await db.batch([
        db
            .prepare(
                `WITH unread AS (
                    SELECT r.id, r.project_id, r.public_id, r.title,
                        (SELECT COUNT(*) FROM messages um WHERE um.report_id = r.id AND um.author_type = 'reporter'
                            AND (r.owner_last_read_at IS NULL OR um.created_at > r.owner_last_read_at)) AS unread
                    FROM reports r WHERE ${inProjects}
                ), latest AS (
                    SELECT u.*, (SELECT lm.id FROM messages lm WHERE lm.report_id = u.id AND lm.author_type = 'reporter' ORDER BY lm.created_at DESC, lm.id DESC LIMIT 1) AS latest_id
                    FROM unread u WHERE u.unread > 0
                )
                SELECT p.name AS project_name, p.slug AS project_slug, l.public_id, l.title, l.unread,
                    substr(m.body, 1, ${EXCERPT_SOURCE_CHARS}) AS latest_body, m.created_at AS latest_at, SUM(l.unread) OVER () AS total_unread
                FROM latest l JOIN projects p ON p.id = l.project_id JOIN messages m ON m.id = l.latest_id
                ORDER BY m.created_at DESC, m.id DESC LIMIT ${MAX_BELL_ITEMS}`,
            )
            .bind(...projectIds),
        db
            .prepare(
                `SELECT p.name AS project_name, p.slug AS project_slug, r.public_id, r.title, COUNT(md.id) AS count
                FROM message_drafts md JOIN reports r ON r.id = md.report_id JOIN projects p ON p.id = r.project_id
                WHERE ${inProjects}
                GROUP BY r.id ORDER BY MAX(md.id) DESC LIMIT ${MAX_BELL_ITEMS}`,
            )
            .bind(...projectIds),
    ]);
    const listed = toItems(items.results as ItemRow[]);
    return {
        isOwner: true,
        total: listed.total,
        items: listed.items,
        drafts: (drafts.results as Array<{ project_name: string; project_slug: string; public_id: string; title: string; count: number }>).map((row) => ({
            projectName: row.project_name,
            projectSlug: row.project_slug,
            publicId: row.public_id,
            title: row.title,
            count: row.count,
        })),
    };
}

/**
 * Client bell for one project: team (and AI) messages on reports the client can see that this
 * viewer has not read. Adjustment-note updates are not messages and are not listed here.
 */
export async function clientNotifications(db: D1Database, projectId: number, viewer: ClientViewer): Promise<Notifications> {
    const readAt = clientReadAtSql('r', viewer);
    const { results } = await db
        .prepare(
            `WITH seen AS (
                SELECT r.id, r.project_id, r.public_id, r.title, ${readAt} AS read_at
                FROM reports r WHERE r.project_id = ? AND ${CLIENT_VISIBLE_SQL} AND r.client_deleted_at IS NULL
            ), unread AS (
                SELECT s.*, (SELECT COUNT(*) FROM messages um WHERE um.report_id = s.id AND um.author_type IN ${TEAM_AUTHOR_TYPES}
                    AND (s.read_at IS NULL OR um.created_at > s.read_at)) AS unread
                FROM seen s
            ), latest AS (
                SELECT u.*, (SELECT lm.id FROM messages lm WHERE lm.report_id = u.id AND lm.author_type IN ${TEAM_AUTHOR_TYPES} ORDER BY lm.created_at DESC, lm.id DESC LIMIT 1) AS latest_id
                FROM unread u WHERE u.unread > 0
            )
            SELECT p.name AS project_name, p.slug AS project_slug, l.public_id, l.title, l.unread,
                substr(m.body, 1, ${EXCERPT_SOURCE_CHARS}) AS latest_body, m.created_at AS latest_at, SUM(l.unread) OVER () AS total_unread
            FROM latest l JOIN projects p ON p.id = l.project_id JOIN messages m ON m.id = l.latest_id
            ORDER BY m.created_at DESC, m.id DESC LIMIT ${MAX_BELL_ITEMS}`,
        )
        .bind(projectId)
        .all<ItemRow>();
    const listed = toItems(results);
    return { isOwner: false, total: listed.total, items: listed.items, drafts: [] };
}
