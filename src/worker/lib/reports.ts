import type { ReportStatus } from '../../shared/status';
import { STATUSES } from '../../shared/status';
import { nowIso } from '../../shared/time';
import type { Env } from '../env';
import { config } from '../env';
import type { Author, Creator } from './access';
import { randomString, sha256Hex } from './crypto';
import { placeholders } from './db';
import type { Attachment, ClientAccount, Project, Report, Upload } from './models';
import { claimStatements } from './uploads';

export const MAX_TITLE = 160;
export const MAX_DESCRIPTION = 10_000;
export const MAX_MESSAGE = 10_000;
export const MAX_ADJUSTMENT_NOTE = 20_000;
export const MAX_REPORTER_NAME = 50;

/** Kinds of entries in report_events (migration 0006). */
export type EventKind = 'created' | 'message' | 'adjustment' | 'status' | 'claim' | 'release' | 'takeover' | 'handoff';

/** One activity-log row; `report` is the id, or the public_id of a report inserted in the same batch. */
export function eventStatement(db: D1Database, report: { id: number } | { publicId: string }, kind: EventKind, author: Author, at: string, detail: string | null = null): D1PreparedStatement {
    const target = 'id' in report ? '?' : '(SELECT id FROM reports WHERE public_id = ?)';
    return db
        .prepare(`INSERT INTO report_events (report_id, kind, developer_id, client_account_id, actor_name, agent, detail, created_at) VALUES (${target}, ?, ?, ?, ?, ?, ?, ?)`)
        .bind('id' in report ? report.id : report.publicId, kind, author.developerId, author.clientAccountId, author.name ?? '', author.agent ?? null, detail, at);
}

export async function createReport(
    env: Env,
    project: Project,
    data: { title: string; description: string; reporter_name?: string | null; uploads: Upload[]; author?: Author },
    creator: Creator,
    now = Date.now(),
): Promise<{ report: Report; reporterToken: string }> {
    const reporterToken = randomString(48);
    const publicId = crypto.randomUUID();
    const at = nowIso(now);
    const db = env.DB;
    const results = await db.batch([
        db
            .prepare(
                `INSERT INTO reports (project_id, public_id, reporter_token_hash, reporter_name, creator_type, creator_developer_id, creator_client_account_id, creator_agent, title, description, status, latest_activity_at, owner_last_read_at, client_last_read_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?) RETURNING *`,
            )
            .bind(
                project.id,
                publicId,
                await sha256Hex(reporterToken),
                data.reporter_name ?? null,
                creator.creator_type,
                creator.creator_developer_id,
                creator.creator_client_account_id ?? null,
                data.author?.agent ?? null,
                data.title,
                data.description,
                at,
                // Reports from the client side start read for the client; team-created ones for both sides.
                creator.creator_type === 'client' || creator.creator_type === 'public' ? null : at,
                at,
                at,
                at,
            ),
        ...claimStatements(db, data.uploads, {
            reportPublicId: publicId,
            kind: 'feedback',
            nowIso: at,
            author: { developerId: creator.creator_developer_id, clientAccountId: creator.creator_client_account_id ?? null },
        }),
        ...(data.author ? [eventStatement(db, { publicId }, 'created', data.author, at)] : []),
        // A client account's own new report starts read for that account.
        ...(creator.creator_client_account_id
            ? [
                  db
                      .prepare('INSERT OR REPLACE INTO client_reads (client_account_id, report_id, last_read_at) VALUES (?, (SELECT id FROM reports WHERE public_id = ?), ?)')
                      .bind(creator.creator_client_account_id, publicId, at),
              ]
            : []),
    ]);
    return { report: results[0].results[0] as Report, reporterToken };
}

export async function updateReport(
    env: Env,
    report: Report,
    data: { title: string; description: string; uploads: Upload[]; removeAttachmentIds: number[]; author?: Author },
    now = Date.now(),
): Promise<void> {
    const db = env.DB;
    const at = nowIso(now);
    const removed = await removableAttachments(db, report.id, data.removeAttachmentIds, 'feedback');
    await db.batch([
        db.prepare('UPDATE reports SET title = ?, description = ?, latest_activity_at = ?, updated_at = ? WHERE id = ?').bind(data.title, data.description, at, at, report.id),
        ...removed.map((attachment) => db.prepare('DELETE FROM attachments WHERE id = ?').bind(attachment.id)),
        ...claimStatements(db, data.uploads, { reportPublicId: report.public_id, kind: 'feedback', nowIso: at, author: data.author }),
    ]);
    await deleteObjects(env, removed);
}

/** Attachments of the report that may be removed through a given form. */
async function removableAttachments(db: D1Database, reportId: number, ids: number[], kind: 'feedback' | 'adjustment'): Promise<Attachment[]> {
    const unique = [...new Set(ids)].filter((id) => Number.isInteger(id));
    if (unique.length === 0) {
        return [];
    }
    const messageCondition = kind === 'feedback' ? 'AND message_id IS NULL' : '';
    const { results } = await db
        .prepare(`SELECT * FROM attachments WHERE report_id = ? AND kind = ? ${messageCondition} AND id IN (${placeholders(unique.length)})`)
        .bind(reportId, kind, ...unique)
        .all<Attachment>();
    return results;
}

export async function countRemovable(db: D1Database, reportId: number, ids: number[], kind: 'feedback' | 'adjustment'): Promise<{ valid: boolean; remaining: number }> {
    const removable = await removableAttachments(db, reportId, ids, kind);
    const messageCondition = kind === 'feedback' ? 'AND message_id IS NULL' : '';
    const total = await db
        .prepare(`SELECT COUNT(*) AS total FROM attachments WHERE report_id = ? AND kind = ? ${messageCondition}`)
        .bind(reportId, kind)
        .first<{ total: number }>();
    const uniqueRequested = new Set(ids).size;
    return { valid: removable.length === uniqueRequested, remaining: (total?.total ?? 0) - removable.length };
}

async function deleteObjects(env: Env, attachments: Pick<Attachment, 'object_key'>[]): Promise<void> {
    if (attachments.length > 0) {
        await env.FILES.delete(attachments.map((attachment) => attachment.object_key));
    }
}

/** Permanently deletes a report with its messages, attachment rows and stored files. */
export async function deleteReport(env: Env, report: Report): Promise<void> {
    const { results } = await env.DB.prepare('SELECT object_key FROM attachments WHERE report_id = ?').bind(report.id).all<{ object_key: string }>();
    const pending = await env.DB.prepare('SELECT object_key FROM uploads WHERE report_id = ?').bind(report.id).all<{ object_key: string }>();
    await env.DB.prepare('DELETE FROM reports WHERE id = ?').bind(report.id).run();
    await deleteObjects(env, [...results, ...pending.results]);
}

/** Status change shared by the web pages, the API and MCP; completion time and activity time follow the same rule. */
export async function changeStatus(env: Env, report: Report, status: ReportStatus, now = Date.now(), author?: Author): Promise<void> {
    const at = nowIso(now);
    await env.DB.batch([
        env.DB.prepare('UPDATE reports SET status = ?, completed_at = ?, latest_activity_at = ?, updated_at = ? WHERE id = ?').bind(status, status === 'completed' ? at : null, at, at, report.id),
        ...(author && report.status !== status ? [eventStatement(env.DB, report, 'status', author, at, `${report.status}>${status}`)] : []),
    ]);
}

export async function setClientDeleted(env: Env, report: Report, deleted: boolean, now = Date.now()): Promise<void> {
    const at = nowIso(now);
    await env.DB.prepare('UPDATE reports SET client_deleted_at = ?, updated_at = ? WHERE id = ?')
        .bind(deleted ? at : null, at, report.id)
        .run();
}

export async function addMessage(
    env: Env,
    report: Report,
    data: { author_type: 'reporter' | 'owner'; author_name: string | null; body: string; uploads: Upload[]; author?: Author },
    now = Date.now(),
): Promise<void> {
    const db = env.DB;
    const at = nowIso(now);
    const message = await db
        .prepare(
            'INSERT INTO messages (report_id, author_type, author_name, author_client_account_id, author_developer_id, author_agent, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
        )
        .bind(report.id, data.author_type, data.author_name, data.author?.clientAccountId ?? null, data.author?.developerId ?? null, data.author?.agent ?? null, data.body, at, at)
        .first<{ id: number }>();
    if (!message) {
        throw new Error('message insert returned no id');
    }
    try {
        // Attachments point at the message by its own id.
        await db.batch([
            ...claimStatements(db, data.uploads, { reportPublicId: report.public_id, kind: 'feedback', messageId: message.id, nowIso: at, author: data.author }),
            db.prepare('UPDATE reports SET latest_activity_at = ?, updated_at = ? WHERE id = ?').bind(at, at, report.id),
            ...(data.author ? [eventStatement(db, report, 'message', data.author, at)] : []),
        ]);
    } catch (error) {
        await db.prepare('DELETE FROM messages WHERE id = ?').bind(message.id).run();
        throw error;
    }
}

/** Overwrites or appends; blank text is stored as null so the client side shows no empty block. */
export function mergeNote(current: string | null, note: string | null, append: boolean): string | null {
    const next = (note ?? '').trim();
    const existing = (current ?? '').trim();
    let merged: string;
    if (!append || existing === '') {
        merged = next;
    } else if (next === '') {
        merged = existing;
    } else {
        merged = `${existing}\n\n${next}`;
    }
    return merged === '' ? null : merged;
}

/**
 * Writes the adjustment note and images. Leaves the status alone. When `note` is undefined the text
 * is kept as it is.
 */
export async function updateAdjustment(
    env: Env,
    report: Report,
    data: { note?: string | null; append?: boolean; uploads: Upload[]; removeAttachmentIds: number[]; author?: Author },
    now = Date.now(),
): Promise<void> {
    const db = env.DB;
    const at = nowIso(now);
    const removed = await removableAttachments(db, report.id, data.removeAttachmentIds, 'adjustment');
    const note = data.note !== undefined ? mergeNote(report.adjustment_note, data.note, data.append ?? false) : report.adjustment_note;
    // Only a real change shows the client "有新回覆"; saving the same text again does not.
    const changed = note !== report.adjustment_note || removed.length > 0 || data.uploads.length > 0;
    const changedAt = changed ? at : report.adjustment_updated_at;
    const statements: D1PreparedStatement[] = [
        data.note !== undefined
            ? db.prepare('UPDATE reports SET adjustment_note = ?, adjustment_updated_at = ?, latest_activity_at = ?, updated_at = ? WHERE id = ?').bind(note, changedAt, at, at, report.id)
            : db.prepare('UPDATE reports SET adjustment_updated_at = ?, latest_activity_at = ?, updated_at = ? WHERE id = ?').bind(changedAt, at, at, report.id),
    ];
    statements.push(...removed.map((attachment) => db.prepare('DELETE FROM attachments WHERE id = ?').bind(attachment.id)));
    statements.push(...claimStatements(db, data.uploads, { reportPublicId: report.public_id, kind: 'adjustment', nowIso: at, author: data.author }));
    if (data.author && changed) {
        statements.push(eventStatement(db, report, 'adjustment', data.author, at));
    }
    await db.batch(statements);
    await deleteObjects(env, removed);
}

/** Message author types written by the team side (people and AI agents). */
export const TEAM_AUTHOR_TYPES = "('owner', 'agent')";

/**
 * SQL for the number of client messages the team has not seen. `table` is the alias of the reports
 * row in the surrounding query. Team and AI messages never count.
 */
export function unreadMessagesSql(table: string): string {
    return `(SELECT COUNT(*) FROM messages um WHERE um.report_id = ${table}.id AND um.author_type = 'reporter'
        AND (${table}.owner_last_read_at IS NULL OR um.created_at > ${table}.owner_last_read_at))`;
}

/** SQL condition: the report has at least one client message the team has not seen. */
export function hasUnreadMessagesSql(table: string): string {
    return `EXISTS (SELECT 1 FROM messages um WHERE um.report_id = ${table}.id AND um.author_type = 'reporter'
        AND (${table}.owner_last_read_at IS NULL OR um.created_at > ${table}.owner_last_read_at))`;
}

/**
 * Whose client-side read state applies: a signed-in client account (each has its own), or null for
 * the shared client side (entry link, single-report and public reporters).
 */
export type ClientViewer = Pick<ClientAccount, 'id' | 'created_at'> | null;

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * SQL for when the client viewer last opened the report (NULL: never). A client account that has
 * not opened a report yet counts everything before the account existed as read, so a new account
 * does not start with every old reply lit up. Values are numbers and checked timestamps from the
 * database, never user input, so they are inlined.
 */
export function clientReadAtSql(table: string, viewer: ClientViewer): string {
    if (!viewer) {
        return `${table}.client_last_read_at`;
    }
    if (!Number.isInteger(viewer.id) || !ISO_TIME.test(viewer.created_at)) {
        throw new Error('invalid client viewer');
    }
    return `COALESCE((SELECT cr.last_read_at FROM client_reads cr WHERE cr.client_account_id = ${viewer.id} AND cr.report_id = ${table}.id), '${viewer.created_at}')`;
}

/** SQL for the number of team (and AI) messages the client viewer has not seen. */
export function clientUnreadRepliesSql(table: string, viewer: ClientViewer = null): string {
    const readAt = clientReadAtSql(table, viewer);
    return `(SELECT COUNT(*) FROM messages rm WHERE rm.report_id = ${table}.id AND rm.author_type IN ${TEAM_AUTHOR_TYPES}
        AND (${readAt} IS NULL OR rm.created_at > ${readAt}))`;
}

/** SQL: 1 when the adjustment note or images changed after the client viewer last opened the report. */
export function adjustmentNewForClientSql(table: string, viewer: ClientViewer = null): string {
    const readAt = clientReadAtSql(table, viewer);
    return `(CASE WHEN ${table}.adjustment_updated_at IS NOT NULL AND (${readAt} IS NULL OR ${table}.adjustment_updated_at > ${readAt}) THEN 1 ELSE 0 END)`;
}

/**
 * SQL for the unread count on the chat buttons and in the chat panel: client messages for the team
 * (shared by the whole team); team messages for the client viewer, plus 1 when the adjustment changed.
 */
export function viewerUnreadSql(table: string, isOwner: boolean, viewer: ClientViewer = null): string {
    return isOwner ? unreadMessagesSql(table) : `(${clientUnreadRepliesSql(table, viewer)} + ${adjustmentNewForClientSql(table, viewer)})`;
}

/** When the client viewer last opened the report (null: never), for checks outside SQL. */
export async function clientReadAt(db: D1Database, report: Pick<Report, 'id' | 'client_last_read_at'>, viewer: ClientViewer): Promise<string | null> {
    if (!viewer) {
        return report.client_last_read_at;
    }
    const row = await db.prepare('SELECT last_read_at FROM client_reads WHERE client_account_id = ? AND report_id = ?').bind(viewer.id, report.id).first<{ last_read_at: string }>();
    return row?.last_read_at ?? viewer.created_at;
}

/** SQL for the current name of the client account that created the report (NULL without one). */
export function creatorClientNameSql(table: string): string {
    return `(SELECT cca.name FROM client_accounts cca WHERE cca.id = ${table}.creator_client_account_id)`;
}

/** SQL for the number of messages on the report. */
export function messagesCountSql(table: string): string {
    return `(SELECT COUNT(*) FROM messages cm WHERE cm.report_id = ${table}.id)`;
}

/**
 * ORDER BY terms of the default order shared by the chat panel, the portal list and the board
 * (src/shared/conversation.ts compareConversations is the same rule): unread first, then reports
 * with messages, both by the newest message; reports without messages last by creation time; ties
 * by the newer number. Times compare in whole seconds like the Laravel version. Arguments are
 * column names of the surrounding query.
 */
export function conversationOrderSql(columns: { unread: string; messagesCount: string; latestMessageAt: string; createdAt: string; number: string }): string {
    const tier = `(CASE WHEN ${columns.unread} > 0 THEN 2 WHEN ${columns.messagesCount} > 0 THEN 1 ELSE 0 END)`;
    const time = `substr(CASE WHEN ${tier} > 0 AND ${columns.latestMessageAt} IS NOT NULL THEN ${columns.latestMessageAt} ELSE ${columns.createdAt} END, 1, 19)`;
    return `${tier} DESC, ${time} DESC, ${columns.number} ASC`;
}

/** Unread count (for this viewer side) and message count of one report, for its chat button. */
export async function chatCounts(db: D1Database, report: Pick<Report, 'id'>, isOwner: boolean, viewer: ClientViewer = null): Promise<{ unread: number; messagesCount: number }> {
    const row = await db
        .prepare(`SELECT ${viewerUnreadSql('r', isOwner, viewer)} AS unread, ${messagesCountSql('r')} AS messages_count FROM reports r WHERE r.id = ?`)
        .bind(report.id)
        .first<{ unread: number; messages_count: number }>();
    return { unread: row?.unread ?? 0, messagesCount: row?.messages_count ?? 0 };
}

/** SQL for the time of the newest message on the report (NULL without messages). */
export function latestMessageSql(table: string): string {
    return `(SELECT MAX(lm.created_at) FROM messages lm WHERE lm.report_id = ${table}.id)`;
}

/**
 * Marks the report as read by the team or by the client side. Only the read time changes, so the
 * activity time, the ETag and the list order stay as they are. A client account also gets its own
 * read time; the shared client time still moves (entry-link viewers use it, and it moves the
 * client chat version so other client accounts' panels refresh).
 */
export async function markRead(env: Env, report: Pick<Report, 'id'>, side: 'owner' | 'client', now = Date.now(), viewer: ClientViewer = null): Promise<void> {
    const at = nowIso(now);
    if (side === 'owner') {
        await env.DB.prepare('UPDATE reports SET owner_last_read_at = ? WHERE id = ?').bind(at, report.id).run();
        return;
    }
    const statements = [env.DB.prepare('UPDATE reports SET client_last_read_at = ? WHERE id = ?').bind(at, report.id)];
    if (viewer) {
        statements.push(
            env.DB.prepare(
                'INSERT INTO client_reads (client_account_id, report_id, last_read_at) VALUES (?, ?, ?) ON CONFLICT (client_account_id, report_id) DO UPDATE SET last_read_at = excluded.last_read_at',
            ).bind(viewer.id, report.id, at),
        );
    }
    await env.DB.batch(statements);
}

/** Status value => number of reports in the whole project. */
export async function statusCounts(
    db: D1Database,
    projectId: number,
    options: { includeClientDeleted: boolean; clientCreatedOnly: boolean },
): Promise<Record<ReportStatus, number>> {
    const conditions = ['project_id = ?'];
    if (options.clientCreatedOnly) {
        conditions.push("creator_type = 'client'");
    }
    if (!options.includeClientDeleted) {
        conditions.push('client_deleted_at IS NULL');
    }
    const { results } = await db
        .prepare(`SELECT status, COUNT(*) AS aggregate FROM reports WHERE ${conditions.join(' AND ')} GROUP BY status`)
        .bind(projectId)
        .all<{ status: string; aggregate: number }>();
    const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<ReportStatus, number>;
    for (const row of results) {
        if ((STATUSES as readonly string[]).includes(row.status)) {
            counts[row.status as ReportStatus] = row.aggregate;
        }
    }
    return counts;
}

/** Number shown in lists: 1 is the newest. Client numbering counts only client-created reports. */
export async function sequenceNumber(db: D1Database, report: Report, clientCreatedOnly: boolean): Promise<number> {
    const row = await db
        .prepare(
            `SELECT COUNT(*) AS position FROM reports WHERE project_id = ? ${clientCreatedOnly ? "AND creator_type = 'client'" : ''}
             AND (created_at > ? OR (created_at = ? AND id >= ?))`,
        )
        .bind(report.project_id, report.created_at, report.created_at, report.id)
        .first<{ position: number }>();
    return row?.position ?? 0;
}

/** Finds a report by public_id, or by the team-side list number when the identifier is all digits. */
export async function findInProject(db: D1Database, project: Project, identifier: string): Promise<Report | null> {
    const trimmed = identifier.trim();
    if (/^\d+$/.test(trimmed)) {
        const position = Number(trimmed);
        if (position < 1) {
            return null;
        }
        return db
            .prepare('SELECT * FROM reports WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET ?')
            .bind(project.id, position - 1)
            .first<Report>();
    }
    return db.prepare('SELECT * FROM reports WHERE project_id = ? AND public_id = ?').bind(project.id, trimmed).first<Report>();
}

/** Creator name shown to the team. */
export function creatorLabel(
    env: Env,
    report: Pick<Report, 'creator_type' | 'reporter_name'>,
    project: Pick<Project, 'client_display_name'>,
    developerName: string | null,
    clientAccountName: string | null = null,
): string {
    const labels = config(env).labels;
    switch (report.creator_type) {
        case 'client':
            return clientAccountName ?? clientLabel(env, project);
        case 'developer':
            return developerName ?? labels.owner;
        case 'public':
            return report.reporter_name ? `公開回報（${report.reporter_name}）` : '公開回報';
        default:
            return labels.owner;
    }
}

export function clientLabel(env: Env, project: Pick<Project, 'client_display_name'>): string {
    return project.client_display_name && project.client_display_name.trim() !== '' ? project.client_display_name : config(env).labels.client;
}

/** Author name stored on a new message (pages show the account's current name when one is linked). */
export function messageAuthorName(env: Env, report: Report, isOwner: boolean, developerName: string | null, clientAccountName: string | null = null): string {
    const labels = config(env).labels;
    if (isOwner) {
        return report.creator_type === 'public' ? labels.owner : developerName ?? labels.owner;
    }
    if (report.creator_type === 'public') {
        return report.reporter_name || '公開回報者';
    }
    return clientAccountName ?? labels.client;
}
