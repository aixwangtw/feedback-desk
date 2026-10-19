import { Hono, type MiddlewareHandler } from 'hono';
import { nowIso } from '../../shared/time';
import { randomString, sha256Hex } from '../lib/crypto';
import { findClientAccount, findDeveloper, findProjectBySlug, findReportInProject } from '../lib/db';
import { AGENT_HEADER, normalizeAgent } from '../lib/agents';
import type { ClientContext } from '../lib/client-service';
import * as clients from '../lib/client-service';
import type { ClientAccount, Developer, Project } from '../lib/models';
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

export type TokenOwner = { kind: 'developer'; developer: Developer } | { kind: 'client'; account: ClientAccount; project: Project };

/**
 * Resolves `Authorization: Bearer fdk_...` to a team or client account, with the AI tool the
 * request comes from (the token's own tool for `mcp install` tokens, else the CLI's header).
 * Shared by the API and MCP. Disabled accounts and expired tokens resolve to nothing.
 */
export async function tokenOwner(c: AppContext): Promise<{ owner: TokenOwner; tokenId: number; agent: string | null; tokenAgent: string | null; mcpClient: string | null } | null> {
    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) {
        return null;
    }
    const token = await c.env.DB.prepare(
        'SELECT id, developer_id, client_account_id, agent, mcp_client, last_used_at FROM api_tokens WHERE token_hash = ? AND (expires_at IS NULL OR expires_at > ?)',
    )
        .bind(await sha256Hex(match[1]), nowIso(c.get('now')))
        .first<{ id: number; developer_id: number | null; client_account_id: number | null; agent: string | null; mcp_client: string | null; last_used_at: string | null }>();
    if (!token) {
        return null;
    }
    let owner: TokenOwner | null = null;
    if (token.developer_id !== null) {
        const developer = await findDeveloper(c.env.DB, token.developer_id);
        owner = developer && !developer.disabled_at ? { kind: 'developer', developer } : null;
    } else if (token.client_account_id !== null) {
        const account = await findClientAccount(c.env.DB, token.client_account_id);
        const project = account && !account.disabled_at ? await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(account.project_id).first<Project>() : null;
        owner = account && project ? { kind: 'client', account, project } : null;
    }
    if (!owner) {
        return null;
    }
    const now = c.get('now');
    // Record usage at most every ten minutes to keep D1 writes low.
    if (!token.last_used_at || Date.parse(token.last_used_at) < now - 600_000) {
        c.executionCtx.waitUntil(
            c.env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(nowIso(now), token.id).run().then(() => undefined, () => undefined),
        );
    }
    const tokenAgent = normalizeAgent(token.agent);
    const mcpClient = normalizeAgent(token.mcp_client);
    // The API (CLI) uses the token's label or the CLI header; the name an MCP client reported is
    // applied only on /mcp (index.tsx), so a token also used from a shell is not mislabelled.
    return { owner, tokenId: token.id, agent: tokenAgent ?? normalizeAgent(c.req.header(AGENT_HEADER)), tokenAgent, mcpClient };
}

export const requireToken: MiddlewareHandler<AppEnv> = async (c, next) => {
    const result = await tokenOwner(c);
    if (!result) {
        return c.json({ error: 'unauthorized', message: '需要有效的 API token（npx github:aixwangtw/feedback-desk login）。' }, 401);
    }
    if (result.owner.kind === 'developer') {
        c.set('apiDeveloper', result.owner.developer);
    } else {
        c.set('apiClient', { account: result.owner.account, project: result.owner.project });
    }
    c.set('apiTokenId', result.tokenId);
    c.set('apiAgent', result.agent);
    await next();
};

function isClient(c: AppContext): boolean {
    return c.get('apiClient') !== undefined;
}

/** Team-only operations: client tokens get 403 with a plain explanation. */
function ctx(c: AppContext): team.TeamContext {
    const developer = c.get('apiDeveloper');
    if (!developer) {
        throw new team.ServiceError('team_only', '這個操作只有團隊帳號能做；客戶帳號可以看單、開單、留言。', 403);
    }
    return { env: c.env, origin: origin(c), developer, now: c.get('now'), agent: c.get('apiAgent') };
}

function clientCtx(c: AppContext): ClientContext {
    const client = c.get('apiClient');
    return { env: c.env, origin: origin(c), account: client.account, project: client.project, now: c.get('now'), agent: c.get('apiAgent') };
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
        client_account_id: number | null;
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
    if (row.status === 'approved' && (row.developer_id || row.client_account_id)) {
        const consumed = await c.env.DB.prepare("UPDATE device_codes SET status = 'consumed' WHERE id = ? AND status = 'approved'").bind(row.id).run();
        if ((consumed.meta.changes ?? 0) === 0) {
            return c.json({ error: 'invalid_grant', message: '授權碼已使用。' }, 400);
        }
        if (row.developer_id) {
            const developer = await c.env.DB.prepare('SELECT id, username, name FROM developers WHERE id = ? AND disabled_at IS NULL').bind(row.developer_id).first<{ id: number; username: string; name: string }>();
            if (!developer) {
                return c.json({ error: 'access_denied', message: '這個帳號已停用。' }, 400);
            }
            const token = await team.createToken(c.env, { developerId: row.developer_id }, row.client_name, c.get('now'), row.token_days);
            return c.json({ access_token: token.token, token_type: 'bearer', token_id: token.id, developer, account_type: 'developer' });
        }
        const account = await c.env.DB.prepare(
            'SELECT ca.id, ca.username, ca.name, p.slug AS project FROM client_accounts ca JOIN projects p ON p.id = ca.project_id WHERE ca.id = ? AND ca.disabled_at IS NULL',
        )
            .bind(row.client_account_id)
            .first<{ id: number; username: string; name: string; project: string }>();
        if (!account) {
            return c.json({ error: 'access_denied', message: '這個帳號已停用。' }, 400);
        }
        const token = await team.createToken(c.env, { clientAccountId: row.client_account_id as number }, row.client_name, c.get('now'), row.token_days);
        return c.json({ access_token: token.token, token_type: 'bearer', token_id: token.id, developer: account, account_type: 'client', project: account.project });
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
    const meta = { token_id: c.get('apiTokenId'), agent: c.get('apiAgent'), version: APP_VERSION };
    if (developer) {
        return c.json({ account_type: 'developer', developer: { id: developer.id, username: developer.username, name: developer.name }, ...meta });
    }
    const { account, project } = c.get('apiClient');
    // `developer` keeps older CLIs that print "已登入：名字（帳號）" working for client accounts too.
    return c.json({ account_type: 'client', developer: { id: account.id, username: account.username, name: account.name }, project: project.slug, ...meta });
});

api.get('/projects', async (c) => {
    if (isClient(c)) {
        const { project } = c.get('apiClient');
        return c.json({ projects: [{ slug: project.slug, name: project.name, portal_url: `${origin(c)}${paths.portal(project.slug)}` }] });
    }
    return c.json(await team.listProjects(ctx(c)));
});
api.post('/projects', async (c) => c.json(await team.createProject(ctx(c), await body(c)), 201));
api.post('/projects/:slug/client-link', async (c) => c.json(await team.rotateClientLink(ctx(c), c.req.param('slug'))));
api.post('/projects/:slug/owner-link', async (c) => c.json(await team.rotateOwnerLink(ctx(c), c.req.param('slug'))));
api.post('/projects/:slug/client-account', async (c) => c.json(await team.setClientAccount(ctx(c), c.req.param('slug'), await body(c))));
api.get('/projects/:slug/clients', async (c) => c.json(await team.listClients(ctx(c), c.req.param('slug'))));
api.post('/projects/:slug/clients', async (c) => c.json(await team.createClient(ctx(c), c.req.param('slug'), await body(c)), 201));
api.post('/projects/:slug/clients/:username/reset', async (c) => {
    const input = await body<{ prefill?: boolean }>(c);
    return c.json(await team.resetClient(ctx(c), c.req.param('slug'), c.req.param('username'), { prefill: input.prefill }));
});
api.post('/projects/:slug/clients/:username/disable', async (c) => c.json(await team.setClientDisabled(ctx(c), c.req.param('slug'), c.req.param('username'), true)));
api.post('/projects/:slug/clients/:username/enable', async (c) => c.json(await team.setClientDisabled(ctx(c), c.req.param('slug'), c.req.param('username'), false)));
api.delete('/projects/:slug/clients/:username', async (c) => c.json(await team.deleteClient(ctx(c), c.req.param('slug'), c.req.param('username'))));
api.post('/projects/:slug/public-reporting', async (c) => c.json(await team.setPublicReporting(ctx(c), c.req.param('slug'), await body(c))));

api.get('/projects/:slug/reports', async (c) => {
    if (isClient(c)) {
        return c.json(await clients.listOwnReports(clientCtx(c), c.req.param('slug')));
    }
    const query = new URL(c.req.url).searchParams;
    return c.json(
        await team.listReports(ctx(c), c.req.param('slug'), {
            statuses: query.getAll('status'),
            creator: query.get('creator') ?? '',
            includeDeleted: query.get('include_deleted') === '1',
            includePublic: query.get('include_public') === '1',
            unread: query.get('unread') === '1',
        }),
    );
});

api.post('/projects/:slug/reports', async (c) => {
    const input = await body<{ title?: string; description?: string; upload_ids?: string[] }>(c);
    if (isClient(c)) {
        return c.json(await clients.createOwnReport(clientCtx(c), c.req.param('slug'), input), 201);
    }
    return c.json(await team.createTeamReport(ctx(c), c.req.param('slug'), { title: input.title ?? '', description: input.description ?? '', upload_ids: input.upload_ids }), 201);
});

function lookupMode(c: AppContext): 'auto' | 'public_id' | 'id' {
    const by = c.req.query('by');
    return by === 'id' ? 'id' : by === 'public_id' ? 'public_id' : 'auto';
}

api.get('/projects/:slug/reports/:ref', async (c) => {
    if (isClient(c)) {
        return c.json(await clients.getOwnReport(clientCtx(c), c.req.param('slug'), c.req.param('ref')));
    }
    return c.json(await team.getReport(ctx(c), c.req.param('slug'), c.req.param('ref'), lookupMode(c)));
});
api.post('/projects/:slug/reports/:ref/status', async (c) => {
    const input = await body<{ status?: string; force?: boolean }>(c);
    return c.json(await team.setReportStatus(ctx(c), c.req.param('slug'), c.req.param('ref'), String(input.status ?? ''), { force: input.force === true }));
});
api.post('/projects/:slug/reports/:ref/adjustment', async (c) => {
    const input = await body<{ note?: string | null; append?: boolean; upload_ids?: string[]; force?: boolean }>(c);
    return c.json(await team.writeAdjustment(ctx(c), c.req.param('slug'), c.req.param('ref'), { ...input, force: input.force === true, by_id: c.req.query('by') === 'id' }));
});
api.post('/projects/:slug/reports/:ref/claim', async (c) => {
    const input = await body<{ force?: boolean }>(c);
    return c.json(await team.claimReport(ctx(c), c.req.param('slug'), c.req.param('ref'), { force: input.force === true }));
});
api.post('/projects/:slug/reports/:ref/release', async (c) => {
    const input = await body<{ force?: boolean }>(c);
    return c.json(await team.releaseReport(ctx(c), c.req.param('slug'), c.req.param('ref'), { force: input.force === true }));
});
api.post('/projects/:slug/reports/:ref/handoff', async (c) => {
    const input = await body<{ note?: string; release?: boolean }>(c);
    return c.json(await team.writeHandoff(ctx(c), c.req.param('slug'), c.req.param('ref'), { note: String(input.note ?? ''), release: input.release === true }), 201);
});
api.post('/projects/:slug/reports/:ref/messages', async (c) => {
    const input = await body<{ body?: string; upload_ids?: string[] }>(c);
    const message = { body: String(input.body ?? ''), upload_ids: input.upload_ids };
    if (isClient(c)) {
        return c.json(await clients.postOwnMessage(clientCtx(c), c.req.param('slug'), c.req.param('ref'), message));
    }
    return c.json(await team.postMessage(ctx(c), c.req.param('slug'), c.req.param('ref'), message));
});

async function storeUpload(c: AppContext, target: { projectId: number; reportId: number | null; purpose: 'report' | 'message' | 'adjustment' }): Promise<Response> {
    try {
        const upload = await storeImageStream(c.env, c.req.raw, { ...target, maxBytes: MAX_IMAGE_BYTES, nowIso: nowIso(c.get('now')) });
        return c.json({ id: upload.id, name: upload.original_name, size: upload.size, mime_type: upload.mime_type }, 201);
    } catch (error) {
        if (error instanceof UploadError) {
            return c.json({ error: 'invalid_image', message: error.message }, error.status);
        }
        throw error;
    }
}

/** An image for a new report (one per request, streamed into R2); its id goes into POST /reports. */
api.put('/projects/:slug/uploads', async (c) => {
    const project = isClient(c) ? await clients.ownProject(clientCtx(c), c.req.param('slug')) : (ctx(c), await team.projectOrFail(c.env, c.req.param('slug')));
    return storeUpload(c, { projectId: project.id, reportId: null, purpose: 'report' });
});

/** One image per request, streamed straight into R2 (same rules as the web upload). Clients: messages only. */
api.put('/projects/:slug/reports/:ref/uploads', async (c) => {
    if (isClient(c)) {
        const client = clientCtx(c);
        const project = await clients.ownProject(client, c.req.param('slug'));
        const report = await clients.resolveOwnReport(client, project, c.req.param('ref'));
        return storeUpload(c, { projectId: project.id, reportId: report.id, purpose: 'message' });
    }
    const purpose = c.req.query('purpose') === 'message' ? 'message' : 'adjustment';
    ctx(c);
    const project = await team.projectOrFail(c.env, c.req.param('slug'));
    const report = await team.resolveReport(c.env, project, c.req.param('ref'), c.req.query('by') === 'id' ? 'id' : 'auto');
    return storeUpload(c, { projectId: project.id, reportId: report.id, purpose });
});

api.post('/projects/:slug/reports/:ref/upload-url', async (c) => {
    const input = await body<{ purpose?: string }>(c);
    if (isClient(c)) {
        const client = clientCtx(c);
        const project = await clients.ownProject(client, c.req.param('slug'));
        const report = await clients.resolveOwnReport(client, project, c.req.param('ref'));
        return c.json(await signedUploadUrl(c.env, origin(c), { projectSlug: project.slug, reportPublicId: report.public_id, purpose: 'message', actor: `c${client.account.id}` }, c.get('now')));
    }
    const team_ = ctx(c);
    const project = await team.projectOrFail(c.env, c.req.param('slug'));
    const report = await team.resolveReport(c.env, project, c.req.param('ref'));
    const purpose = input.purpose === 'message' ? 'message' : 'adjustment';
    return c.json(await signedUploadUrl(c.env, origin(c), { projectSlug: project.slug, reportPublicId: report.public_id, purpose, actor: `d${team_.developer.id}` }, c.get('now')));
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

function tokenHolder(c: AppContext): team.TokenHolder {
    return isClient(c) ? { clientAccountId: c.get('apiClient').account.id } : { developerId: c.get('apiDeveloper').id };
}

api.get('/tokens', async (c) => c.json(await team.listTokens(c.env, tokenHolder(c), c.get('apiTokenId'))));
api.post('/tokens', async (c) => {
    const input = await body<{ name?: string; expires_in_days?: number | null; agent?: string }>(c);
    const days = input.expires_in_days === undefined || input.expires_in_days === null ? null : Number(input.expires_in_days);
    return c.json(await team.createToken(c.env, tokenHolder(c), String(input.name ?? 'cli'), c.get('now'), days, normalizeAgent(input.agent)), 201);
});
api.delete('/tokens/:id', async (c) => c.json(await team.revokeToken(c.env, tokenHolder(c), Number(c.req.param('id')))));

export async function reportExists(c: AppContext, slug: string, publicId: string): Promise<{ projectId: number; reportId: number } | null> {
    const project = await findProjectBySlug(c.env.DB, slug);
    if (!project) {
        return null;
    }
    const report = await findReportInProject(c.env.DB, project.id, publicId);
    return report ? { projectId: project.id, reportId: report.id } : null;
}
