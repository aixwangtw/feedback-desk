import { Hono } from 'hono';
import { nowIso } from '../../shared/time';
import { findDeveloper } from '../lib/db';
import type { Attachment } from '../lib/models';
import { readUploadGrant, verifyAttachmentSignature } from '../lib/signed';
import { MAX_IMAGE_BYTES, storeImageStream, UploadError } from '../lib/uploads';
import { reportExists } from './api';
import { abort, type AppEnv } from './context';
import { streamAttachment } from './web';

/** Cookie-less file access for the CLI and agents, authorised by short-lived signatures. */
export const files = new Hono<AppEnv>();

files.put('/files/upload', async (c) => {
    const grant = await readUploadGrant(c.env, new URL(c.req.url).searchParams, c.get('now'));
    if (!grant) {
        return c.json({ error: 'invalid_signature', message: '上傳網址無效或已過期。' }, 403);
    }
    const [target, developer] = await Promise.all([reportExists(c, grant.projectSlug, grant.reportPublicId), findDeveloper(c.env.DB, grant.developerId)]);
    if (!target || !developer) {
        return c.json({ error: 'not_found', message: '找不到回饋單。' }, 404);
    }
    try {
        const upload = await storeImageStream(c.env, c.req.raw, {
            projectId: target.projectId,
            reportId: target.reportId,
            purpose: grant.purpose,
            maxBytes: MAX_IMAGE_BYTES,
            nowIso: nowIso(c.get('now')),
        });
        return c.json({ id: upload.id, name: upload.original_name, size: upload.size, mime_type: upload.mime_type }, 201);
    } catch (error) {
        if (error instanceof UploadError) {
            return c.json({ error: 'invalid_image', message: error.message }, error.status);
        }
        throw error;
    }
});

files.get('/files/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const expires = Number(c.req.query('e'));
    if (!Number.isInteger(id) || !(await verifyAttachmentSignature(c.env, id, expires, c.req.query('s') ?? '', c.get('now')))) {
        abort(403, '下載網址無效或已過期。');
    }
    const attachment = await c.env.DB.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first<Attachment>();
    if (!attachment) {
        abort(404);
    }
    return streamAttachment(c, attachment, 'private, no-store');
});
