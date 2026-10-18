import type { ReportStatus } from '../../shared/status';
import { STATUSES } from '../../shared/status';
import { nowIso } from '../../shared/time';
import type { Env } from '../env';
import { config } from '../env';
import type { Creator } from './access';
import { randomString, sha256Hex } from './crypto';
import { placeholders } from './db';
import type { Attachment, Project, Report, Upload } from './models';
import { claimStatements } from './uploads';

export const MAX_TITLE = 160;
export const MAX_DESCRIPTION = 10_000;
export const MAX_MESSAGE = 10_000;
export const MAX_ADJUSTMENT_NOTE = 20_000;
export const MAX_REPORTER_NAME = 50;

export async function createReport(
    env: Env,
    project: Project,
    data: { title: string; description: string; reporter_name?: string | null; uploads: Upload[] },
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
                `INSERT INTO reports (project_id, public_id, reporter_token_hash, reporter_name, creator_type, creator_developer_id, title, description, status, latest_activity_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?) RETURNING *`,
            )
            .bind(
                project.id,
                publicId,
                await sha256Hex(reporterToken),
                data.reporter_name ?? null,
                creator.creator_type,
                creator.creator_developer_id,
                data.title,
                data.description,
                at,
                at,
                at,
            ),
        ...claimStatements(db, data.uploads, { reportPublicId: publicId, kind: 'feedback', nowIso: at }),
    ]);
    return { report: results[0].results[0] as Report, reporterToken };
}

export async function updateReport(
    env: Env,
    report: Report,
    data: { title: string; description: string; uploads: Upload[]; removeAttachmentIds: number[] },
    now = Date.now(),
): Promise<void> {
    const db = env.DB;
    const at = nowIso(now);
    const removed = await removableAttachments(db, report.id, data.removeAttachmentIds, 'feedback');
    await db.batch([
        db.prepare('UPDATE reports SET title = ?, description = ?, latest_activity_at = ?, updated_at = ? WHERE id = ?').bind(data.title, data.description, at, at, report.id),
        ...removed.map((attachment) => db.prepare('DELETE FROM attachments WHERE id = ?').bind(attachment.id)),
        ...claimStatements(db, data.uploads, { reportPublicId: report.public_id, kind: 'feedback', nowIso: at }),
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
export async function changeStatus(env: Env, report: Report, status: ReportStatus, now = Date.now()): Promise<void> {
    const at = nowIso(now);
    await env.DB.prepare('UPDATE reports SET status = ?, completed_at = ?, latest_activity_at = ?, updated_at = ? WHERE id = ?')
        .bind(status, status === 'completed' ? at : null, at, at, report.id)
        .run();
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
    data: { author_type: 'reporter' | 'owner'; author_name: string | null; body: string; uploads: Upload[] },
    now = Date.now(),
): Promise<void> {
    const db = env.DB;
    const at = nowIso(now);
    await db.batch([
        db.prepare('INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(report.id, data.author_type, data.author_name, data.body, at, at),
        ...claimStatements(db, data.uploads, { reportPublicId: report.public_id, kind: 'feedback', messageSubquery: true, nowIso: at }),
        db.prepare('UPDATE reports SET latest_activity_at = ?, updated_at = ? WHERE id = ?').bind(at, at, report.id),
    ]);
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
    data: { note?: string | null; append?: boolean; uploads: Upload[]; removeAttachmentIds: number[] },
    now = Date.now(),
): Promise<void> {
    const db = env.DB;
    const at = nowIso(now);
    const removed = await removableAttachments(db, report.id, data.removeAttachmentIds, 'adjustment');
    const statements: D1PreparedStatement[] = [];
    if (data.note !== undefined) {
        statements.push(
            db.prepare('UPDATE reports SET adjustment_note = ?, latest_activity_at = ?, updated_at = ? WHERE id = ?').bind(mergeNote(report.adjustment_note, data.note, data.append ?? false), at, at, report.id),
        );
    } else {
        statements.push(db.prepare('UPDATE reports SET latest_activity_at = ?, updated_at = ? WHERE id = ?').bind(at, at, report.id));
    }
    statements.push(...removed.map((attachment) => db.prepare('DELETE FROM attachments WHERE id = ?').bind(attachment.id)));
    statements.push(...claimStatements(db, data.uploads, { reportPublicId: report.public_id, kind: 'adjustment', nowIso: at }));
    await db.batch(statements);
    await deleteObjects(env, removed);
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
): string {
    const labels = config(env).labels;
    switch (report.creator_type) {
        case 'client':
            return clientLabel(env, project);
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

/** Author name stored on a new message. */
export function messageAuthorName(env: Env, report: Report, isOwner: boolean, developerName: string | null): string {
    const labels = config(env).labels;
    if (isOwner) {
        return report.creator_type === 'public' ? labels.owner : developerName ?? labels.owner;
    }
    if (report.creator_type === 'public') {
        return report.reporter_name || '公開回報者';
    }
    return labels.client;
}
