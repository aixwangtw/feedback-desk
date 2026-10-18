/**
 * Operations performed by a signed-in team account through the API (CLI) or MCP. Both callers go
 * through these functions, so the rules match the web pages and each other.
 */
import { CREATOR_FILTER_PATTERN, describedStatusOptions, statusFromInput, statusLabel, type ReportStatus } from '../../shared/status';
import { charLength, slugify } from '../../shared/text';
import { nowIso } from '../../shared/time';
import { config, type Env } from '../env';
import { hashPassword, randomString, sha256Hex } from './crypto';
import { attachmentsForReport, findDeveloper, findDeveloperByUsername, findProjectBySlug, listDevelopers, messagesForReport, placeholders } from './db';
import type { Attachment, Developer, Project, Report } from './models';
import {
    addMessage,
    changeStatus,
    creatorLabel,
    findInProject,
    MAX_ADJUSTMENT_NOTE,
    MAX_MESSAGE,
    mergeNote,
    messageAuthorName,
    sequenceNumber,
    updateAdjustment,
} from './reports';
import { signedAttachmentUrl } from './signed';
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
}

const GENERATED_PASSWORD_LENGTH = 24;

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
    if (!filters.includeDeleted) conditions.push('client_deleted_at IS NULL');
    const includePublic = filters.includePublic === true || creator === 'public';
    if (!includePublic) conditions.push("creator_type <> 'public'");
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { results } = await ctx.env.DB.prepare(
        `WITH numbered AS (
            SELECT r.*,
                ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS number,
                CASE WHEN creator_type = 'client' THEN ROW_NUMBER() OVER (PARTITION BY creator_type = 'client' ORDER BY created_at DESC, id DESC) END AS client_number,
                (SELECT COUNT(*) FROM messages m WHERE m.report_id = r.id) AS messages_count,
                (SELECT COUNT(*) FROM attachments a WHERE a.report_id = r.id) AS attachments_count
            FROM reports r WHERE project_id = ?
        )
        SELECT n.*, d.name AS developer_name FROM numbered n LEFT JOIN developers d ON d.id = n.creator_developer_id ${where}
        ORDER BY created_at DESC, id DESC`,
    )
        .bind(project.id, ...bindings)
        .all<Report & { number: number; client_number: number | null; messages_count: number; attachments_count: number; developer_name: string | null }>();
    return {
        project: project.slug,
        include_public: includePublic,
        reports: results.map((report) => ({
            number: report.number,
            client_number: report.client_number,
            public_id: report.public_id,
            status: report.status,
            status_label: statusLabel(report.status),
            creator_type: report.creator_type,
            creator: creatorLabel(ctx.env, report, project, report.developer_name),
            source: report.creator_type === 'public' ? 'public_stranger' : 'project_member',
            title: report.title,
            messages_count: report.messages_count,
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
    const [attachments, messages, developer] = await Promise.all([
        attachmentsForReport(ctx.env.DB, report.id),
        messagesForReport(ctx.env.DB, report.id),
        report.creator_developer_id ? findDeveloper(ctx.env.DB, report.creator_developer_id) : Promise.resolve(null),
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
        creator: creatorLabel(ctx.env, report, project, developer?.name ?? null),
        source: report.creator_type === 'public' ? 'public_stranger' : 'project_member',
        deleted_by_client: report.client_deleted_at !== null,
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
                author: message.author_name || (message.author_type === 'owner' ? labels.owner : message.author_type === 'agent' ? 'Vibe coding' : labels.client),
                created_at: message.created_at,
                body: message.body,
                attachments: await attachmentData(ctx, attachments.filter((a) => a.message_id === message.id)),
            })),
        ),
    };
}

export async function setReportStatus(ctx: TeamContext, slug: string, identifier: string, statusInput: string) {
    const project = await projectOrFail(ctx.env, slug);
    const status = statusFromInput(statusInput);
    if (!status) {
        throw new ServiceError('invalid_status', `不認得的狀態。可用值：${describedStatusOptions()}`, 422);
    }
    const report = await resolveReport(ctx.env, project, identifier);
    await changeStatus(ctx.env, report, status, ctx.now);
    return {
        public_id: report.public_id,
        title: report.title,
        previous: { status: report.status, label: statusLabel(report.status) },
        current: { status, label: statusLabel(status) },
    };
}

export async function writeAdjustment(
    ctx: TeamContext,
    slug: string,
    identifier: string,
    input: { note?: string | null; append?: boolean; upload_ids?: string[]; by_id?: boolean },
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
    await updateAdjustment(
        ctx.env,
        report,
        { note: hasNote ? (input.note as string) : undefined, append: input.append ?? false, uploads, removeAttachmentIds: [] },
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
    await addMessage(ctx.env, report, { author_type: 'owner', author_name: author, body, uploads }, ctx.now);
    return { public_id: report.public_id, title: report.title, author, images_added: uploads.length };
}

// ------------------------------------------------------------------ projects

function projectLinks(ctx: TeamContext, project: Project, tokens: { client?: string | null; owner?: string | null }) {
    return {
        client_link: tokens.client ? `${absolute(ctx, paths.clientAccess(project.slug))}?token=${tokens.client}` : null,
        owner_link: tokens.owner ? `${absolute(ctx, paths.ownerAccess(project.slug))}?token=${tokens.owner}` : null,
    };
}

function projectSummary(ctx: TeamContext, project: Project) {
    return {
        slug: project.slug,
        name: project.name,
        client_name: project.client_display_name,
        has_client_link: project.client_token_hash !== null,
        client_username: project.client_username,
        public_reporting_enabled: project.public_reporting_enabled === 1,
        is_home_public_project: config(ctx.env).publicReporting.homeProject === project.slug,
        portal_url: absolute(ctx, paths.portal(project.slug)),
        created_at: project.created_at,
    };
}

export async function listProjects(ctx: TeamContext) {
    const { results } = await ctx.env.DB.prepare('SELECT * FROM projects ORDER BY created_at, id').all<Project>();
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

/** Sets the project's client account with a generated password; the old password and its logins stop working. */
export async function setClientAccount(ctx: TeamContext, slug: string, input: { username: string; prefill?: boolean }) {
    const project = await projectOrFail(ctx.env, slug);
    const username = validateUsername(input.username);
    const password = randomString(GENERATED_PASSWORD_LENGTH);
    const prefill = input.prefill === true;
    await ctx.env.DB.prepare(
        'UPDATE projects SET client_username = ?, client_password_hash = ?, login_prefill_username = ?, login_prefill_password = ?, updated_at = ? WHERE id = ?',
    )
        .bind(username, await hashPassword(password), prefill ? username : null, prefill ? password : null, nowIso(ctx.now), project.id)
        .run();
    return {
        project: project.slug,
        username,
        password,
        prefill,
        prefill_active: prefill && config(ctx.env).loginPrefill.enabled,
        login_url: absolute(ctx, paths.login(project.slug)),
    };
}

export async function setPublicReporting(ctx: TeamContext, slug: string, input: { enabled: boolean; force?: boolean }) {
    const project = await projectOrFail(ctx.env, slug);
    const clientAccess = Object.entries({
        client_username: project.client_username,
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
    return { id: developer.id, username: developer.username, name: developer.name, created_at: developer.created_at };
}

export async function listTeam(ctx: TeamContext) {
    return { developers: (await listDevelopers(ctx.env.DB)).map(developerSummary) };
}

export async function createDeveloper(ctx: TeamContext, input: { username: string; name?: string }) {
    const username = validateUsername(input.username);
    if (await findDeveloperByUsername(ctx.env.DB, username)) {
        throw new ServiceError('developer_exists', '這個帳號已經存在；要重設密碼請用 developer reset。', 409);
    }
    const name = input.name && input.name.trim() !== '' ? input.name.trim() : username;
    if (charLength(name) > 100) {
        throw new ServiceError('invalid_name', '顯示名稱不可超過 100 字。', 422);
    }
    const password = randomString(GENERATED_PASSWORD_LENGTH);
    const at = nowIso(ctx.now);
    const developer = await ctx.env.DB.prepare('INSERT INTO developers (name, username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING *')
        .bind(name, username, await hashPassword(password), at, at)
        .first<Developer>();
    return { developer: developerSummary(developer as Developer), password };
}

export async function resetDeveloper(ctx: TeamContext, input: { username: string; name?: string }) {
    const username = validateUsername(input.username);
    const developer = await findDeveloperByUsername(ctx.env.DB, username);
    if (!developer) {
        throw new ServiceError('developer_not_found', '找不到這個團隊帳號。', 404);
    }
    const password = randomString(GENERATED_PASSWORD_LENGTH);
    const name = input.name && input.name.trim() !== '' ? input.name.trim() : developer.name;
    await ctx.env.DB.prepare('UPDATE developers SET name = ?, password_hash = ?, updated_at = ? WHERE id = ?').bind(name, await hashPassword(password), nowIso(ctx.now), developer.id).run();
    return { developer: developerSummary({ ...developer, name }), password };
}

// ------------------------------------------------------------------ API tokens

export async function createToken(env: Env, developerId: number, name: string, now: number) {
    const token = `fdk_${randomString(40)}`;
    const row = await env.DB.prepare('INSERT INTO api_tokens (developer_id, name, token_hash, created_at) VALUES (?, ?, ?, ?) RETURNING id, name, created_at')
        .bind(developerId, name.trim() === '' ? 'cli' : name.trim().slice(0, 100), await sha256Hex(token), nowIso(now))
        .first<{ id: number; name: string; created_at: string }>();
    return { token, id: row?.id ?? 0, name: row?.name ?? name, created_at: row?.created_at ?? nowIso(now) };
}

export async function listTokens(ctx: TeamContext, currentTokenId: number) {
    const { results } = await ctx.env.DB.prepare('SELECT id, name, last_used_at, created_at FROM api_tokens WHERE developer_id = ? ORDER BY id')
        .bind(ctx.developer.id)
        .all<{ id: number; name: string; last_used_at: string | null; created_at: string }>();
    return { tokens: results.map((token) => ({ ...token, current: token.id === currentTokenId })) };
}

export async function revokeToken(ctx: TeamContext, tokenId: number) {
    const result = await ctx.env.DB.prepare('DELETE FROM api_tokens WHERE id = ? AND developer_id = ?').bind(tokenId, ctx.developer.id).run();
    if ((result.meta.changes ?? 0) === 0) {
        throw new ServiceError('token_not_found', '找不到這個 token（只能撤銷自己的 token）。', 404);
    }
    return { revoked: tokenId };
}
