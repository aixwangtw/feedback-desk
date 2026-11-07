/**
 * 待審留言（草稿）的新增、修改、送出、捨棄；API（CLI）、排程 API、網頁共用。
 * 草稿只存在 message_drafts，送出前不會建立任何留言或附件紀錄，客戶端讀不到、也不算未讀，
 * 草稿本身也不改狀態。送出時才照一般留言流程（含留言自動切狀態）。
 */
import { charLength } from '../../shared/text';
import { nowIso } from '../../shared/time';
import type { Env } from '../env';
import type { Author } from './access';
import type { Report, Upload } from './models';
import {
    addMessage,
    eventStatement,
    markRead,
    MAX_MESSAGE,
    messageAuthorName,
    parseStoredFiles,
    statusRuleStatements,
    storedFileStatements,
    type StoredFile,
} from './reports';
import { ServiceError } from './team';
import type { ReportStatus } from '../../shared/status';

export interface MessageDraft {
    id: number;
    report_id: number;
    replaces_message_id: number | null;
    author_developer_id: number | null;
    author_name: string;
    author_agent: string | null;
    body: string;
    attachments: string | null;
    created_at: string;
    updated_at: string;
}

/** A draft as the team's report page shows it. */
export interface DraftView extends MessageDraft {
    /** Current name of the account that wrote it (falls back to the stored name). */
    display_author: string;
    /** Body of the team message it will replace, when it is a replacement. */
    replaces_body: string | null;
    files: StoredFile[];
}

export function validatedDraftBody(body: string): string {
    const trimmed = (body ?? '').trim();
    if (trimmed === '') {
        throw new ServiceError('empty_body', '待審留言內容不能空白。', 422);
    }
    if (charLength(trimmed) > MAX_MESSAGE) {
        throw new ServiceError('body_too_long', `留言內容不能超過 ${MAX_MESSAGE} 字。`, 422);
    }
    return trimmed;
}

/** Only a team message (people or AI) on this report can be replaced; client messages never. */
export async function replaceableMessage(db: D1Database, report: Pick<Report, 'id'>, messageId: number): Promise<{ id: number; body: string }> {
    const message = Number.isSafeInteger(messageId)
        ? await db.prepare("SELECT id, body FROM messages WHERE id = ? AND report_id = ? AND deleted_at IS NULL AND author_type IN ('owner', 'agent')").bind(messageId, report.id).first<{ id: number; body: string }>()
        : null;
    if (!message) {
        throw new ServiceError('message_not_replaceable', '要修改的留言必須是這張單上的團隊留言。', 422);
    }
    return message;
}

/** replace_message_id from JSON or a form: a positive integer (or its digits), else a 422. */
export function parseReplaceMessageId(value: unknown): number | null {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return value;
    }
    if (typeof value === 'string' && /^\d{1,15}$/.test(value.trim())) {
        return Number(value.trim());
    }
    throw new ServiceError('message_not_replaceable', 'replace_message_id 要填留言 id（數字）。', 422);
}

/**
 * Stores a draft. Uploaded images move from `uploads` into the draft's JSON (the R2 objects stay
 * where they are), so the cleanup job no longer sees them as unclaimed.
 */
export async function createDraft(
    env: Env,
    report: Report,
    data: { body: string; replacesMessageId: number | null; uploads: Upload[]; author: Author },
    now = Date.now(),
): Promise<MessageDraft> {
    const body = validatedDraftBody(data.body);
    if (data.replacesMessageId !== null) {
        await replaceableMessage(env.DB, report, data.replacesMessageId);
    }
    const at = nowIso(now);
    const files: StoredFile[] = data.uploads.map((upload) => ({ object_key: upload.object_key, original_name: upload.original_name, mime_type: upload.mime_type, size: upload.size }));
    const db = env.DB;
    const [inserted] = await db.batch([
        db
            .prepare(
                'INSERT INTO message_drafts (report_id, replaces_message_id, author_developer_id, author_name, author_agent, body, attachments, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
            )
            .bind(report.id, data.replacesMessageId, data.author.developerId, (data.author.name ?? '').slice(0, 100) || '開發團隊', data.author.agent ?? null, body, files.length > 0 ? JSON.stringify(files) : null, at, at),
        ...data.uploads.map((upload) => db.prepare('DELETE FROM uploads WHERE id = ?').bind(upload.id)),
        eventStatement(db, report, 'draft', data.author, at),
    ]);
    return inserted.results[0] as MessageDraft;
}

/** Drafts of a report for the team's page, oldest first. One query. */
export async function draftsForReport(db: D1Database, reportId: number): Promise<DraftView[]> {
    const { results } = await db
        .prepare(
            `SELECT md.*, COALESCE(d.name, md.author_name) AS display_author, m.body AS replaces_body
             FROM message_drafts md
             LEFT JOIN developers d ON d.id = md.author_developer_id
             LEFT JOIN messages m ON m.id = md.replaces_message_id
             WHERE md.report_id = ? ORDER BY md.id`,
        )
        .bind(reportId)
        .all<MessageDraft & { display_author: string; replaces_body: string | null }>();
    return results.map((row) => ({ ...row, files: parseStoredFiles(row.attachments) }));
}

export async function findDraft(db: D1Database, report: Pick<Report, 'id'>, draftId: string | number): Promise<MessageDraft | null> {
    const id = Number(draftId);
    if (!Number.isSafeInteger(id) || id < 1) {
        return null;
    }
    return db.prepare('SELECT * FROM message_drafts WHERE id = ? AND report_id = ?').bind(id, report.id).first<MessageDraft>();
}

export async function updateDraft(env: Env, draft: MessageDraft, body: string, now = Date.now()): Promise<void> {
    await env.DB.prepare('UPDATE message_drafts SET body = ?, updated_at = ? WHERE id = ?').bind(validatedDraftBody(body), nowIso(now), draft.id).run();
}

/**
 * 送出：一般草稿照現行留言流程新增一則（作者＝按送出的人、時間＝現在，客戶端出現未讀，
 * 草稿寫的 AI 工具名稱保留）；修改原留言型的草稿改寫原留言內容，不新增一則，原留言時間不變。
 * 兩種都套用留言自動切狀態。editedBody 是送出前在畫面上改過的文字（對話面板），有給就以它為準。
 */
export async function sendDraft(
    env: Env,
    report: Report,
    draft: MessageDraft,
    sender: { author: Author; developerName: string | null },
    now = Date.now(),
    editedBody: string | null = null,
): Promise<{ replaced: boolean; status: ReportStatus; statusChanged: boolean }> {
    if (editedBody !== null) {
        // 送出前在畫面上改過的文字（右下角對話面板）以它為準；空白照樣拒絕，草稿保留。
        draft = { ...draft, body: validatedDraftBody(editedBody) };
    }
    const db = env.DB;
    const author: Author = { ...sender.author, agent: draft.author_agent };
    const files = parseStoredFiles(draft.attachments);
    const deleteDraft = db.prepare('DELETE FROM message_drafts WHERE id = ?').bind(draft.id);
    if (draft.replaces_message_id === null) {
        const result = await addMessage(
            env,
            report,
            { author_type: 'owner', author_name: messageAuthorName(env, report, true, sender.developerName), body: draft.body, uploads: [], storedFiles: files, author, extraStatements: [deleteDraft] },
            now,
        );
        await markRead(env, report, 'owner', now);
        return { replaced: false, status: result.status, statusChanged: result.statusChanged };
    }
    const original = await replaceableMessage(db, report, draft.replaces_message_id);
    const at = nowIso(now);
    const rule = statusRuleStatements(db, report, true, at, author);
    await db.batch([
        db.prepare('UPDATE messages SET body = ?, updated_at = ? WHERE id = ?').bind(draft.body, at, original.id),
        ...storedFileStatements(db, report.id, original.id, files, at, author),
        db.prepare('UPDATE reports SET latest_activity_at = ?, updated_at = ? WHERE id = ?').bind(at, at, report.id),
        eventStatement(db, report, 'message_edit', author, at),
        ...rule.statements,
        deleteDraft,
    ]);
    await markRead(env, report, 'owner', now);
    return { replaced: true, status: rule.next ?? report.status, statusChanged: rule.next !== null };
}

/** 捨棄：刪除草稿與它的附圖。 */
export async function discardDraft(env: Env, draft: MessageDraft): Promise<void> {
    await env.DB.prepare('DELETE FROM message_drafts WHERE id = ?').bind(draft.id).run();
    const files = parseStoredFiles(draft.attachments);
    if (files.length > 0) {
        await env.FILES.delete(files.map((file) => file.object_key));
    }
}
