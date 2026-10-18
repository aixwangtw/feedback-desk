import { Hono, type MiddlewareHandler } from 'hono';
import { nowIso } from '../../shared/time';
import { randomString, sha256Hex } from '../lib/crypto';
import { findProjectBySlug, findReportInProject } from '../lib/db';
import type { Developer } from '../lib/models';
import { attempt, clientIp } from '../lib/rate-limit';
import { signedUploadUrl } from '../lib/signed';
import * as team from '../lib/team';
import { MAX_IMAGE_BYTES, storeImageStream, UploadError } from '../lib/uploads';
import { origin, type AppContext, type AppEnv } from './context';
import { ipPrefix } from './device';
import { paths } from './paths';
import { APP_VERSION } from '../version';

export const api = new Hono<AppEnv>();

export const DEVICE_CODE_TTL_SECONDS = 600;
export const DEVICE_POLL_INTERVAL = 5;
const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

/** Resolves `Authorization: Bearer fdk_...` to a team account. Shared by the API and MCP. */
export async function developerForToken(c: AppContext): Promise<{ developer: Developer; tokenId: number } | null> {
    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) {
        return null;
    }
    const row = await c.env.DB.prepare(
        `SELECT t.id AS token_id, t.last_used_at, d.* FROM api_tokens t JOIN developers d ON d.id = t.developer_id
         WHERE t.token_hash = ? AND d.disabled_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ?)`,
    )
        .bind(await sha256Hex(match[1]), nowIso(c.get('now')))
        .first<Developer & { token_id: number; last_used_at: string | null }>();
    if (!row) {
        return null;
    }
    const now = c.get('now');
    // Record usage at most every ten minutes to keep D1 writes low.
    if (!row.last_used_at || Date.parse(row.last_used_at) < now - 600_000) {
        c.executionCtx.waitUntil(
            c.env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(nowIso(now), row.token_id).run().then(() => undefined, () => undefined),
        );
    }
    const { token_id: tokenId, last_used_at: _ignored, ...developer } = row;
    return { developer: developer as Developer, tokenId };
}

export const requireToken: MiddlewareHandler<AppEnv> = async (c, next) => {
    const result = await developerForToken(c);
    if (!result) {
        return c.json({ error: 'unauthorized', message: '需要有效的 API token（npx github:aixwangtw/feedback-desk login）。' }, 401);
    }
    c.set('apiDeveloper', result.developer);
    c.set('apiTokenId', result.tokenId);
    await next();
};

function ctx(c: AppContext): team.TeamContext {
    return { env: c.env, origin: origin(c), developer: c.get('apiDeveloper'), now: c.get('now') };
}

async function body<T>(c: AppContext): Promise<T> {
    try {
        return (await c.req.json()) as T;
    } catch {
        return {} as T;
    }
}

api.onError((error, c) => {
    if (error instanceof team.ServiceError) {
        return c.json({ error: error.code, message: error.message }, error.status);
    }
    throw error;
});

// ---------------------------------------------------------------- device authorization (CLI login)

function generateUserCode(): string {
    const raw = randomString(8, USER_CODE_ALPHABET);
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

api.post('/device/code', async (c) => {
    const retryAfter = await attempt(c.env.DB, [{ key: `device-code|${clientIp(c.req.raw)}`, max: 10, period: 600 }], c.get('now'));
    if (retryAfter !== null) {
        return c.json({ error: 'slow_down', message: '申請次數過多，請稍後再試。' }, 429, { 'Retry-After': String(retryAfter) });
    }
    const input = await body<{ client_name?: string; expires_in_days?: number | null }>(c);
    const clientName = (input.client_name ?? 'feedback-desk CLI').toString().slice(0, 100);
    const tokenDays = input.expires_in_days === undefined || input.expires_in_days === null ? null : Number(input.expires_in_days);
    if (tokenDays !== null && (!Number.isInteger(tokenDays) || tokenDays < 1 || tokenDays > team.MAX_TOKEN_DAYS)) {
        return c.json({ error: 'invalid_expiry', message: `有效天數必須是 1 到 ${team.MAX_TOKEN_DAYS} 的整數。` }, 422);
    }
    const deviceCode = randomString(48);
    const userCode = generateUserCode();
    const now = c.get('now');
    const rawIp = c.req.header('cf-connecting-ip') ?? '';
    await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM device_codes WHERE expires_at < ?').bind(Math.floor(now / 1000)),
        c.env.DB.prepare('INSERT INTO device_codes (device_code_hash, user_code, client_name, status, requester_ip, token_days, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
            await sha256Hex(deviceCode),
            userCode,
            clientName,
            'pending',
            ipPrefix(rawIp),
            tokenDays,
            Math.floor(now / 1000) + DEVICE_CODE_TTL_SECONDS,
            nowIso(now),
        ),
    ]);
    // No "complete" URL with the code in it: the person types the code shown in their terminal.
    return c.json({
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: `${origin(c)}${paths.device()}`,
        expires_in: DEVICE_CODE_TTL_SECONDS,
        interval: DEVICE_POLL_INTERVAL,
    });
});

api.post('/device/token', async (c) => {
    const input = await body<{ device_code?: string }>(c);
    const deviceCode = (input.device_code ?? '').toString();
    if (deviceCode === '') {
        return c.json({ error: 'invalid_request', message: '缺少 device_code。' }, 400);
    }
    const row = await c.env.DB.prepare('SELECT * FROM device_codes WHERE device_code_hash = ?').bind(await sha256Hex(deviceCode)).first<{
        id: number;
        status: string;
        developer_id: number | null;
        client_name: string;
        last_polled_at: number | null;
        expires_at: number;
        token_days: number | null;
    }>();
    const nowSeconds = Math.floor(c.get('now') / 1000);
    if (!row) {
        return c.json({ error: 'invalid_grant', message: '授權碼不存在或已使用。' }, 400);
    }
    if (row.expires_at < nowSeconds) {
        return c.json({ error: 'expired_token', message: '授權碼已過期，請重新執行 login。' }, 400);
    }
    if (row.status === 'denied') {
        await c.env.DB.prepare('DELETE FROM device_codes WHERE id = ?').bind(row.id).run();
        return c.json({ error: 'access_denied', message: '授權被拒絕。' }, 400);
    }
    if (row.status === 'approved' && row.developer_id) {
        const consumed = await c.env.DB.prepare("UPDATE device_codes SET status = 'consumed' WHERE id = ? AND status = 'approved'").bind(row.id).run();
        if ((consumed.meta.changes ?? 0) === 0) {
            return c.json({ error: 'invalid_grant', message: '授權碼已使用。' }, 400);
        }
        const developer = await c.env.DB.prepare('SELECT id, username, name FROM developers WHERE id = ?').bind(row.developer_id).first<{ id: number; username: string; name: string }>();
        const token = await team.createToken(c.env, row.developer_id, row.client_name, c.get('now'), row.token_days);
        return c.json({ access_token: token.token, token_type: 'bearer', token_id: token.id, developer });
    }
    if (row.status !== 'pending') {
        return c.json({ error: 'invalid_grant', message: '授權碼已使用。' }, 400);
    }
    if (row.last_polled_at !== null && nowSeconds - row.last_polled_at < DEVICE_POLL_INTERVAL - 1) {
        return c.json({ error: 'slow_down', interval: DEVICE_POLL_INTERVAL + 5 }, 400);
    }
    await c.env.DB.prepare('UPDATE device_codes SET last_polled_at = ? WHERE id = ?').bind(nowSeconds, row.id).run();
    return c.json({ error: 'authorization_pending' }, 400);
});

// ---------------------------------------------------------------- authenticated API

api.get('/health', (c) => c.json({ ok: true, version: APP_VERSION }));

api.use('/me', requireToken);
api.use('/projects', requireToken);
api.use('/projects/*', requireToken);
api.use('/developers', requireToken);
api.use('/developers/*', requireToken);
api.use('/tokens', requireToken);
api.use('/tokens/*', requireToken);

api.get('/me', (c) => {
    const developer = c.get('apiDeveloper');
    return c.json({ developer: { id: developer.id, username: developer.username, name: developer.name }, token_id: c.get('apiTokenId'), version: APP_VERSION });
});

api.get('/projects', async (c) => c.json(await team.listProjects(ctx(c))));
api.post('/projects', async (c) => c.json(await team.createProject(ctx(c), await body(c)), 201));
api.post('/projects/:slug/client-link', async (c) => c.json(await team.rotateClientLink(ctx(c), c.req.param('slug'))));
api.post('/projects/:slug/owner-link', async (c) => c.json(await team.rotateOwnerLink(ctx(c), c.req.param('slug'))));
api.post('/projects/:slug/client-account', async (c) => c.json(await team.setClientAccount(ctx(c), c.req.param('slug'), await body(c))));
api.post('/projects/:slug/public-reporting', async (c) => c.json(await team.setPublicReporting(ctx(c), c.req.param('slug'), await body(c))));

api.get('/projects/:slug/reports', async (c) => {
    const query = new URL(c.req.url).searchParams;
    return c.json(
        await team.listReports(ctx(c), c.req.param('slug'), {
            statuses: query.getAll('status'),
            creator: query.get('creator') ?? '',
            includeDeleted: query.get('include_deleted') === '1',
            includePublic: query.get('include_public') === '1',
        }),
    );
});

function lookupMode(c: AppContext): 'auto' | 'public_id' | 'id' {
    const by = c.req.query('by');
    return by === 'id' ? 'id' : by === 'public_id' ? 'public_id' : 'auto';
}

api.get('/projects/:slug/reports/:ref', async (c) => c.json(await team.getReport(ctx(c), c.req.param('slug'), c.req.param('ref'), lookupMode(c))));
api.post('/projects/:slug/reports/:ref/status', async (c) => {
    const input = await body<{ status?: string }>(c);
    return c.json(await team.setReportStatus(ctx(c), c.req.param('slug'), c.req.param('ref'), String(input.status ?? '')));
});
api.post('/projects/:slug/reports/:ref/adjustment', async (c) => {
    const input = await body<{ note?: string | null; append?: boolean; upload_ids?: string[] }>(c);
    return c.json(await team.writeAdjustment(ctx(c), c.req.param('slug'), c.req.param('ref'), { ...input, by_id: c.req.query('by') === 'id' }));
});
api.post('/projects/:slug/reports/:ref/messages', async (c) => {
    const input = await body<{ body?: string; upload_ids?: string[] }>(c);
    return c.json(await team.postMessage(ctx(c), c.req.param('slug'), c.req.param('ref'), { body: String(input.body ?? ''), upload_ids: input.upload_ids }));
});

/** One image per request, streamed straight into R2 (same rules as the web upload). */
api.put('/projects/:slug/reports/:ref/uploads', async (c) => {
    const purpose = c.req.query('purpose') === 'message' ? 'message' : 'adjustment';
    const team_ = ctx(c);
    const project = await team.projectOrFail(c.env, c.req.param('slug'));
    const report = await team.resolveReport(c.env, project, c.req.param('ref'), c.req.query('by') === 'id' ? 'id' : 'auto');
    try {
        const upload = await storeImageStream(c.env, c.req.raw, { projectId: project.id, reportId: report.id, purpose, maxBytes: MAX_IMAGE_BYTES, nowIso: nowIso(team_.now) });
        return c.json({ id: upload.id, name: upload.original_name, size: upload.size, mime_type: upload.mime_type }, 201);
    } catch (error) {
        if (error instanceof UploadError) {
            return c.json({ error: 'invalid_image', message: error.message }, error.status);
        }
        throw error;
    }
});

api.post('/projects/:slug/reports/:ref/upload-url', async (c) => {
    const project = await team.projectOrFail(c.env, c.req.param('slug'));
    const report = await team.resolveReport(c.env, project, c.req.param('ref'));
    const input = await body<{ purpose?: string }>(c);
    const purpose = input.purpose === 'message' ? 'message' : 'adjustment';
    return c.json(await signedUploadUrl(c.env, origin(c), { projectSlug: project.slug, reportPublicId: report.public_id, purpose, developerId: c.get('apiDeveloper').id }, c.get('now')));
});

api.get('/developers', async (c) => c.json(await team.listTeam(ctx(c))));
api.post('/developers', async (c) => c.json(await team.createDeveloper(ctx(c), await body(c)), 201));
api.post('/developers/:username/reset', async (c) => {
    const input = await body<{ name?: string }>(c);
    return c.json(await team.resetDeveloper(ctx(c), { username: c.req.param('username'), name: input.name }));
});

api.post('/developers/:username/disable', async (c) => c.json(await team.setDeveloperDisabled(ctx(c), c.req.param('username'), true)));
api.post('/developers/:username/enable', async (c) => c.json(await team.setDeveloperDisabled(ctx(c), c.req.param('username'), false)));
api.delete('/developers/:username', async (c) => c.json(await team.deleteDeveloper(ctx(c), c.req.param('username'))));

api.get('/tokens', async (c) => c.json(await team.listTokens(ctx(c), c.get('apiTokenId'))));
api.post('/tokens', async (c) => {
    const input = await body<{ name?: string; expires_in_days?: number | null }>(c);
    const days = input.expires_in_days === undefined || input.expires_in_days === null ? null : Number(input.expires_in_days);
    return c.json(await team.createToken(c.env, c.get('apiDeveloper').id, String(input.name ?? 'cli'), c.get('now'), days), 201);
});
api.delete('/tokens/:id', async (c) => c.json(await team.revokeToken(ctx(c), Number(c.req.param('id')))));

export async function reportExists(c: AppContext, slug: string, publicId: string): Promise<{ projectId: number; reportId: number } | null> {
    const project = await findProjectBySlug(c.env.DB, slug);
    if (!project) {
        return null;
    }
    const report = await findReportInProject(c.env.DB, project.id, publicId);
    return report ? { projectId: project.id, reportId: report.id } : null;
}
