import type { Author } from './access';
import type { Env } from '../env';
import { randomId } from './crypto';
import { placeholders } from './db';
import type { Upload, UploadPurpose } from './models';
import { charSlice } from '../../shared/text';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const PUBLIC_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const PUBLIC_MAX_SCREENSHOTS = 3;
export const MAX_SCREENSHOTS = 5;
/** Uploads that are not attached to anything within this time are deleted. */
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
/** Uploads from public reporters (strangers) are kept for a much shorter time. */
export const PUBLIC_UPLOAD_TTL_MS = 60 * 60 * 1000;

/** Pending uploads that came from public reporters: the home form, or messages on public reports. */
const PUBLIC_PENDING = `(u.purpose = 'public' OR (u.purpose = 'message' AND u.report_id IN (SELECT id FROM reports WHERE creator_type = 'public')))`;

/** Number and total size of public uploads that are not attached to anything yet. */
export async function pendingPublicUploads(db: D1Database): Promise<{ count: number; bytes: number }> {
    const row = await db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(u.size), 0) AS bytes FROM uploads u WHERE ${PUBLIC_PENDING}`).first<{ count: number; bytes: number }>();
    return { count: row?.count ?? 0, bytes: row?.bytes ?? 0 };
}

export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

/** Detects jpg/png/webp from the first bytes; the client-declared type is ignored. */
export function detectImageType(head: Uint8Array): ImageMime | null {
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
        return 'image/jpeg';
    }
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (head.length >= 8 && png.every((byte, i) => head[i] === byte)) {
        return 'image/png';
    }
    if (
        head.length >= 12 &&
        head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
        head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
    ) {
        return 'image/webp';
    }
    return null;
}

export class UploadError extends Error {
    constructor(
        message: string,
        readonly status: 400 | 403 | 404 | 411 | 413 | 415 | 429 = 400,
    ) {
        super(message);
    }
}

/** Keeps a safe display name: no path parts or control characters, at most 200 characters. */
export function sanitizeFilename(raw: string | null | undefined): string {
    let name = raw ?? '';
    try {
        name = decodeURIComponent(name);
    } catch {
        // keep the raw value
    }
    name = name.split(/[\\/]/).pop() ?? '';
    name = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    return charSlice(name === '' ? 'image' : name, 200);
}

/**
 * Streams the request body into R2 after checking the first bytes. The body goes through a
 * FixedLengthStream, so a body longer or shorter than Content-Length fails instead of being stored.
 */
export interface ImageSource {
    body: ReadableStream<Uint8Array> | null;
    /** Declared byte length (Content-Length). */
    length: number;
    filename: string | null;
}

export function imageSourceFromRequest(request: Request): ImageSource {
    const lengthHeader = request.headers.get('content-length');
    return { body: request.body, length: lengthHeader === null ? NaN : Number(lengthHeader), filename: request.headers.get('x-filename') };
}

export async function storeImageStream(
    env: Env,
    input: Request | ImageSource,
    options: { projectId: number; reportId: number | null; purpose: UploadPurpose; maxBytes: number; nowIso: string },
): Promise<Upload> {
    const source = input instanceof Request ? imageSourceFromRequest(input) : input;
    const length = source.length;
    if (!Number.isInteger(length) || length <= 0) {
        throw new UploadError('需要 Content-Length。', 411);
    }
    if (length > options.maxBytes) {
        throw new UploadError(`每張截圖不可超過 ${Math.round(options.maxBytes / 1024 / 1024)} MB。`, 413);
    }
    if (!source.body) {
        throw new UploadError('沒有收到檔案內容。');
    }

    const reader = source.body.getReader();
    const chunks: Uint8Array[] = [];
    let headLength = 0;
    while (headLength < 12) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
        headLength += value.byteLength;
    }
    const head = new Uint8Array(headLength);
    let offset = 0;
    for (const chunk of chunks) {
        head.set(chunk, offset);
        offset += chunk.byteLength;
    }
    const mime = detectImageType(head);
    if (!mime) {
        await reader.cancel();
        throw new UploadError('截圖必須是 jpg、png 或 webp 圖片。', 415);
    }

    const id = randomId(16);
    const key = `p/${options.projectId}/${id}`;
    const fixed = new FixedLengthStream(length);
    const writer = fixed.writable.getWriter();
    const body = source.body;
    // The bytes already read go in first; the rest is piped natively without passing through JS.
    const pump = (async () => {
        await writer.write(head);
        writer.releaseLock();
        reader.releaseLock();
        await body.pipeTo(fixed.writable);
    })();
    const name = sanitizeFilename(source.filename);
    try {
        await Promise.all([
            env.FILES.put(key, fixed.readable, { httpMetadata: { contentType: mime } }),
            pump,
        ]);
    } catch {
        await env.FILES.delete(key).catch(() => undefined);
        throw new UploadError('檔案大小與宣告不符或上傳中斷，請重新上傳。');
    }

    const upload: Upload = {
        id,
        project_id: options.projectId,
        report_id: options.reportId,
        purpose: options.purpose,
        object_key: key,
        original_name: name,
        mime_type: mime,
        size: length,
        created_at: options.nowIso,
    };
    await env.DB.prepare(
        'INSERT INTO uploads (id, project_id, report_id, purpose, object_key, original_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
        .bind(upload.id, upload.project_id, upload.report_id, upload.purpose, upload.object_key, upload.original_name, upload.mime_type, upload.size, upload.created_at)
        .run();
    return upload;
}

/**
 * Loads uploads that belong to this project, purpose and report. Returns null when any id is
 * unknown (expired, used already, or someone else's), so the form can ask for a re-upload.
 */
export async function findClaimableUploads(
    db: D1Database,
    ids: string[],
    scope: { projectId: number; purpose: UploadPurpose; reportId: number | null },
): Promise<Upload[] | null> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
        return [];
    }
    if (unique.some((id) => !/^[A-Za-z0-9_-]{16,64}$/.test(id))) {
        return null;
    }
    const { results } = await db
        .prepare(
            `SELECT * FROM uploads WHERE id IN (${placeholders(unique.length)}) AND project_id = ? AND purpose = ? AND report_id IS ?`,
        )
        .bind(...unique, scope.projectId, scope.purpose, scope.reportId)
        .all<Upload>();
    if (results.length !== unique.length) {
        return null;
    }
    const order = new Map(unique.map((id, index) => [id, index]));
    return results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Statements that turn uploads into attachments of a report (report found by public id). */
export function claimStatements(
    db: D1Database,
    uploads: Upload[],
    target: { reportPublicId: string; kind: 'feedback' | 'adjustment'; messageId?: number | null; nowIso: string; author?: Author },
): D1PreparedStatement[] {
    const statements: D1PreparedStatement[] = [];
    for (const upload of uploads) {
        statements.push(
            db
                .prepare(
                    `INSERT INTO attachments (report_id, message_id, kind, object_key, original_name, mime_type, size, uploader_client_account_id, uploader_developer_id, created_at)
                     VALUES ((SELECT id FROM reports WHERE public_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .bind(
                    target.reportPublicId,
                    target.messageId ?? null,
                    target.kind,
                    upload.object_key,
                    upload.original_name,
                    upload.mime_type,
                    upload.size,
                    target.author?.clientAccountId ?? null,
                    target.author?.developerId ?? null,
                    target.nowIso,
                ),
        );
        statements.push(db.prepare('DELETE FROM uploads WHERE id = ?').bind(upload.id));
    }
    return statements;
}

/** Deletes uploads that were never attached (public ones after an hour, others after a day), at most `limit` per run. */
export async function pruneStaleUploads(env: Env, nowMs = Date.now(), limit = 50): Promise<number> {
    const { results } = await env.DB.prepare(
        `SELECT u.id, u.object_key FROM uploads u
         WHERE u.created_at < ? OR (u.created_at < ? AND ${PUBLIC_PENDING})
         ORDER BY u.created_at LIMIT ?`,
    )
        .bind(new Date(nowMs - UPLOAD_TTL_MS).toISOString(), new Date(nowMs - PUBLIC_UPLOAD_TTL_MS).toISOString(), limit)
        .all<{ id: string; object_key: string }>();
    if (results.length === 0) {
        return 0;
    }
    await env.FILES.delete(results.map((row) => row.object_key));
    await env.DB.prepare(`DELETE FROM uploads WHERE id IN (${placeholders(results.length)})`)
        .bind(...results.map((row) => row.id))
        .run();
    return results.length;
}
