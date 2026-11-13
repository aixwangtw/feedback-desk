import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describedStatusOptions, statusFromInput } from '../../shared/status';
import { ATTACHMENT_TYPE_ERROR, DETECT_HEAD_BYTES, detectAttachmentType, imageTooLarge, isVideoMime, MAX_FILES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, TOO_MANY_ATTACHMENTS, VIDEO_TOO_LARGE } from '../../shared/attachment-rules';
import { COMPLETED_BY_CLIENT_ONLY } from '../../shared/work-rule';
import { ADJUSTMENT_DEPRECATED } from '../../shared/completion';
import { encodePath } from '../api';
import { bool, list, parse, requirePositional, str } from '../args';
import { escapeInline, escapeTerminal, table, twoColumn } from '../output';
import { CliError, type Runtime } from '../runtime';
import { apiFor } from './auth';

const MAX_IMAGES = MAX_FILES;

/** 附圖路徑：--attach（新）與 --image（舊名相容）可以混用。 */
function attachPaths(args: ReturnType<typeof parse>): string[] {
    return [...list(args, 'image'), ...list(args, 'attach')].filter((path) => path !== '');
}

interface ListedReport {
    number: number;
    client_number: number | null;
    public_id: string;
    status: string;
    status_label: string;
    creator_type: string;
    creator: string;
    source: string;
    title: string;
    messages_count: number;
    unread_messages_count: number;
    latest_message_at: string | null;
    attachments_count: number;
    deleted_by_client: boolean;
    latest_activity_at: string;
}

interface AttachmentInfo {
    id: number;
    original_name: string;
    mime_type: string;
    size: number;
    url: string;
    path?: string | null;
}

interface ReportDetail {
    number: number;
    client_number: number | null;
    public_id: string;
    project: string;
    title: string;
    status: string;
    status_label: string;
    creator_type: string;
    creator: string;
    source: string;
    deleted_by_client: boolean;
    created_at: string;
    updated_at: string;
    latest_activity_at: string;
    page_url: string | null;
    url: string;
    description: string;
    attachments: AttachmentInfo[];
    adjustment_note: string | null;
    adjustment_attachments: AttachmentInfo[];
    messages: Array<{ id?: number; author_type: string; author: string; created_at: string; body: string; attachments: AttachmentInfo[] }>;
    /** Team side only. */
    claim?: { by: string; since: string; yours: boolean } | null;
    handoff_notes?: Array<{ author: string; created_at: string; note: string }>;
}

/** "2026-10-14 10:30" in UTC+8 by default (FEEDBACK_DESK_UTC_OFFSET to change), without Intl. */
function time(rt: Runtime, iso: string | null | undefined): string {
    if (!iso) return '';
    const offset = Number(rt.env.FEEDBACK_DESK_UTC_OFFSET_MINUTES ?? 480);
    const date = new Date(Date.parse(iso) + (Number.isFinite(offset) ? offset : 480) * 60_000);
    return date.toISOString().slice(0, 16).replace('T', ' ');
}

export async function reports(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, {
        status: { type: 'string', multiple: true },
        creator: { type: 'string' },
        'include-deleted': { type: 'boolean' },
        'include-public': { type: 'boolean' },
        unread: { type: 'boolean' },
    });
    const slug = requirePositional(args, 0, '<project>');
    for (const input of list(args, 'status')) {
        // CLI 不知道站台的客戶稱呼：「等…」先放行，伺服器再照站台設定確認。
        if (!statusFromInput(input, null)) {
            throw new CliError(`不認得的狀態「${input}」。可用值：${describedStatusOptions(null)}`);
        }
    }
    const query = new URLSearchParams();
    for (const input of list(args, 'status')) query.append('status', input);
    if (str(args, 'creator')) query.set('creator', str(args, 'creator') as string);
    if (bool(args, 'include-deleted')) query.set('include_deleted', '1');
    if (bool(args, 'include-public')) query.set('include_public', '1');
    if (bool(args, 'unread')) query.set('unread', '1');
    const api = apiFor(rt, str(args, 'url'));
    const result = await api.get<{ reports: ListedReport[]; include_public: boolean; account_type?: string }>(`/projects/${encodePath(slug)}/reports?${query.toString()}`);
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result.reports, null, 2));
        return 0;
    }
    if (result.reports.length === 0) {
        rt.out(bool(args, 'unread') ? '沒有未讀留言的回饋單。' : '沒有符合條件的回饋單。');
    } else {
        rt.out(
            table(
                ['編號', 'public_id', '狀態', '建立者', '標題', '留言', '未讀', '附件', '最後更新'],
                result.reports.map((report) => [
                    String(report.number),
                    report.public_id,
                    report.status_label + (report.deleted_by_client ? '（已刪除）' : ''),
                    report.creator,
                    report.title,
                    String(report.messages_count),
                    String(report.unread_messages_count ?? 0),
                    String(report.attachments_count),
                    time(rt, report.latest_activity_at),
                ]),
            ),
        );
        if (result.account_type === 'client') {
            rt.out('（客戶帳號）編號是客戶頁面的清單編號；「未讀」是你還沒看過的團隊回覆。');
            return 0;
        }
        rt.out('編號為開發團隊頁面的清單編號；客戶頁面只算客戶建立的單，編號可能不同（--json 有 client_number）。');
        rt.out('「未讀」是團隊還沒在網頁上看過的客戶留言數；用 CLI 讀單不會標為已讀。--unread 只列有未讀留言的單。');
    }
    if (!result.include_public && result.account_type !== 'client') {
        rt.out('預設不列首頁公開回報（陌生人寫的單）；要看請加 --include-public 或 --creator=public。');
    }
    return 0;
}

function safeName(name: string): string {
    return basename(name).replace(/[^\w.\-一-鿿]+/g, '_').slice(0, 80) || 'image';
}

/** ~/.cache/feedback-desk (XDG_CACHE_HOME; %LOCALAPPDATA% on Windows): private to this user, unlike /tmp. */
export function cacheDir(rt: Runtime): string {
    if (rt.platform === 'win32' && rt.env.LOCALAPPDATA) {
        return join(rt.env.LOCALAPPDATA, 'feedback-desk', 'cache');
    }
    return join(rt.env.XDG_CACHE_HOME || join(rt.home, '.cache'), 'feedback-desk');
}

/** Creates each level with mode 700 so other users on the machine cannot list or read attachments. */
function makePrivateDir(base: string, parts: string[]): string {
    let current = base;
    mkdirSync(current, { recursive: true, mode: 0o700 });
    for (const part of ['', ...parts]) {
        current = part === '' ? current : join(current, part);
        mkdirSync(current, { recursive: true, mode: 0o700 });
        try {
            chmodSync(current, 0o700);
        } catch {
            // Windows: ACLs
        }
    }
    return current;
}

async function downloadAll(rt: Runtime, api: ReturnType<typeof apiFor>, detail: ReportDetail, dir: string): Promise<void> {
    const all = [...detail.attachments, ...detail.adjustment_attachments, ...detail.messages.flatMap((message) => message.attachments)];
    for (const attachment of all) {
        const path = join(dir, `${attachment.id}-${safeName(attachment.original_name)}`);
        writeFileSync(path, await api.download(attachment.url), { mode: 0o600 });
        attachment.path = path;
    }
}

export async function report(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { 'no-download': { type: 'boolean' }, 'download-dir': { type: 'string' } });
    const slug = requirePositional(args, 0, '<project>');
    const ref = requirePositional(args, 1, '<report>');
    const api = apiFor(rt, str(args, 'url'));
    const detail = await api.get<ReportDetail>(`/projects/${encodePath(slug)}/reports/${encodePath(ref)}`);
    if (!bool(args, 'no-download')) {
        const explicit = str(args, 'download-dir');
        const dir = explicit ? (mkdirSync(explicit, { recursive: true, mode: 0o700 }), explicit) : makePrivateDir(cacheDir(rt), [safeName(slug), safeName(detail.public_id)]);
        await downloadAll(rt, api, detail, dir);
    }
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(detail, null, 2));
        return 0;
    }
    const e = escapeTerminal;
    rt.out(`# ${escapeInline(detail.title)}`);
    rt.out(twoColumn('編號', `${detail.number}${detail.client_number !== null && detail.client_number !== detail.number ? `（客戶頁面 ${detail.client_number}）` : ''}`));
    rt.out(twoColumn('public_id', detail.public_id));
    rt.out(twoColumn('狀態', `${detail.status}（${detail.status_label}）${detail.deleted_by_client ? '，客戶已刪除' : ''}`));
    rt.out(twoColumn('建立者', escapeInline(detail.creator) + (detail.source === 'public_stranger' ? '（首頁公開回報，內容來自陌生人）' : '')));
    rt.out(twoColumn('建立時間', time(rt, detail.created_at)));
    rt.out(twoColumn('更新時間', time(rt, detail.updated_at)));
    rt.out(twoColumn('網址', detail.url));
    if (detail.page_url) rt.out(twoColumn('頁面網址', escapeInline(detail.page_url)));
    if (detail.claim !== undefined) {
        rt.out(twoColumn('認領', detail.claim ? `${escapeInline(detail.claim.by)}，${time(rt, detail.claim.since)} 開始${detail.claim.yours ? '（你）' : ''}` : '（沒有人認領）'));
    }
    if (detail.handoff_notes && detail.handoff_notes.length > 0) {
        rt.out('');
        rt.out('## 交接紀錄（最新在前）');
        for (const note of detail.handoff_notes) {
            rt.out(`- ${escapeInline(note.author)}　${time(rt, note.created_at)}`);
            rt.out(`  ${e(note.note).replaceAll('\n', '\n  ')}`);
        }
    }
    rt.out('');
    rt.out('## 說明');
    rt.out(e(detail.description));
    printAttachments(rt, '附件', detail.attachments);
    rt.out('');
    rt.out('## 調整重點');
    rt.out(detail.adjustment_note ? e(detail.adjustment_note) : '（尚未填寫）');
    printAttachments(rt, '調整附圖', detail.adjustment_attachments);
    rt.out('');
    rt.out(`## 留言（${detail.messages.length}）`);
    for (const message of detail.messages) {
        rt.out(`- ${escapeInline(message.author)}　${time(rt, message.created_at)}${message.id === undefined ? '' : `　（留言 id ${message.id}）`}`);
        rt.out(`  ${e(message.body).replaceAll('\n', '\n  ')}`);
        printAttachments(rt, '附件', message.attachments, '  ');
    }
    return 0;
}

function printAttachments(rt: Runtime, label: string, attachments: AttachmentInfo[], indent = ''): void {
    if (attachments.length === 0) return;
    rt.out(`${indent}${label}：`);
    for (const attachment of attachments) {
        rt.out(`${indent}  - ${escapeInline(attachment.original_name)}　${attachment.path ?? `${attachment.url}（一小時內有效）`}`);
    }
}

/**
 * Reads and checks local files before anything is sent. `allowVideo`（開單、message、draft 的 --attach）另收影片
 * （mp4、mov、webm），每支 100 MB；圖片每張 10 MB。調整重點只收圖片。
 */
export function readImages(paths: string[], options: { allowVideo?: boolean } = {}): Array<{ path: string; name: string; bytes: Uint8Array; mime: string }> {
    const allowVideo = options.allowVideo === true;
    return paths.map((path) => {
        let size: number;
        try {
            const stat = statSync(path);
            if (!stat.isFile()) throw new Error('not a file');
            size = stat.size;
        } catch {
            throw new CliError(`找不到或無法讀取${allowVideo ? '圖片／影片' : '圖片'}：${path}`);
        }
        if (size > (allowVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
            throw new CliError(allowVideo ? `${VIDEO_TOO_LARGE.replace(/。$/, '')}：${path}` : `圖片超過 10 MB：${path}`);
        }
        const bytes = new Uint8Array(readFileSync(path));
        const mime = detectAttachmentType(bytes.subarray(0, DETECT_HEAD_BYTES), allowVideo);
        if (!mime && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-') {
            throw new CliError(`不收 PDF，請先轉成 jpg／png／webp 圖片再附：${path}`);
        }
        if (!mime) {
            throw new CliError(allowVideo ? `${ATTACHMENT_TYPE_ERROR.replace(/。$/, '')}：${path}` : `只接受 jpg／png／webp 圖片：${path}`);
        }
        if (!isVideoMime(mime) && size > MAX_IMAGE_BYTES) {
            throw new CliError(`${imageTooLarge(MAX_IMAGE_BYTES).replace(/。$/, '')}：${path}`);
        }
        return { path, name: basename(path), bytes, mime };
    });
}

export async function adjust(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { 'by-id': { type: 'boolean' }, note: { type: 'string' }, append: { type: 'boolean' }, image: { type: 'string', multiple: true }, force: { type: 'boolean' } });
    const slug = requirePositional(args, 0, '<project>');
    const ref = requirePositional(args, 1, '<report public_id>');
    const byId = bool(args, 'by-id');
    if (/^\d+$/.test(ref) && !byId) {
        throw new CliError('純數字不能直接指定回饋單：請改用 public_id（或加 --by-id 指定資料庫 id）。');
    }
    const note = str(args, 'note');
    const append = bool(args, 'append');
    const imagePaths = list(args, 'image').filter((path) => path !== '');
    if (note === undefined && imagePaths.length === 0) {
        throw new CliError('請至少提供 --note 或 --image。');
    }
    if (append && note === undefined) {
        throw new CliError('--append 需要搭配 --note。');
    }
    if (imagePaths.length > 5) {
        throw new CliError('一次最多附 5 張圖片。');
    }
    const images = readImages(imagePaths);
    const api = apiFor(rt, str(args, 'url'));
    const by = byId ? '?by=id' : '?by=public_id';
    const base = `/projects/${encodePath(slug)}/reports/${encodePath(ref)}`;
    const uploadIds: string[] = [];
    for (const image of images) {
        const uploaded = await api.upload(`${base}/uploads${by}&purpose=adjustment`, image.bytes, image.name, image.mime);
        uploadIds.push(uploaded.id);
    }
    const result = await api.post<{ public_id: string; title: string; note: string; images_added: number; images_total: number; url: string; warning?: string }>(`${base}/adjustment${by}`, {
        ...(note !== undefined ? { note } : {}),
        append,
        upload_ids: uploadIds,
        ...(bool(args, 'force') ? { force: true } : {}),
    });
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result, null, 2));
        return 0;
    }
    rt.out(`已更新調整重點（已停用，請改用留言）：${escapeInline(result.title)}`);
    if (note !== undefined) rt.out(twoColumn('文字', append ? '已追加' : '已覆寫'));
    rt.out(twoColumn('新增圖片', String(result.images_added)));
    rt.out(twoColumn('目前圖片總數', String(result.images_total)));
    // 調整重點已停用：照常寫入，但提醒改用留言。
    rt.out(escapeInline(result.warning ?? ADJUSTMENT_DEPRECATED));
    rt.out(result.url);
    return 0;
}

/**
 * 請客戶確認完成：只發一則附「通過」按鈕的確認留言，單維持等客戶，不會直接結案。
 * 只用 --text 帶文字，沒給就用預設文字；不讀標準輸入，沒有終端機的環境（ssh、排程）不會卡住。
 */
export async function requestCompletion(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { text: { type: 'string' }, force: { type: 'boolean' } });
    const slug = requirePositional(args, 0, '<project>');
    const ref = requirePositional(args, 1, '<report public_id>');
    if (/^\d+$/.test(ref.trim())) {
        throw new CliError('純數字不能指定回饋單：請改用網址中的 public_id。');
    }
    const text = str(args, 'text');
    const api = apiFor(rt, str(args, 'url'));
    const result = await api.post<{ title: string; message_id: number; status: string; status_label: string; notice: string; url: string; took_over_from?: string | null }>(
        `/projects/${encodePath(slug)}/reports/${encodePath(ref)}/request-completion`,
        { ...(text !== undefined && text.trim() !== '' ? { body: text } : {}), ...(bool(args, 'force') ? { force: true } : {}) },
    );
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result, null, 2));
        return 0;
    }
    rt.out(`已請確認完成：${escapeInline(result.title)}`);
    if (result.took_over_from) rt.out(twoColumn('接手自', escapeInline(result.took_over_from)));
    rt.out(twoColumn('留言 id', String(result.message_id)));
    rt.out(twoColumn('目前狀態', `${result.status}（${result.status_label}）`));
    rt.out(escapeInline(result.notice));
    rt.out(result.url);
    return 0;
}

export async function status(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { force: { type: 'boolean' } });
    const slug = requirePositional(args, 0, '<project>');
    const ref = requirePositional(args, 1, '<report>');
    const input = requirePositional(args, 2, '<status>');
    if (!statusFromInput(input, null)) {
        throw new CliError(`不認得的狀態。可用值：${describedStatusOptions(null)}`);
    }
    // 已完成只由客戶在網頁上按「完成」：送出前就擋下（伺服器也會擋）。
    if (statusFromInput(input, null) === 'completed') {
        throw new CliError(COMPLETED_BY_CLIENT_ONLY);
    }
    const api = apiFor(rt, str(args, 'url'));
    const result = await api.post<{ title: string; previous: { status: string; label: string }; current: { status: string; label: string } }>(
        `/projects/${encodePath(slug)}/reports/${encodePath(ref)}/status`,
        { status: input, ...(bool(args, 'force') ? { force: true } : {}) },
    );
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result, null, 2));
        return 0;
    }
    rt.out(`已更新狀態：${escapeInline(result.title)}`);
    rt.out(twoColumn('原狀態', `${result.previous.status}（${result.previous.label}）`));
    rt.out(twoColumn('新狀態', `${result.current.status}（${result.current.label}）`));
    return 0;
}

export async function message(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { body: { type: 'string' }, image: { type: 'string', multiple: true }, attach: { type: 'string', multiple: true } });
    const slug = requirePositional(args, 0, '<project>');
    const ref = requirePositional(args, 1, '<report>');
    const body = str(args, 'body');
    if (!body || body.trim() === '') {
        throw new CliError('請用 --body 提供留言內容。');
    }
    const paths = attachPaths(args);
    if (paths.length > MAX_IMAGES) {
        throw new CliError(TOO_MANY_ATTACHMENTS);
    }
    const images = readImages(paths, { allowVideo: true });
    const api = apiFor(rt, str(args, 'url'));
    const base = `/projects/${encodePath(slug)}/reports/${encodePath(ref)}`;
    const uploadIds: string[] = [];
    for (const image of images) {
        uploadIds.push((await api.upload(`${base}/uploads?purpose=message`, image.bytes, image.name, image.mime)).id);
    }
    const result = await api.post<{ title: string; author: string; images_added: number; notice?: string }>(`${base}/messages`, { body, upload_ids: uploadIds });
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result, null, 2));
        return 0;
    }
    rt.out(`已留言：${escapeInline(result.title)}（署名 ${escapeInline(result.author)}，附圖 ${result.images_added} 張）`);
    // 等工程師（new）的單留言後伺服器自動改成等客戶（needs_input），提醒更新調整重點。
    if (result.notice) rt.out(escapeInline(result.notice));
    return 0;
}

/** 編輯團隊身分發的留言：不顯示「已編輯」、不改狀態。--body 是新的完整內容；--attach 新增附件；--remove 移除附件 id。 */
export async function messageEdit(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { body: { type: 'string' }, image: { type: 'string', multiple: true }, attach: { type: 'string', multiple: true }, remove: { type: 'string', multiple: true } });
    const slug = requirePositional(args, 0, '<project>');
    const ref = requirePositional(args, 1, '<report>');
    const messageId = requirePositional(args, 2, '<message id>');
    const body = str(args, 'body');
    if (!body || body.trim() === '') {
        throw new CliError('請用 --body 提供新的留言內容。');
    }
    const paths = attachPaths(args);
    if (paths.length > MAX_IMAGES) {
        throw new CliError(TOO_MANY_ATTACHMENTS);
    }
    const images = readImages(paths, { allowVideo: true });
    const api = apiFor(rt, str(args, 'url'));
    const base = `/projects/${encodePath(slug)}/reports/${encodePath(ref)}`;
    const uploadIds: string[] = [];
    for (const image of images) {
        uploadIds.push((await api.upload(`${base}/uploads?purpose=message`, image.bytes, image.name, image.mime)).id);
    }
    const remove = ((args.values.remove as string[] | undefined) ?? []).map(Number).filter((id) => Number.isInteger(id));
    const result = await api.put<{ title: string; message_id: number }>(`${base}/messages/${encodePath(messageId)}`, { body, upload_ids: uploadIds, remove_attachment_ids: remove });
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result, null, 2));
        return 0;
    }
    rt.out(`已更新留言 ${result.message_id}：${escapeInline(result.title)}`);
    return 0;
}

/** 收回團隊身分發的留言：客戶端完全看不到痕跡。 */
export async function messageWithdraw(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, {});
    const slug = requirePositional(args, 0, '<project>');
    const ref = requirePositional(args, 1, '<report>');
    const messageId = requirePositional(args, 2, '<message id>');
    const api = apiFor(rt, str(args, 'url'));
    const result = await api.delete<{ title: string; message_id: number }>(`/projects/${encodePath(slug)}/reports/${encodePath(ref)}/messages/${encodePath(messageId)}`);
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result, null, 2));
        return 0;
    }
    rt.out(`已收回留言 ${result.message_id}：${escapeInline(result.title)}`);
    return 0;
}

/**
 * 待審留言（草稿）：只有團隊看得到，團隊在單頁按「送出」才發給客戶。--replace-message 指定要修改的
 * 團隊留言（送出時改寫，不新增）。附圖沿用開單、留言的 --attach 檢查規則。
 */
export async function draft(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, {
        body: { type: 'string' },
        text: { type: 'string' },
        'replace-message': { type: 'string' },
        image: { type: 'string', multiple: true },
        attach: { type: 'string', multiple: true },
    });
    const slug = requirePositional(args, 0, '<project>');
    const ref = requirePositional(args, 1, '<report public_id>');
    if (/^\d+$/.test(ref.trim())) {
        throw new CliError('純數字不能指定回饋單：請改用網址中的 public_id。');
    }
    const body = str(args, 'body') ?? str(args, 'text');
    if (!body || body.trim() === '') {
        throw new CliError('請用 --body（或 --text）提供待審留言內容。');
    }
    const replace = str(args, 'replace-message');
    if (replace !== undefined && !/^\d+$/.test(replace.trim())) {
        throw new CliError('--replace-message 要填留言 id（數字）。');
    }
    const paths = attachPaths(args);
    if (paths.length > MAX_IMAGES) {
        throw new CliError(TOO_MANY_ATTACHMENTS);
    }
    // 先全部檢查過再上傳：任何一個不合格，草稿就不建立。
    const images = readImages(paths, { allowVideo: true });
    const api = apiFor(rt, str(args, 'url'));
    const base = `/projects/${encodePath(slug)}/reports/${encodePath(ref)}`;
    const uploadIds: string[] = [];
    for (const image of images) {
        uploadIds.push((await api.upload(`${base}/uploads?purpose=message`, image.bytes, image.name, image.mime)).id);
    }
    const result = await api.post<{ title: string; images_added: number; draft: { id: number; body: string; replaces_message_id: number | null; report_url: string } }>(`${base}/drafts`, {
        body,
        upload_ids: uploadIds,
        ...(replace !== undefined ? { replace_message_id: Number(replace.trim()) } : {}),
    });
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result, null, 2));
        return 0;
    }
    rt.out(`已新增待審留言：${escapeInline(result.title)}（客戶看不到，團隊在單頁按「送出」才會發出）`);
    rt.out(twoColumn('草稿 id', String(result.draft.id)));
    rt.out(twoColumn('修改原留言', result.draft.replaces_message_id !== null ? String(result.draft.replaces_message_id) : '否（送出時新增一則）'));
    rt.out(twoColumn('附圖', String(result.images_added)));
    rt.out(`${result.draft.report_url}#message-drafts`);
    return 0;
}

/** Claim / release a report, so others (people and AI tools) see who is working on it. */
export async function claim(rt: Runtime, argv: string[], release = false): Promise<number> {
    const args = parse(argv, { force: { type: 'boolean' } });
    const slug = requirePositional(args, 0, '<project>');
    const ref = requirePositional(args, 1, '<report>');
    const api = apiFor(rt, str(args, 'url'));
    const result = await api.post<{ title: string; claimed_by?: string; took_over_from?: string | null; released?: boolean }>(
        `/projects/${encodePath(slug)}/reports/${encodePath(ref)}/${release ? 'release' : 'claim'}`,
        { force: bool(args, 'force') },
    );
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result, null, 2));
        return 0;
    }
    if (release) {
        rt.out(result.released ? `已釋放：${escapeInline(result.title)}` : `這張單本來就沒有人認領：${escapeInline(result.title)}`);
    } else {
        rt.out(`已認領：${escapeInline(result.title)}（${escapeInline(result.claimed_by ?? '')}）`);
        if (result.took_over_from) rt.out(`已接手，原本是 ${escapeInline(result.took_over_from)}（已記錄）。`);
    }
    return 0;
}

export function release(rt: Runtime, argv: string[]): Promise<number> {
    return claim(rt, argv, true);
}

/** Progress note for whoever continues the work. */
export async function handoff(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { note: { type: 'string' }, release: { type: 'boolean' } });
    const slug = requirePositional(args, 0, '<project>');
    const ref = requirePositional(args, 1, '<report>');
    const note = str(args, 'note');
    if (!note || note.trim() === '') {
        throw new CliError('請用 --note 寫下做到哪、下一步。');
    }
    const api = apiFor(rt, str(args, 'url'));
    const result = await api.post<{ title: string; released: boolean }>(`/projects/${encodePath(slug)}/reports/${encodePath(ref)}/handoff`, { note, release: bool(args, 'release') });
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result, null, 2));
        return 0;
    }
    rt.out(`已寫交接紀錄：${escapeInline(result.title)}${result.released ? '，並釋放認領' : ''}`);
    return 0;
}

/** New report (team or client account), with images. */
export async function create(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, {
        title: { type: 'string' },
        description: { type: 'string' },
        category: { type: 'string' },
        image: { type: 'string', multiple: true },
        attach: { type: 'string', multiple: true },
        'for-client': { type: 'boolean' },
        notice: { type: 'string' },
    });
    const slug = requirePositional(args, 0, '<project>');
    const title = str(args, 'title');
    const description = str(args, 'description');
    if (!title || title.trim() === '' || !description || description.trim() === '') {
        throw new CliError('請用 --title 與 --description 寫下問題。');
    }
    const forClient = bool(args, 'for-client');
    const notice = str(args, 'notice');
    if (notice !== undefined && !forClient) {
        throw new CliError('--notice 需要搭配 --for-client。');
    }
    const paths = attachPaths(args);
    if (paths.length > MAX_IMAGES) {
        throw new CliError(`一張單最多附 ${MAX_IMAGES} 張圖。`);
    }
    // 先全部檢查過再上傳：任何一張不合格，整張單都不建立。
    const images = readImages(paths, { allowVideo: true });
    const api = apiFor(rt, str(args, 'url'));
    const uploadIds: string[] = [];
    for (const image of images) {
        uploadIds.push((await api.upload(`/projects/${encodePath(slug)}/uploads`, image.bytes, image.name, image.mime)).id);
    }
    const category = str(args, 'category');
    const result = await api.post<{ public_id: string; title: string; url: string; images_added: number }>(`/projects/${encodePath(slug)}/reports`, { title, description, ...(category ? { category } : {}), upload_ids: uploadIds, ...(forClient ? { for_client: true } : {}), ...(notice !== undefined ? { notice } : {}) });
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result, null, 2));
        return 0;
    }
    rt.out(`已開單：${escapeInline(result.title)}（附圖 ${result.images_added} 張）`);
    rt.out(twoColumn('public_id', result.public_id));
    if (forClient) rt.out(twoColumn('客戶', '已分享給客戶，並留了通知留言'));
    rt.out(result.url);
    return 0;
}
