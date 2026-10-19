/**
 * What a client account can do through the API (CLI) and MCP: the same as on the web pages, for
 * its own project only. Reports the team keeps to itself (team-created, public, deleted by the
 * client) do not exist here, and numbers are the client-side list numbers.
 */
import { statusLabel } from '../../shared/status';
import { charLength } from '../../shared/text';
import type { Env } from '../env';
import { config } from '../env';
import type { Author } from './access';
import { withAgent } from './agents';
import { attachmentsForReport, findClientAccount, findProjectBySlug, messagesForReport } from './db';
import type { Attachment, ClientAccount, Project, Report } from './models';
import {
    addMessage,
    clientReadAt,
    createReport,
    creatorClientNameSql,
    creatorLabel,
    latestMessageSql,
    markRead,
    MAX_MESSAGE,
    messageAuthorName,
    sequenceNumber,
    viewerReadAtColumnSql,
    viewerUnreadSql,
} from './reports';
import { signedAttachmentUrl } from './signed';
import { ServiceError, validateNewReport } from './team';
import { findClaimableUploads } from './uploads';
import { paths } from '../routes/paths';

export interface ClientContext {
    env: Env;
    origin: string;
    account: ClientAccount;
    project: Project;
    now: number;
    agent?: string | null;
}

export function clientAuthor(ctx: ClientContext): Author {
    return { developerId: null, clientAccountId: ctx.account.id, name: ctx.account.name, agent: ctx.agent ?? null };
}

/** Other projects answer exactly like a project that does not exist. */
export async function ownProject(ctx: ClientContext, slug: string): Promise<Project> {
    if (slug !== ctx.project.slug) {
        throw new ServiceError('project_not_found', '找不到回報專案。', 404);
    }
    return (await findProjectBySlug(ctx.env.DB, slug)) ?? ctx.project;
}

const VISIBLE = "creator_type = 'client' AND client_deleted_at IS NULL";

/** public_id, or the client-side list number when all digits. */
export async function resolveOwnReport(ctx: ClientContext, project: Project, identifier: string): Promise<Report> {
    const trimmed = identifier.trim();
    let report: Report | null;
    if (/^\d+$/.test(trimmed)) {
        const position = Number(trimmed);
        report =
            position < 1
                ? null
                : await ctx.env.DB.prepare(`SELECT * FROM reports WHERE project_id = ? AND creator_type = 'client' ORDER BY created_at DESC, id DESC LIMIT 1 OFFSET ?`)
                      .bind(project.id, position - 1)
                      .first<Report>();
        if (report && report.client_deleted_at !== null) {
            report = null;
        }
    } else {
        report = await ctx.env.DB.prepare(`SELECT * FROM reports WHERE project_id = ? AND public_id = ? AND ${VISIBLE}`).bind(project.id, trimmed).first<Report>();
    }
    if (!report) {
        throw new ServiceError('report_not_found', '這個專案裡找不到該回饋單（請用 public_id 或清單編號）。', 404);
    }
    return report;
}

export async function listOwnReports(ctx: ClientContext, slug: string) {
    const project = await ownProject(ctx, slug);
    const { results } = await ctx.env.DB.prepare(
        `WITH numbered AS (
            SELECT r.*, ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS number, ${viewerReadAtColumnSql('r', ctx.account)} FROM reports r WHERE project_id = ? AND creator_type = 'client'
        )
        SELECT n.*, ${viewerUnreadSql('n', false, ctx.account, true)} AS unread_count, ${latestMessageSql('n')} AS latest_message_at, ${creatorClientNameSql('n')} AS creator_client_name,
            (SELECT COUNT(*) FROM messages m WHERE m.report_id = n.id) AS messages_count,
            (SELECT COUNT(*) FROM attachments a WHERE a.report_id = n.id) AS attachments_count
        FROM numbered n WHERE client_deleted_at IS NULL ORDER BY created_at DESC, id DESC`,
    )
        .bind(project.id)
        .all<Report & { number: number; unread_count: number; latest_message_at: string | null; creator_client_name: string | null; messages_count: number; attachments_count: number }>();
    return {
        project: project.slug,
        account_type: 'client',
        include_public: false,
        reports: results.map((report) => ({
            number: report.number,
            client_number: report.number,
            public_id: report.public_id,
            status: report.status,
            status_label: statusLabel(report.status),
            creator_type: report.creator_type,
            creator: withAgent(creatorLabel(ctx.env, report, project, null, report.creator_client_name), report.creator_agent),
            source: 'project_member',
            title: report.title,
            messages_count: report.messages_count,
            /** For a client account: team replies (and adjustment updates) this account has not seen. */
            unread_messages_count: report.unread_count,
            attachments_count: report.attachments_count,
            deleted_by_client: false,
            latest_message_at: report.latest_message_at,
            latest_activity_at: report.latest_activity_at,
        })),
    };
}

async function attachmentData(ctx: ClientContext, attachments: Attachment[]) {
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

/** One report as the client sees it on the web. Reading it through the API does not mark it read. */
export async function getOwnReport(ctx: ClientContext, slug: string, identifier: string) {
    const project = await ownProject(ctx, slug);
    const report = await resolveOwnReport(ctx, project, identifier);
    const [attachments, messages, creator, readAt] = await Promise.all([
        attachmentsForReport(ctx.env.DB, report.id),
        messagesForReport(ctx.env.DB, report.id),
        report.creator_client_account_id ? findClientAccount(ctx.env.DB, report.creator_client_account_id) : Promise.resolve(null),
        clientReadAt(ctx.env.DB, report, ctx.account),
    ]);
    const labels = config(ctx.env).labels;
    return {
        number: await sequenceNumber(ctx.env.DB, report, true),
        public_id: report.public_id,
        project: project.slug,
        title: report.title,
        status: report.status,
        status_label: statusLabel(report.status),
        creator: withAgent(creatorLabel(ctx.env, report, project, null, creator?.name ?? null), report.creator_agent),
        created_at: report.created_at,
        latest_activity_at: report.latest_activity_at,
        last_read_at: readAt,
        url: `${ctx.origin}${paths.report(project.slug, report.public_id)}`,
        description: report.description,
        attachments: await attachmentData(ctx, attachments.filter((a) => a.message_id === null && a.kind === 'feedback')),
        adjustment_note: report.adjustment_note,
        adjustment_attachments: await attachmentData(ctx, attachments.filter((a) => a.kind === 'adjustment')),
        messages: await Promise.all(
            messages.map(async (message) => ({
                author_type: message.author_type,
                author: withAgent(message.author_name || (message.author_type === 'reporter' ? labels.client : labels.owner), message.author_agent),
                created_at: message.created_at,
                body: message.body,
                attachments: await attachmentData(ctx, attachments.filter((a) => a.message_id === message.id)),
            })),
        ),
    };
}

export async function createOwnReport(ctx: ClientContext, slug: string, input: { title?: string; description?: string; upload_ids?: string[] }) {
    const project = await ownProject(ctx, slug);
    const { title, description, uploadIds } = validateNewReport(input);
    const uploads = await findClaimableUploads(ctx.env.DB, uploadIds, { projectId: project.id, purpose: 'report', reportId: null });
    if (uploads === null) {
        throw new ServiceError('invalid_upload', '圖片上傳已失效或不屬於這個專案，請重新上傳。', 422);
    }
    const { report } = await createReport(
        ctx.env,
        project,
        { title, description, uploads, author: clientAuthor(ctx) },
        { creator_type: 'client', creator_developer_id: null, creator_client_account_id: ctx.account.id },
        ctx.now,
    );
    return { public_id: report.public_id, number: await sequenceNumber(ctx.env.DB, report, true), title: report.title, url: `${ctx.origin}${paths.report(project.slug, report.public_id)}`, images_added: uploads.length };
}

export async function postOwnMessage(ctx: ClientContext, slug: string, identifier: string, input: { body: string; upload_ids?: string[] }) {
    const project = await ownProject(ctx, slug);
    const report = await resolveOwnReport(ctx, project, identifier);
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
    const author = messageAuthorName(ctx.env, report, false, null, ctx.account.name);
    await addMessage(ctx.env, report, { author_type: 'reporter', author_name: author, body, uploads, author: clientAuthor(ctx) }, ctx.now);
    await markRead(ctx.env, report, 'client', ctx.now, ctx.account);
    return { public_id: report.public_id, title: report.title, author: withAgent(author, ctx.agent), images_added: uploads.length };
}
