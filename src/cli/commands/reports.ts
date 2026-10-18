import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describedStatusOptions, statusFromInput } from '../../shared/status';
import { encodePath } from '../api';
import { bool, list, parse, requirePositional, str } from '../args';
import { escapeInline, escapeTerminal, table, twoColumn } from '../output';
import { CliError, type Runtime } from '../runtime';
import { apiFor } from './auth';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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
    messages: Array<{ author_type: string; author: string; created_at: string; body: string; attachments: AttachmentInfo[] }>;
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
    });
    const slug = requirePositional(args, 0, '<project>');
    for (const input of list(args, 'status')) {
        if (!statusFromInput(input)) {
            throw new CliError(`不認得的狀態「${input}」。可用值：${describedStatusOptions()}`);
        }
    }
    const query = new URLSearchParams();
    for (const input of list(args, 'status')) query.append('status', input);
    if (str(args, 'creator')) query.set('creator', str(args, 'creator') as string);
    if (bool(args, 'include-deleted')) query.set('include_deleted', '1');
    if (bool(args, 'include-public')) query.set('include_public', '1');
    const api = apiFor(rt, str(args, 'url'));
    const result = await api.get<{ reports: ListedReport[]; include_public: boolean }>(`/projects/${encodePath(slug)}/reports?${query.toString()}`);
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result.reports, null, 2));
        return 0;
    }
    if (result.reports.length === 0) {
        rt.out('沒有符合條件的回饋單。');
    } else {
        rt.out(
            table(
                ['編號', 'public_id', '狀態', '建立者', '標題', '留言', '附件', '最後更新'],
                result.reports.map((report) => [
                    String(report.number),
                    report.public_id,
                    report.status_label + (report.deleted_by_client ? '（已刪除）' : ''),
                    report.creator,
                    report.title,
                    String(report.messages_count),
                    String(report.attachments_count),
                    time(rt, report.latest_activity_at),
                ]),
            ),
        );
        rt.out('編號為開發團隊頁面的清單編號；客戶頁面只算客戶建立的單，編號可能不同（--json 有 client_number）。');
    }
    if (!result.include_public) {
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
    rt.out('');
    rt.out('## 說明');
    rt.out(e(detail.description));
    printAttachments(rt, '附件', detail.attachments);
    rt.out('');
    rt.out('## 調整說明');
    rt.out(detail.adjustment_note ? e(detail.adjustment_note) : '（尚未填寫）');
    printAttachments(rt, '調整附圖', detail.adjustment_attachments);
    rt.out('');
    rt.out(`## 留言（${detail.messages.length}）`);
    for (const message of detail.messages) {
        rt.out(`- ${escapeInline(message.author)}　${time(rt, message.created_at)}`);
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

function detectImage(bytes: Uint8Array): string | null {
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => bytes[i] === byte)) return 'image/png';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return null;
}

/** Reads and checks local images before anything is sent. */
export function readImages(paths: string[]): Array<{ path: string; name: string; bytes: Uint8Array; mime: string }> {
    return paths.map((path) => {
        let size: number;
        try {
            const stat = statSync(path);
            if (!stat.isFile()) throw new Error('not a file');
            size = stat.size;
        } catch {
            throw new CliError(`找不到或無法讀取圖片：${path}`);
        }
        if (size > MAX_IMAGE_BYTES) {
            throw new CliError(`圖片超過 10 MB：${path}`);
        }
        const bytes = new Uint8Array(readFileSync(path));
        const mime = detectImage(bytes);
        if (!mime) {
            throw new CliError(`只接受 jpg／png／webp 圖片：${path}`);
        }
        return { path, name: basename(path), bytes, mime };
    });
}

export async function adjust(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, { 'by-id': { type: 'boolean' }, note: { type: 'string' }, append: { type: 'boolean' }, image: { type: 'string', multiple: true } });
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
    const result = await api.post<{ public_id: string; title: string; note: string; images_added: number; images_total: number; url: string }>(`${base}/adjustment${by}`, {
        ...(note !== undefined ? { note } : {}),
        append,
        upload_ids: uploadIds,
    });
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result, null, 2));
        return 0;
    }
    rt.out(`已更新調整說明：${escapeInline(result.title)}`);
    if (note !== undefined) rt.out(twoColumn('文字', append ? '已追加' : '已覆寫'));
    rt.out(twoColumn('新增圖片', String(result.images_added)));
    rt.out(twoColumn('目前圖片總數', String(result.images_total)));
    rt.out(result.url);
    return 0;
}

export async function status(rt: Runtime, argv: string[]): Promise<number> {
    const args = parse(argv, {});
    const slug = requirePositional(args, 0, '<project>');
    const ref = requirePositional(args, 1, '<report>');
    const input = requirePositional(args, 2, '<status>');
    if (!statusFromInput(input)) {
        throw new CliError(`不認得的狀態。可用值：${describedStatusOptions()}`);
    }
    const api = apiFor(rt, str(args, 'url'));
    const result = await api.post<{ title: string; previous: { status: string; label: string }; current: { status: string; label: string } }>(
        `/projects/${encodePath(slug)}/reports/${encodePath(ref)}/status`,
        { status: input },
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
    const args = parse(argv, { body: { type: 'string' }, image: { type: 'string', multiple: true } });
    const slug = requirePositional(args, 0, '<project>');
    const ref = requirePositional(args, 1, '<report>');
    const body = str(args, 'body');
    if (!body || body.trim() === '') {
        throw new CliError('請用 --body 提供留言內容。');
    }
    const images = readImages(list(args, 'image'));
    const api = apiFor(rt, str(args, 'url'));
    const base = `/projects/${encodePath(slug)}/reports/${encodePath(ref)}`;
    const uploadIds: string[] = [];
    for (const image of images) {
        uploadIds.push((await api.upload(`${base}/uploads?purpose=message`, image.bytes, image.name, image.mime)).id);
    }
    const result = await api.post<{ title: string; author: string; images_added: number }>(`${base}/messages`, { body, upload_ids: uploadIds });
    if (bool(args, 'json')) {
        rt.out(JSON.stringify(result, null, 2));
        return 0;
    }
    rt.out(`已留言：${escapeInline(result.title)}（署名 ${escapeInline(result.author)}，附圖 ${result.images_added} 張）`);
    return 0;
}
