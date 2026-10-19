/**
 * Operations performed by a signed-in team account through the API (CLI) or MCP. Both callers go
 * through these functions, so the rules match the web pages and each other.
 */
import { CREATOR_FILTER_PATTERN, describedStatusOptions, statusFromInput, statusLabel, type ReportStatus } from '../../shared/status';
import { charLength, slugify } from '../../shared/text';
import { formatAbsolute, nowIso } from '../../shared/time';
import { config, type Env } from '../env';
import { hashPassword, randomString, sha256Hex } from './crypto';
import {
    attachmentsForReport,
    findClientAccount,
    findClientAccountInProject,
    findDeveloper,
    findDeveloperByUsername,
    findProjectBySlug,
    listClientAccounts,
    listDevelopers,
    messagesForReport,
    placeholders,
    usernameTaken,
} from './db';
import type { Attachment, ClientAccount, Developer, Project, Report } from './models';
import {
    addMessage,
    changeStatus,
    createReport,
    creatorLabel,
    eventStatement,
    findInProject,
    latestMessageSql,
    MAX_ADJUSTMENT_NOTE,
    MAX_DESCRIPTION,
    MAX_MESSAGE,
    MAX_TITLE,
    mergeNote,
    messageAuthorName,
    sequenceNumber,
    unreadMessagesSql,
    updateAdjustment,
} from './reports';
import { signedAttachmentUrl } from './signed';
import type { Author } from './access';
import { withAgent } from './agents';
import { findClaimableUploads } from './uploads';
import { paths } from '../routes/paths';

export class ServiceError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly status: 400 | 403 | 404 | 409 | 422 = 400,
    ) {
        super(message);
    }
}

export interface TeamContext {
    env: Env;
    origin: string;
    developer: Developer;
    now: number;
    /** AI tool making the request ('Claude Code', 'Codex'), from the token or the CLI; null otherwise. */
    agent?: string | null;
}

/** The team account (and AI tool) for the account columns and the activity log. */
export function teamAuthor(ctx: TeamContext): Author {
    return { developerId: ctx.developer.id, clientAccountId: null, name: ctx.developer.name, agent: ctx.agent ?? null };
}

const GENERATED_PASSWORD_LENGTH = 24;

/** Shown whenever someone other than the holder tries to replace a password the holder chose. */
export const SELF_SET_PASSWORD_LOCKED =
    '這個帳號的密碼是本人自己設定的，其他人不能重設或改掉。本人登入網頁後可以自己改；本人忘記密碼時，請掌握 Cloudflare 帳號的部署者在終端機執行 account recover。';

/**
 * Statements that end every API credential of a team account: its tokens, and CLI logins that
 * were approved in the browser but have not picked up their token yet. Web logins end on their
 * own because their cookies are bound to the password hash.
 */
export function revokeDeveloperCredentials(db: D1Database, developerId: number): D1PreparedStatement[] {
    return [
        db.prepare('DELETE FROM api_tokens WHERE developer_id = ?').bind(developerId),
        db.prepare("UPDATE device_codes SET status = 'denied' WHERE developer_id = ? AND status = 'approved'").bind(developerId),
    ];
}

export async function projectOrFail(env: Env, slug: string): Promise<Project> {
    const project = await findProjectBySlug(env.DB, slug);
    if (!project) {
        throw new ServiceError('project_not_found', '找不到回報專案。', 404);
    }
    return project;
}

/** public_id, or the team-side list number when all digits; `byId` takes the database id instead. */
export async function resolveReport(env: Env, project: Project, identifier: string, mode: 'auto' | 'public_id' | 'id' = 'auto'): Promise<Report> {
    const trimmed = identifier.trim();
    let report: Report | null;
    if (mode === 'id') {
        report = /^\d+$/.test(trimmed)
            ? await env.DB.prepare('SELECT * FROM reports WHERE project_id = ? AND id = ?').bind(project.id, Number(trimmed)).first<Report>()
            : null;
    } else if (mode === 'public_id') {
        if (/^\d+$/.test(trimmed)) {
            throw new ServiceError('number_not_allowed', '純數字不能直接指定回饋單：請改用 public_id（或加 --by-id 指定資料庫 id）。', 422);
        }
        report = await env.DB.prepare('SELECT * FROM reports WHERE project_id = ? AND public_id = ?').bind(project.id, trimmed).first<Report>();
    } else {
        report = await findInProject(env.DB, project, trimmed);
    }
    if (!report) {
        throw new ServiceError('report_not_found', '這個專案裡找不到該回饋單（請用 public_id 或團隊端清單編號）。', 404);
    }
    return report;
}

function absolute(ctx: TeamContext, path: string): string {
    return `${ctx.origin}${path}`;
}

// ------------------------------------------------------------------ reports

export interface ListFilters {
    statuses?: string[];
    creator?: string;
    includeDeleted?: boolean;
    /** Public reports come from strangers; they are left out unless asked for. */
    includePublic?: boolean;
    /** Only reports with client messages the team has not read on the web yet. */
    unread?: boolean;
}

export async function listReports(ctx: TeamContext, slug: string, filters: ListFilters) {
    const project = await projectOrFail(ctx.env, slug);
    const statuses: ReportStatus[] = [];
    for (const input of filters.statuses ?? []) {
        const status = statusFromInput(input);
        if (!status) {
            throw new ServiceError('invalid_status', `不認得的狀態「${input}」。可用值：${describedStatusOptions()}`, 422);
        }
        statuses.push(status);
    }
    const creator = filters.creator ?? '';
    if (creator !== '' && !CREATOR_FILTER_PATTERN.test(creator)) {
        throw new ServiceError('invalid_creator', '不認得的建立者。可用值：client、public、shared、developer:{id}', 422);
    }
    const conditions: string[] = [];
    const bindings: unknown[] = [];
    if (statuses.length > 0) {
        conditions.push(`status IN (${placeholders(statuses.length)})`);
        bindings.push(...statuses);
    }
    if (creator === 'client') conditions.push("creator_type = 'client'");
    if (creator === 'public') conditions.push("creator_type = 'public'");
    if (creator === 'shared') conditions.push("creator_type = 'owner_shared'");
    if (creator.startsWith('developer:')) {
        conditions.push("creator_type = 'developer' AND creator_developer_id = ?");
        bindings.push(Number(creator.slice('developer:'.length)));
    }
    if (creator.startsWith('client:')) {
        conditions.push("creator_type = 'client' AND creator_client_account_id = ?");
        bindings.push(Number(creator.slice('client:'.length)));
    }
    if (!filters.includeDeleted) conditions.push('client_deleted_at IS NULL');
    if (filters.unread) conditions.push('unread_messages_count > 0');
    const includePublic = filters.includePublic === true || creator === 'public';
    if (!includePublic) conditions.push("creator_type <> 'public'");
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { results } = await ctx.env.DB.prepare(
        `WITH numbered AS (
            SELECT r.*,
                ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS number,
                CASE WHEN creator_type = 'client' THEN ROW_NUMBER() OVER (PARTITION BY creator_type = 'client' ORDER BY created_at DESC, id DESC) END AS client_number,
                (SELECT COUNT(*) FROM messages m WHERE m.report_id = r.id) AS messages_count,
                (SELECT COUNT(*) FROM attachments a WHERE a.report_id = r.id) AS attachments_count,
                ${unreadMessagesSql('r')} AS unread_messages_count,
                ${latestMessageSql('r')} AS latest_message_at
            FROM reports r WHERE project_id = ?
        )
        SELECT n.*, d.name AS developer_name, ca.name AS client_account_name, cd.name AS claimed_name FROM numbered n
        LEFT JOIN developers d ON d.id = n.creator_developer_id
        LEFT JOIN client_accounts ca ON ca.id = n.creator_client_account_id
        LEFT JOIN developers cd ON cd.id = n.claimed_by_developer_id ${where}
        ORDER BY created_at DESC, id DESC`,
    )
        .bind(project.id, ...bindings)
        .all<Report & { number: number; client_number: number | null; messages_count: number; attachments_count: number; unread_messages_count: number; latest_message_at: string | null; developer_name: string | null; client_account_name: string | null; claimed_name: string | null }>();
    return {
        project: project.slug,
        include_public: includePublic,
        unread_only: filters.unread === true,
        reports: results.map((report) => ({
            number: report.number,
            client_number: report.client_number,
            public_id: report.public_id,
            status: report.status,
            status_label: statusLabel(report.status),
            creator_type: report.creator_type,
            creator: withAgent(creatorLabel(ctx.env, report, project, report.developer_name, report.client_account_name), report.creator_agent),
            claimed_by: report.claimed_at && report.claimed_name ? withAgent(report.claimed_name, report.claimed_agent) : null,
            source: report.creator_type === 'public' ? 'public_stranger' : 'project_member',
            title: report.title,
            messages_count: report.messages_count,
            unread_messages_count: report.unread_messages_count,
            latest_message_at: report.latest_message_at,
            attachments_count: report.attachments_count,
            deleted_by_client: report.client_deleted_at !== null,
            latest_activity_at: report.latest_activity_at,
        })),
    };
}

async function attachmentData(ctx: TeamContext, attachments: Attachment[]) {
    return Promise.all(
        attachments.map(async (attachment) => ({
            id: attachment.id,
            original_name: attachment.original_name,
            mime_type: attachment.mime_type,
            size: attachment.size,
            url: await signedAttachmentUrl(ctx.env, ctx.origin, attachment.id, ctx.now),
        })),
    );
}

export async function getReport(ctx: TeamContext, slug: string, identifier: string, mode: 'auto' | 'public_id' | 'id' = 'auto') {
    const project = await projectOrFail(ctx.env, slug);
    const report = await resolveReport(ctx.env, project, identifier, mode);
    const [attachments, messages, developer, clientAccount] = await Promise.all([
        attachmentsForReport(ctx.env.DB, report.id),
        messagesForReport(ctx.env.DB, report.id),
        report.creator_developer_id ? findDeveloper(ctx.env.DB, report.creator_developer_id) : Promise.resolve(null),
        report.creator_client_account_id ? findClientAccount(ctx.env.DB, report.creator_client_account_id) : Promise.resolve(null),
    ]);
    const labels = config(ctx.env).labels;
    return {
        number: await sequenceNumber(ctx.env.DB, report, false),
        client_number: report.creator_type === 'client' ? await sequenceNumber(ctx.env.DB, report, true) : null,
        public_id: report.public_id,
        project: project.slug,
        title: report.title,
        status: report.status,
        status_label: statusLabel(report.status),
        creator_type: report.creator_type,
        creator: withAgent(creatorLabel(ctx.env, report, project, developer?.name ?? null, clientAccount?.name ?? null), report.creator_agent),
        source: report.creator_type === 'public' ? 'public_stranger' : 'project_member',
        deleted_by_client: report.client_deleted_at !== null,
        ...(await workState(ctx, report)),
        created_at: report.created_at,
        updated_at: report.updated_at,
        latest_activity_at: report.latest_activity_at,
        page_url: report.page_url,
        url: absolute(ctx, paths.report(project.slug, report.public_id)),
        description: report.description,
        attachments: await attachmentData(ctx, attachments.filter((a) => a.message_id === null && a.kind === 'feedback')),
        adjustment_note: report.adjustment_note,
        adjustment_attachments: await attachmentData(ctx, attachments.filter((a) => a.kind === 'adjustment')),
        messages: await Promise.all(
            messages.map(async (message) => ({
                author_type: message.author_type,
                author: withAgent(message.author_name || (message.author_type === 'owner' ? labels.owner : message.author_type === 'agent' ? 'Vibe coding' : labels.client), message.author_agent),
                created_at: message.created_at,
                body: message.body,
                attachments: await attachmentData(ctx, attachments.filter((a) => a.message_id === message.id)),
            })),
        ),
    };
}

export async function setReportStatus(ctx: TeamContext, slug: string, identifier: string, statusInput: string, options: { force?: boolean } = {}) {
    const project = await projectOrFail(ctx.env, slug);
    const status = statusFromInput(statusInput);
    if (!status) {
        throw new ServiceError('invalid_status', `不認得的狀態。可用值：${describedStatusOptions()}`, 422);
    }
    const report = await resolveReport(ctx.env, project, identifier);
    const takenOver = await guardClaim(ctx, report, options.force === true);
    await changeStatus(ctx.env, report, status, ctx.now, teamAuthor(ctx));
    return {
        public_id: report.public_id,
        title: report.title,
        previous: { status: report.status, label: statusLabel(report.status) },
        current: { status, label: statusLabel(status) },
        took_over_from: takenOver,
    };
}

// ------------------------------------------------------------------ claims and handoff notes

const MAX_HANDOFF_NOTE = 5_000;
const HANDOFF_NOTES_SHOWN = 5;
const EVENTS_SHOWN = 20;

interface ClaimHolder {
    developer_id: number;
    name: string;
    agent: string | null;
    since: string;
}

/** Enough to read the work state of a report: who asks (to mark "yours"), nothing else. */
export interface WorkViewer {
    env: Env;
    developer: Pick<Developer, 'id'> | null;
    agent?: string | null;
}

async function claimHolder(ctx: WorkViewer, report: Report): Promise<ClaimHolder | null> {
    if (report.claimed_by_developer_id === null || report.claimed_at === null) {
        return null;
    }
    const developer = await findDeveloper(ctx.env.DB, report.claimed_by_developer_id);
    return { developer_id: report.claimed_by_developer_id, name: developer?.name ?? '（已刪除的帳號）', agent: report.claimed_agent, since: report.claimed_at };
}

function isMine(ctx: WorkViewer, holder: ClaimHolder): boolean {
    return ctx.developer !== null && holder.developer_id === ctx.developer.id && (holder.agent ?? null) === (ctx.agent ?? null);
}

function describeHolder(ctx: WorkViewer, holder: ClaimHolder): string {
    return `${withAgent(holder.name, holder.agent)}（${formatAbsolute(holder.since, config(ctx.env).utcOffsetMinutes)} 開始）`;
}

/**
 * Someone else holds the report: without `force` the change is refused with who holds it; with
 * `force` this account takes the claim over and the takeover is logged. Returns the previous holder.
 */
async function guardClaim(ctx: TeamContext, report: Report, force: boolean): Promise<string | null> {
    const holder = await claimHolder(ctx, report);
    if (!holder || isMine(ctx, holder)) {
        return null;
    }
    const description = describeHolder(ctx, holder);
    if (!force) {
        throw new ServiceError(
            'claimed_by_other',
            `這張單由 ${description} 認領處理中。先用 get_report 看最新交接紀錄；確定要接手，請加 force（CLI：--force），系統會記錄你接手。`,
            409,
        );
    }
    const at = nowIso(ctx.now);
    // Takes over only the claim that was read; a change in between is reported instead.
    const [taken] = await ctx.env.DB.batch([
        ctx.env.DB.prepare('UPDATE reports SET claimed_by_developer_id = ?, claimed_agent = ?, claimed_at = ? WHERE id = ? AND claimed_by_developer_id = ? AND claimed_at = ?').bind(
            ctx.developer.id,
            ctx.agent ?? null,
            at,
            report.id,
            holder.developer_id,
            holder.since,
        ),
        ctx.env.DB.prepare(
            `INSERT INTO report_events (report_id, kind, developer_id, client_account_id, actor_name, agent, detail, created_at)
             SELECT ?, 'takeover', ?, NULL, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM reports WHERE id = ? AND claimed_by_developer_id = ? AND claimed_at = ?)`,
        ).bind(report.id, ctx.developer.id, ctx.developer.name, ctx.agent ?? null, withAgent(holder.name, holder.agent), at, report.id, ctx.developer.id, at),
    ]);
    if ((taken.meta.changes ?? 0) === 0) {
        throw new ServiceError('claimed_by_other', '認領剛剛有變動，請重新讀取看是誰在處理。', 409);
    }
    return description;
}

/** Claim, newest handoff notes and recent activity; team side only. */
export async function workState(ctx: WorkViewer, report: Report) {
    const holder = await claimHolder(ctx, report);
    const [notes, events] = await ctx.env.DB.batch([
        ctx.env.DB.prepare(
            `SELECT h.body, h.agent, h.created_at, COALESCE(d.name, h.author_name) AS author FROM handoff_notes h LEFT JOIN developers d ON d.id = h.developer_id
             WHERE h.report_id = ? ORDER BY h.id DESC LIMIT ${HANDOFF_NOTES_SHOWN}`,
        ).bind(report.id),
        ctx.env.DB.prepare(
            `SELECT e.kind, e.agent, e.detail, e.created_at, COALESCE(d.name, ca.name, e.actor_name) AS actor FROM report_events e
             LEFT JOIN developers d ON d.id = e.developer_id LEFT JOIN client_accounts ca ON ca.id = e.client_account_id
             WHERE e.report_id = ? ORDER BY e.id DESC LIMIT ${EVENTS_SHOWN}`,
        ).bind(report.id),
    ]);
    return {
        claim: holder ? { by: withAgent(holder.name, holder.agent), since: holder.since, yours: isMine(ctx, holder) } : null,
        handoff_notes: (notes.results as Array<{ body: string; agent: string | null; created_at: string; author: string }>).map((note) => ({
            author: withAgent(note.author, note.agent),
            created_at: note.created_at,
            note: note.body,
        })),
        recent_activity: (events.results as Array<{ kind: string; agent: string | null; detail: string | null; created_at: string; actor: string }>).map((event) => ({
            kind: event.kind,
            by: withAgent(event.actor, event.agent),
            detail: event.detail,
            at: event.created_at,
        })),
    };
}

/** Takes the report: others see who is working on it. Someone else's claim needs `force` (logged as takeover). */
export async function claimReport(ctx: TeamContext, slug: string, identifier: string, options: { force?: boolean } = {}) {
    const project = await projectOrFail(ctx.env, slug);
    const report = await resolveReport(ctx.env, project, identifier);
    const holder = await claimHolder(ctx, report);
    let takenOver: string | null = null;
    if (holder && !isMine(ctx, holder)) {
        takenOver = await guardClaim(ctx, report, options.force === true);
    } else {
        const at = nowIso(ctx.now);
        if (!holder) {
            // Only when still unclaimed: of two people claiming at once, one wins and the other is told.
            const [claimed] = await ctx.env.DB.batch([
                ctx.env.DB.prepare('UPDATE reports SET claimed_by_developer_id = ?, claimed_agent = ?, claimed_at = ? WHERE id = ? AND (claimed_by_developer_id IS NULL OR claimed_at IS NULL)').bind(ctx.developer.id, ctx.agent ?? null, at, report.id),
                ctx.env.DB.prepare(
                    `INSERT INTO report_events (report_id, kind, developer_id, client_account_id, actor_name, agent, detail, created_at)
                     SELECT ?, 'claim', ?, NULL, ?, ?, NULL, ? WHERE EXISTS (SELECT 1 FROM reports WHERE id = ? AND claimed_by_developer_id = ? AND claimed_at = ?)`,
                ).bind(report.id, ctx.developer.id, ctx.developer.name, ctx.agent ?? null, at, report.id, ctx.developer.id, at),
            ]);
            if ((claimed.meta.changes ?? 0) === 0) {
                throw new ServiceError('claimed_by_other', '這張單剛剛被別人認領，請重新讀取看是誰在處理。', 409);
            }
        }
    }
    return { public_id: report.public_id, title: report.title, claimed_by: withAgent(ctx.developer.name, ctx.agent ?? null), took_over_from: takenOver };
}

/** Lets go of the report. Releasing someone else's claim needs `force` and is logged. */
export async function releaseReport(ctx: TeamContext, slug: string, identifier: string, options: { force?: boolean } = {}) {
    const project = await projectOrFail(ctx.env, slug);
    const report = await resolveReport(ctx.env, project, identifier);
    const holder = await claimHolder(ctx, report);
    if (!holder) {
        return { public_id: report.public_id, title: report.title, released: false };
    }
    if (!isMine(ctx, holder) && options.force !== true) {
        throw new ServiceError('claimed_by_other', `這張單由 ${describeHolder(ctx, holder)} 認領，不是你。確定要替他釋放請加 force（會記錄）。`, 409);
    }
    const at = nowIso(ctx.now);
    await ctx.env.DB.batch([
        ctx.env.DB.prepare('UPDATE reports SET claimed_by_developer_id = NULL, claimed_agent = NULL, claimed_at = NULL WHERE id = ?').bind(report.id),
        eventStatement(ctx.env.DB, report, 'release', teamAuthor(ctx), at, isMine(ctx, holder) ? null : withAgent(holder.name, holder.agent)),
    ]);
    return { public_id: report.public_id, title: report.title, released: true };
}

/** Progress note for whoever continues: what is done, what comes next. Optionally releases the claim. */
export async function writeHandoff(ctx: TeamContext, slug: string, identifier: string, input: { note: string; release?: boolean }) {
    const project = await projectOrFail(ctx.env, slug);
    const report = await resolveReport(ctx.env, project, identifier);
    const note = (input.note ?? '').trim();
    if (note === '') {
        throw new ServiceError('note_required', '交接紀錄不可為空白：寫下做到哪、下一步是什麼。', 422);
    }
    if (charLength(note) > MAX_HANDOFF_NOTE) {
        throw new ServiceError('note_too_long', `交接紀錄不能超過 ${MAX_HANDOFF_NOTE} 字。`, 422);
    }
    const at = nowIso(ctx.now);
    const holder = await claimHolder(ctx, report);
    const release = input.release === true && holder !== null && isMine(ctx, holder);
    await ctx.env.DB.batch([
        ctx.env.DB.prepare('INSERT INTO handoff_notes (report_id, developer_id, author_name, agent, body, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
            report.id,
            ctx.developer.id,
            ctx.developer.name,
            ctx.agent ?? null,
            note,
            at,
        ),
        eventStatement(ctx.env.DB, report, 'handoff', teamAuthor(ctx), at),
        ...(release
            ? [
                  ctx.env.DB.prepare('UPDATE reports SET claimed_by_developer_id = NULL, claimed_agent = NULL, claimed_at = NULL WHERE id = ?').bind(report.id),
                  eventStatement(ctx.env.DB, report, 'release', teamAuthor(ctx), at),
              ]
            : []),
    ]);
    return { public_id: report.public_id, title: report.title, saved: true, released: release };
}

/** A report created by a team account (through the API, CLI or MCP). */
export async function createTeamReport(ctx: TeamContext, slug: string, input: { title: string; description: string; upload_ids?: string[] }) {
    const project = await projectOrFail(ctx.env, slug);
    const { title, description, uploadIds } = validateNewReport(input);
    const uploads = await findClaimableUploads(ctx.env.DB, uploadIds, { projectId: project.id, purpose: 'report', reportId: null });
    if (uploads === null) {
        throw new ServiceError('invalid_upload', '圖片上傳已失效或不屬於這個專案，請重新上傳。', 422);
    }
    const { report } = await createReport(ctx.env, project, { title, description, uploads, author: teamAuthor(ctx) }, { creator_type: 'developer', creator_developer_id: ctx.developer.id }, ctx.now);
    return { public_id: report.public_id, title: report.title, url: absolute(ctx, paths.report(project.slug, report.public_id)), images_added: uploads.length };
}

export function validateNewReport(input: { title?: string; description?: string; upload_ids?: string[] }): { title: string; description: string; uploadIds: string[] } {
    const title = (input.title ?? '').trim();
    const description = (input.description ?? '').trim();
    if (title === '' || charLength(title) > MAX_TITLE) {
        throw new ServiceError('invalid_title', `標題不可為空白，且不可超過 ${MAX_TITLE} 字。`, 422);
    }
    if (description === '' || charLength(description) > MAX_DESCRIPTION) {
        throw new ServiceError('invalid_description', `說明不可為空白，且不可超過 ${MAX_DESCRIPTION} 字。`, 422);
    }
    const uploadIds = input.upload_ids ?? [];
    if (uploadIds.length > 5) {
        throw new ServiceError('too_many_images', '一張單最多附 5 張圖。', 422);
    }
    return { title, description, uploadIds };
}

export async function writeAdjustment(
    ctx: TeamContext,
    slug: string,
    identifier: string,
    input: { note?: string | null; append?: boolean; upload_ids?: string[]; by_id?: boolean; force?: boolean },
) {
    const project = await projectOrFail(ctx.env, slug);
    const report = await resolveReport(ctx.env, project, identifier, input.by_id ? 'id' : 'public_id');
    const uploadIds = input.upload_ids ?? [];
    const hasNote = input.note !== undefined && input.note !== null;
    if (!hasNote && uploadIds.length === 0) {
        throw new ServiceError('nothing_to_write', '請至少提供 --note 或 --image。', 422);
    }
    if (input.append && !hasNote) {
        throw new ServiceError('append_needs_note', '--append 需要搭配 --note。', 422);
    }
    if (uploadIds.length > 5) {
        throw new ServiceError('too_many_images', '一次最多附 5 張調整圖片。', 422);
    }
    if (hasNote) {
        const merged = mergeNote(report.adjustment_note, input.note as string, input.append ?? false);
        if (charLength(merged ?? '') > MAX_ADJUSTMENT_NOTE) {
            throw new ServiceError('note_too_long', `調整說明超過 ${MAX_ADJUSTMENT_NOTE} 字上限。`, 422);
        }
    }
    const uploads = await findClaimableUploads(ctx.env.DB, uploadIds, { projectId: project.id, purpose: 'adjustment', reportId: report.id });
    if (uploads === null) {
        throw new ServiceError('invalid_upload', '圖片上傳已失效或不屬於這張單，請重新上傳。', 422);
    }
    const takenOver = await guardClaim(ctx, report, input.force === true);
    await updateAdjustment(
        ctx.env,
        report,
        { note: hasNote ? (input.note as string) : undefined, append: input.append ?? false, uploads, removeAttachmentIds: [], author: teamAuthor(ctx) },
        ctx.now,
    );
    const count = await ctx.env.DB.prepare("SELECT COUNT(*) AS total FROM attachments WHERE report_id = ? AND kind = 'adjustment'").bind(report.id).first<{ total: number }>();
    return {
        public_id: report.public_id,
        title: report.title,
        note: hasNote ? (input.append ? 'appended' : 'replaced') : 'unchanged',
        images_added: uploads.length,
        images_total: count?.total ?? 0,
        url: `${absolute(ctx, paths.report(project.slug, report.public_id))}#adjustment`,
        took_over_from: takenOver,
    };
}

export async function postMessage(ctx: TeamContext, slug: string, identifier: string, input: { body: string; upload_ids?: string[] }) {
    const project = await projectOrFail(ctx.env, slug);
    const report = await resolveReport(ctx.env, project, identifier);
    const body = (input.body ?? '').trim();
    if (body === '') {
        throw new ServiceError('body_required', '訊息內容 為必填。', 422);
    }
    if (charLength(body) > MAX_MESSAGE) {
        throw new ServiceError('body_too_long', `訊息內容 不能超過 ${MAX_MESSAGE} 個字元。`, 422);
    }
    const uploadIds = input.upload_ids ?? [];
    if (uploadIds.length > 5) {
        throw new ServiceError('too_many_images', '一則留言最多附 5 張圖。', 422);
    }
    const uploads = await findClaimableUploads(ctx.env.DB, uploadIds, { projectId: project.id, purpose: 'message', reportId: report.id });
    if (uploads === null) {
        throw new ServiceError('invalid_upload', '圖片上傳已失效或不屬於這張單，請重新上傳。', 422);
    }
    const author = messageAuthorName(ctx.env, report, true, ctx.developer.name);
    await addMessage(ctx.env, report, { author_type: 'owner', author_name: author, body, uploads, author: teamAuthor(ctx) }, ctx.now);
    return { public_id: report.public_id, title: report.title, author: report.creator_type === 'public' ? author : withAgent(author, ctx.agent), images_added: uploads.length };
}

// ------------------------------------------------------------------ projects

function projectLinks(ctx: TeamContext, project: Project, tokens: { client?: string | null; owner?: string | null }) {
    return {
        client_link: tokens.client ? `${absolute(ctx, paths.clientAccess(project.slug))}?token=${tokens.client}` : null,
        owner_link: tokens.owner ? `${absolute(ctx, paths.ownerAccess(project.slug))}?token=${tokens.owner}` : null,
    };
}

function projectSummary(ctx: TeamContext, project: Project & { client_account_count?: number }) {
    return {
        slug: project.slug,
        name: project.name,
        client_name: project.client_display_name,
        has_client_link: project.client_token_hash !== null,
        client_accounts: project.client_account_count ?? 0,
        public_reporting_enabled: project.public_reporting_enabled === 1,
        is_home_public_project: config(ctx.env).publicReporting.homeProject === project.slug,
        portal_url: absolute(ctx, paths.portal(project.slug)),
        created_at: project.created_at,
    };
}

export async function listProjects(ctx: TeamContext) {
    const { results } = await ctx.env.DB.prepare(
        'SELECT p.*, (SELECT COUNT(*) FROM client_accounts ca WHERE ca.project_id = p.id) AS client_account_count FROM projects p ORDER BY p.created_at, p.id',
    ).all<Project & { client_account_count: number }>();
    return { projects: results.map((project) => projectSummary(ctx, project)) };
}

export async function createProject(ctx: TeamContext, input: { name: string; slug?: string; client_name?: string; no_client?: boolean }) {
    const name = (input.name ?? '').trim();
    if (name === '' || charLength(name) > 120) {
        throw new ServiceError('invalid_name', '專案名稱不可為空白，且不可超過 120 字。', 422);
    }
    const slug = slugify(input.slug && input.slug.trim() !== '' ? input.slug : name);
    if (slug === '' || (await findProjectBySlug(ctx.env.DB, slug))) {
        throw new ServiceError('invalid_slug', '專案代稱為空白或已經存在（中文名稱請用 --slug 指定英數代稱）。', 422);
    }
    const ownerToken = randomString(48);
    const clientToken = input.no_client ? null : randomString(48);
    const at = nowIso(ctx.now);
    const project = await ctx.env.DB.prepare(
        `INSERT INTO projects (name, slug, client_display_name, owner_token_hash, client_token_hash, public_reporting_enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?) RETURNING *`,
    )
        .bind(name, slug, input.client_name && input.client_name.trim() !== '' ? input.client_name.trim() : null, await sha256Hex(ownerToken), clientToken ? await sha256Hex(clientToken) : null, at, at)
        .first<Project>();
    if (!project) {
        throw new ServiceError('create_failed', '建立專案失敗。', 400);
    }
    return { project: projectSummary(ctx, project), ...projectLinks(ctx, project, { client: clientToken, owner: ownerToken }) };
}

export async function rotateClientLink(ctx: TeamContext, slug: string) {
    const project = await projectOrFail(ctx.env, slug);
    const token = randomString(48);
    await ctx.env.DB.prepare('UPDATE projects SET client_token_hash = ?, updated_at = ? WHERE id = ?').bind(await sha256Hex(token), nowIso(ctx.now), project.id).run();
    return { project: project.slug, client_link: projectLinks(ctx, project, { client: token }).client_link };
}

export async function rotateOwnerLink(ctx: TeamContext, slug: string) {
    const project = await projectOrFail(ctx.env, slug);
    const token = randomString(48);
    await ctx.env.DB.prepare('UPDATE projects SET owner_token_hash = ?, updated_at = ? WHERE id = ?').bind(await sha256Hex(token), nowIso(ctx.now), project.id).run();
    return { project: project.slug, owner_link: projectLinks(ctx, project, { owner: token }).owner_link };
}

export function validateUsername(username: string): string {
    const trimmed = (username ?? '').trim();
    if (trimmed === '' || charLength(trimmed) > 50) {
        throw new ServiceError('invalid_username', '帳號不可為空白，且不可超過 50 字。', 422);
    }
    return trimmed;
}

// ------------------------------------------------------------------ client accounts

export const MAX_ACCOUNT_NAME = 100;

export function validateAccountName(name: string): string {
    const trimmed = (name ?? '').trim();
    if (trimmed === '' || charLength(trimmed) > MAX_ACCOUNT_NAME) {
        throw new ServiceError('invalid_name', `顯示名稱不可為空白，且不可超過 ${MAX_ACCOUNT_NAME} 字。`, 422);
    }
    return trimmed;
}

/** SQL condition for a login name already used by a team or client account; binds the name twice. */
const USERNAME_IN_USE = 'SELECT 1 FROM developers WHERE lower(username) = lower(?) UNION ALL SELECT 1 FROM client_accounts WHERE lower(username) = lower(?)';

/** New login names may not repeat any team or client login name of the deployment (ignoring case). */
async function assertUsernameFree(ctx: TeamContext, username: string): Promise<void> {
    if (await usernameTaken(ctx.env.DB, username)) {
        throw new ServiceError('username_taken', `帳號名稱「${username}」已經有人使用（團隊帳號與所有專案的客戶帳號共用同一組名稱，不分大小寫），請換一個。`, 409);
    }
}

function clientAccountSummary(account: ClientAccount) {
    return {
        id: account.id,
        username: account.username,
        name: account.name,
        disabled: account.disabled_at !== null,
        password_set_by_self: account.password_set_by_self === 1,
        created_at: account.created_at,
    };
}

async function clientAccountOrFail(ctx: TeamContext, project: Project, username: string): Promise<ClientAccount> {
    const account = await findClientAccountInProject(ctx.env.DB, project.id, validateUsername(username));
    if (!account) {
        throw new ServiceError('client_account_not_found', '這個專案找不到這個客戶帳號。', 404);
    }
    return account;
}

/** Statements that point the login page prefill at this account's new password, or clear a prefill that pointed at it. */
function prefillStatements(ctx: TeamContext, project: Project, account: Pick<ClientAccount, 'username'>, password: string | null): D1PreparedStatement[] {
    if (password !== null) {
        return [ctx.env.DB.prepare('UPDATE projects SET login_prefill_username = ?, login_prefill_password = ?, updated_at = ? WHERE id = ?').bind(account.username, password, nowIso(ctx.now), project.id)];
    }
    return [
        ctx.env.DB.prepare('UPDATE projects SET login_prefill_username = NULL, login_prefill_password = NULL, updated_at = ? WHERE id = ? AND login_prefill_username = ?').bind(
            nowIso(ctx.now),
            project.id,
            account.username,
        ),
    ];
}

function clientPasswordResult(ctx: TeamContext, project: Project, account: ClientAccount, password: string, prefill: boolean) {
    return {
        project: project.slug,
        account: clientAccountSummary(account),
        username: account.username,
        password,
        prefill,
        prefill_active: prefill && config(ctx.env).loginPrefill.enabled,
        login_url: absolute(ctx, paths.login(project.slug)),
    };
}

export async function listClients(ctx: TeamContext, slug: string) {
    const project = await projectOrFail(ctx.env, slug);
    return { project: project.slug, clients: (await listClientAccounts(ctx.env.DB, project.id)).map(clientAccountSummary) };
}

/** A new client person on the project, with a generated password. */
export async function createClient(ctx: TeamContext, slug: string, input: { username: string; name?: string; prefill?: boolean }) {
    const project = await projectOrFail(ctx.env, slug);
    const username = validateUsername(input.username);
    const name = input.name && input.name.trim() !== '' ? validateAccountName(input.name) : username;
    await assertUsernameFree(ctx, username);
    const password = randomString(GENERATED_PASSWORD_LENGTH);
    const at = nowIso(ctx.now);
    const prefill = input.prefill === true;
    const hash = await hashPassword(password);
    const [inserted] = await ctx.env.DB.batch([
        // The name check repeats inside the insert, so two requests at once cannot both take a name.
        ctx.env.DB.prepare(
            `INSERT INTO client_accounts (project_id, username, name, password_hash, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (${USERNAME_IN_USE}) RETURNING *`,
        ).bind(project.id, username, name, hash, at, at, username, username),
        ...(prefill
            ? [
                  // Only when this request created the account (a name taken meanwhile leaves the prefill alone).
                  ctx.env.DB.prepare(
                      'UPDATE projects SET login_prefill_username = ?, login_prefill_password = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM client_accounts WHERE project_id = ? AND username = ? AND password_hash = ?)',
                  ).bind(username, password, at, project.id, project.id, username, hash),
              ]
            : []),
    ]);
    const account = inserted.results[0] as ClientAccount | undefined;
    if (!account) {
        throw new ServiceError('username_taken', `帳號名稱「${username}」已經有人使用，請換一個。`, 409);
    }
    return clientPasswordResult(ctx, project, account, password, prefill);
}

/**
 * New generated password for a client account; its logins stop working. A password the holder chose
 * is refused: only `account recover` (D1 directly) replaces it.
 */
export async function resetClient(ctx: TeamContext, slug: string, username: string, input: { prefill?: boolean } = {}) {
    const project = await projectOrFail(ctx.env, slug);
    const account = await clientAccountOrFail(ctx, project, username);
    if (account.password_set_by_self === 1) {
        throw new ServiceError('password_set_by_self', SELF_SET_PASSWORD_LOCKED, 409);
    }
    const password = randomString(GENERATED_PASSWORD_LENGTH);
    const hash = await hashPassword(password);
    const prefill = input.prefill === true;
    // Prefill and revocations only run when the reset itself happened (the new hash is in place).
    const applied = 'EXISTS (SELECT 1 FROM client_accounts WHERE id = ? AND password_hash = ?)';
    const at = nowIso(ctx.now);
    const [updated] = await ctx.env.DB.batch([
        ctx.env.DB.prepare('UPDATE client_accounts SET password_hash = ?, updated_at = ? WHERE id = ? AND password_set_by_self = 0').bind(hash, at, account.id),
        prefill
            ? ctx.env.DB.prepare(`UPDATE projects SET login_prefill_username = ?, login_prefill_password = ?, updated_at = ? WHERE id = ? AND ${applied}`).bind(account.username, password, at, project.id, account.id, hash)
            : ctx.env.DB.prepare(`UPDATE projects SET login_prefill_username = NULL, login_prefill_password = NULL, updated_at = ? WHERE id = ? AND login_prefill_username = ? AND ${applied}`).bind(
                  at,
                  project.id,
                  account.username,
                  account.id,
                  hash,
              ),
        ctx.env.DB.prepare(`DELETE FROM api_tokens WHERE client_account_id = ? AND ${applied}`).bind(account.id, account.id, hash),
        ctx.env.DB.prepare(`UPDATE device_codes SET status = 'denied' WHERE client_account_id = ? AND status = 'approved' AND ${applied}`).bind(account.id, account.id, hash),
    ]);
    if ((updated.meta.changes ?? 0) === 0) {
        throw new ServiceError('password_set_by_self', SELF_SET_PASSWORD_LOCKED, 409);
    }
    return clientPasswordResult(ctx, project, { ...account, password_hash: hash }, password, prefill);
}

/** Disabled client accounts cannot sign in; their logins stop working and their API tokens are deleted. */
export async function setClientDisabled(ctx: TeamContext, slug: string, username: string, disabled: boolean) {
    const project = await projectOrFail(ctx.env, slug);
    const account = await clientAccountOrFail(ctx, project, username);
    const at = nowIso(ctx.now);
    await ctx.env.DB.batch([
        ctx.env.DB.prepare('UPDATE client_accounts SET disabled_at = ?, updated_at = ? WHERE id = ?').bind(disabled ? at : null, at, account.id),
        ...(disabled ? revokeClientCredentials(ctx.env.DB, account.id) : []),
    ]);
    return { project: project.slug, account: clientAccountSummary({ ...account, disabled_at: disabled ? at : null }) };
}

/** Deletes a client account; what it wrote stays and shows the client label as its writer. */
export async function deleteClient(ctx: TeamContext, slug: string, username: string) {
    const project = await projectOrFail(ctx.env, slug);
    const account = await clientAccountOrFail(ctx, project, username);
    // Deleting and re-creating the same login name would be a way around a password the holder chose.
    if (account.password_set_by_self === 1) {
        throw new ServiceError(
            'password_set_by_self',
            '這個帳號的密碼是本人自己設定的，其他人不能刪除它（刪掉再建同名帳號等於改掉本人的密碼）。不讓他登入請用停用；確定要刪除，請部署者先執行 account recover。',
            409,
        );
    }
    await ctx.env.DB.batch([ctx.env.DB.prepare('DELETE FROM client_accounts WHERE id = ?').bind(account.id), ...prefillStatements(ctx, project, account, null)]);
    return { project: project.slug, deleted: account.username };
}

/**
 * Older `project client-account` call: resets the account when the login name already exists in the
 * project, otherwise adds it as a new client account.
 */
export async function setClientAccount(ctx: TeamContext, slug: string, input: { username: string; prefill?: boolean }) {
    const project = await projectOrFail(ctx.env, slug);
    const username = validateUsername(input.username);
    const existing = await findClientAccountInProject(ctx.env.DB, project.id, username);
    return existing ? resetClient(ctx, slug, username, { prefill: input.prefill }) : createClient(ctx, slug, { username, prefill: input.prefill });
}

export async function setPublicReporting(ctx: TeamContext, slug: string, input: { enabled: boolean; force?: boolean }) {
    const project = await projectOrFail(ctx.env, slug);
    const accounts = await ctx.env.DB.prepare('SELECT COUNT(*) AS total FROM client_accounts WHERE project_id = ?').bind(project.id).first<{ total: number }>();
    const clientAccess = Object.entries({
        client_accounts: (accounts?.total ?? 0) > 0 ? 'yes' : null,
        client_token_hash: project.client_token_hash,
        login_prefill_username: project.login_prefill_username,
        login_prefill_password: project.login_prefill_password,
    })
        .filter(([, value]) => value !== null && value !== '')
        .map(([key]) => key);
    if (input.enabled && !input.force && clientAccess.length > 0) {
        throw new ServiceError(
            'project_has_client_access',
            `這個專案已有客戶入口或帳號：${clientAccess.join('、')}。公開回報請開在專用專案；確定要開請加 --force。`,
            409,
        );
    }
    await ctx.env.DB.prepare('UPDATE projects SET public_reporting_enabled = ?, updated_at = ? WHERE id = ?').bind(input.enabled ? 1 : 0, nowIso(ctx.now), project.id).run();
    const homeProject = config(ctx.env).publicReporting.homeProject;
    return {
        project: project.slug,
        public_reporting_enabled: input.enabled,
        home_page_active: input.enabled && homeProject === project.slug,
        hint: input.enabled && homeProject !== project.slug ? `首頁尚未顯示：請在 wrangler.jsonc 的 vars 設定 FEEDBACK_HOME_PUBLIC_PROJECT=${project.slug} 後重新部署。` : null,
    };
}

// ------------------------------------------------------------------ team accounts

function developerSummary(developer: Developer) {
    return {
        id: developer.id,
        username: developer.username,
        name: developer.name,
        disabled: developer.disabled_at !== null,
        password_set_by_self: developer.password_set_by_self === 1,
        created_at: developer.created_at,
    };
}

export async function listTeam(ctx: TeamContext) {
    return { developers: (await listDevelopers(ctx.env.DB)).map(developerSummary) };
}

export async function createDeveloper(ctx: TeamContext, input: { username: string; name?: string }) {
    const username = validateUsername(input.username);
    if (await findDeveloperByUsername(ctx.env.DB, username)) {
        throw new ServiceError('developer_exists', '這個帳號已經存在；要重設密碼請用 developer reset。', 409);
    }
    // Team accounts are checked before client accounts at login, so a team account with a client's
    // login name would lock that client out.
    await assertUsernameFree(ctx, username);
    const name = input.name && input.name.trim() !== '' ? input.name.trim() : username;
    if (charLength(name) > 100) {
        throw new ServiceError('invalid_name', '顯示名稱不可超過 100 字。', 422);
    }
    const password = randomString(GENERATED_PASSWORD_LENGTH);
    const at = nowIso(ctx.now);
    const developer = await ctx.env.DB.prepare(
        `INSERT INTO developers (name, username, password_hash, created_at, updated_at) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (${USERNAME_IN_USE}) RETURNING *`,
    )
        .bind(name, username, await hashPassword(password), at, at, username, username)
        .first<Developer>();
    if (!developer) {
        throw new ServiceError('username_taken', `帳號名稱「${username}」已經有人使用，請換一個。`, 409);
    }
    return { developer: developerSummary(developer), password };
}

/**
 * New generated password; every API token of the account is revoked too (a reset usually means a
 * leaked credential). A password the holder chose is refused: only `account recover` (D1 directly)
 * replaces it.
 */
export async function resetDeveloper(ctx: TeamContext, input: { username: string; name?: string }) {
    const username = validateUsername(input.username);
    const developer = await findDeveloperByUsername(ctx.env.DB, username);
    if (!developer) {
        throw new ServiceError('developer_not_found', '找不到這個團隊帳號。', 404);
    }
    if (developer.password_set_by_self === 1) {
        throw new ServiceError('password_set_by_self', SELF_SET_PASSWORD_LOCKED, 409);
    }
    const password = randomString(GENERATED_PASSWORD_LENGTH);
    const name = input.name && input.name.trim() !== '' ? input.name.trim() : developer.name;
    const hash = await hashPassword(password);
    // The condition repeats the check so a password the holder sets meanwhile is never overwritten.
    // Revocations only run when the reset itself happened (the new hash is in place).
    const applied = 'EXISTS (SELECT 1 FROM developers WHERE id = ? AND password_hash = ?)';
    const [updated, revoked] = await ctx.env.DB.batch([
        ctx.env.DB.prepare('UPDATE developers SET name = ?, password_hash = ?, updated_at = ? WHERE id = ? AND password_set_by_self = 0').bind(name, hash, nowIso(ctx.now), developer.id),
        ctx.env.DB.prepare(`DELETE FROM api_tokens WHERE developer_id = ? AND ${applied}`).bind(developer.id, developer.id, hash),
        ctx.env.DB.prepare(`UPDATE device_codes SET status = 'denied' WHERE developer_id = ? AND status = 'approved' AND ${applied}`).bind(developer.id, developer.id, hash),
    ]);
    if ((updated.meta.changes ?? 0) === 0) {
        throw new ServiceError('password_set_by_self', SELF_SET_PASSWORD_LOCKED, 409);
    }
    return { developer: developerSummary({ ...developer, name }), password, tokens_revoked: revoked.meta.changes ?? 0 };
}

async function otherDeveloper(ctx: TeamContext, username: string, action: string): Promise<Developer> {
    const developer = await findDeveloperByUsername(ctx.env.DB, validateUsername(username));
    if (!developer) {
        throw new ServiceError('developer_not_found', '找不到這個團隊帳號。', 404);
    }
    if (developer.id === ctx.developer.id) {
        throw new ServiceError('cannot_change_self', `不能${action}自己目前登入的帳號；請用另一個團隊帳號操作。`, 422);
    }
    return developer;
}

/** Disables the account: web logins and API tokens stop working at once; tokens are deleted. */
export async function setDeveloperDisabled(ctx: TeamContext, username: string, disabled: boolean) {
    const developer = await otherDeveloper(ctx, username, disabled ? '停用' : '啟用');
    const statements = [ctx.env.DB.prepare('UPDATE developers SET disabled_at = ?, updated_at = ? WHERE id = ?').bind(disabled ? nowIso(ctx.now) : null, nowIso(ctx.now), developer.id)];
    if (disabled) {
        statements.push(...revokeDeveloperCredentials(ctx.env.DB, developer.id));
    }
    const results = await ctx.env.DB.batch(statements);
    return { developer: developerSummary({ ...developer, disabled_at: disabled ? nowIso(ctx.now) : null }), tokens_revoked: disabled ? results[1].meta.changes ?? 0 : 0 };
}

/** Deletes the account and its tokens; reports it created keep existing and show the team label as creator. */
export async function deleteDeveloper(ctx: TeamContext, username: string) {
    const developer = await otherDeveloper(ctx, username, '刪除');
    // Deleting and re-creating the same username would be a way around a password the holder chose.
    if (developer.password_set_by_self === 1) {
        throw new ServiceError(
            'password_set_by_self',
            '這個帳號的密碼是本人自己設定的，其他人不能刪除它（刪掉再建同名帳號等於改掉本人的密碼）。不讓他登入請用 developer disable；確定要刪除，請部署者先執行 account recover。',
            409,
        );
    }
    const [tokens] = await ctx.env.DB.batch([
        ctx.env.DB.prepare('DELETE FROM api_tokens WHERE developer_id = ?').bind(developer.id),
        ctx.env.DB.prepare('UPDATE reports SET creator_developer_id = NULL WHERE creator_developer_id = ?').bind(developer.id),
        ctx.env.DB.prepare('UPDATE reports SET claimed_by_developer_id = NULL, claimed_agent = NULL, claimed_at = NULL WHERE claimed_by_developer_id = ?').bind(developer.id),
        ctx.env.DB.prepare('DELETE FROM developers WHERE id = ?').bind(developer.id),
    ]);
    return { deleted: developer.username, tokens_revoked: tokens.meta.changes ?? 0 };
}

// ------------------------------------------------------------------ API tokens

export const MAX_TOKEN_DAYS = 3650;

/** Whose token: a team account or a client account. */
export type TokenHolder = { developerId: number } | { clientAccountId: number };

function holderColumn(holder: TokenHolder): { column: 'developer_id' | 'client_account_id'; id: number } {
    return 'developerId' in holder ? { column: 'developer_id', id: holder.developerId } : { column: 'client_account_id', id: holder.clientAccountId };
}

/** `agent` marks tokens made by `mcp install` for one AI tool, so its actions show "名字（Codex）". */
export async function createToken(env: Env, holder: TokenHolder | number, name: string, now: number, expiresInDays: number | null = null, agent: string | null = null) {
    if (expiresInDays !== null && (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_TOKEN_DAYS)) {
        throw new ServiceError('invalid_expiry', `有效天數必須是 1 到 ${MAX_TOKEN_DAYS} 的整數。`, 422);
    }
    const { column, id } = holderColumn(typeof holder === 'number' ? { developerId: holder } : holder);
    const token = `fdk_${randomString(40)}`;
    const expiresAt = expiresInDays === null ? null : nowIso(now + expiresInDays * 86_400_000);
    const row = await env.DB.prepare(`INSERT INTO api_tokens (${column}, name, agent, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, name, agent, expires_at, created_at`)
        .bind(id, name.trim() === '' ? 'cli' : name.trim().slice(0, 100), agent, await sha256Hex(token), expiresAt, nowIso(now))
        .first<{ id: number; name: string; agent: string | null; expires_at: string | null; created_at: string }>();
    return { token, id: row?.id ?? 0, name: row?.name ?? name, agent: row?.agent ?? null, expires_at: row?.expires_at ?? null, created_at: row?.created_at ?? nowIso(now) };
}

export async function listTokens(env: Env, holder: TokenHolder, currentTokenId: number) {
    const { column, id } = holderColumn(holder);
    const { results } = await env.DB.prepare(`SELECT id, name, agent, last_used_at, expires_at, created_at FROM api_tokens WHERE ${column} = ? ORDER BY id`)
        .bind(id)
        .all<{ id: number; name: string; agent: string | null; last_used_at: string | null; expires_at: string | null; created_at: string }>();
    return { tokens: results.map((token) => ({ ...token, current: token.id === currentTokenId })) };
}

export async function revokeToken(env: Env, holder: TokenHolder, tokenId: number) {
    const { column, id } = holderColumn(holder);
    const result = await env.DB.prepare(`DELETE FROM api_tokens WHERE id = ? AND ${column} = ?`).bind(tokenId, id).run();
    if ((result.meta.changes ?? 0) === 0) {
        throw new ServiceError('token_not_found', '找不到這個 token（只能撤銷自己的 token）。', 404);
    }
    return { revoked: tokenId };
}

/** Statements that end every API credential of a client account. */
export function revokeClientCredentials(db: D1Database, clientAccountId: number): D1PreparedStatement[] {
    return [
        db.prepare('DELETE FROM api_tokens WHERE client_account_id = ?').bind(clientAccountId),
        db.prepare("UPDATE device_codes SET status = 'denied' WHERE client_account_id = ? AND status = 'approved'").bind(clientAccountId),
    ];
}
