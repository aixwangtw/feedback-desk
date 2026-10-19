import { Hono } from 'hono';
import type { Env } from './env';
import { Access } from './lib/access';
import { pruneExpired } from './lib/rate-limit';
import { pruneStaleUploads } from './lib/uploads';
import { api, tokenOwner } from './routes/api';
import { HttpError, viewContext, type AppEnv } from './routes/context';
import { device } from './routes/device';
import { files } from './routes/files';
import { account } from './routes/account';
import { web } from './routes/web';
import { MessagePage } from './views/pages';
import { CONTENT_SECURITY_POLICY, secretUsable } from './lib/security';

const app = new Hono<AppEnv>();

const ERROR_TEXT: Record<number, { title: string; body: string }> = {
    403: { title: '沒有權限', body: '你沒有權限進行這個操作。' },
    404: { title: '找不到頁面', body: '這個頁面不存在，或你沒有權限查看。' },
    405: { title: '不支援的操作', body: '這個網址不支援這種操作。' },
    413: { title: '檔案太大', body: '上傳的內容超過上限。' },
    419: { title: '來源不符', body: '這個表單不是從本站送出的，請回到原頁面重新操作。' },
    429: { title: '嘗試次數過多', body: '請稍後再試。' },
    500: { title: '系統錯誤', body: '系統發生錯誤，請稍後再試。' },
};

function isApiPath(path: string): boolean {
    return path.startsWith('/api/') || path === '/mcp' || path.startsWith('/files/');
}

app.use('*', async (c, next) => {
    // Without a proper secret, cookies and signed links cannot be protected, so nothing is served.
    if (!secretUsable(c.env)) {
        console.error('APP_SECRET 未設定或少於 32 字元，拒絕服務。請重新執行 npx github:aixwangtw/feedback-desk deploy，或用 wrangler secret put APP_SECRET 設定。');
        return c.text('Server misconfigured: APP_SECRET is missing or too short.', 500, { 'Cache-Control': 'no-store' });
    }
    c.set('now', Date.now());
    c.set('access', new Access(c.env, c.req.raw, c.get('now')));

    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD' && !isApiPath(c.req.path)) {
        // Cookies are SameSite=Lax; this also refuses cross-site form posts from browsers that send Origin.
        const requestOrigin = new URL(c.req.url).origin;
        const sentOrigin = c.req.header('origin');
        const fetchSite = c.req.header('sec-fetch-site');
        if ((sentOrigin && sentOrigin !== 'null' && sentOrigin !== requestOrigin) || fetchSite === 'cross-site') {
            const text = ERROR_TEXT[419];
            return c.html(<MessagePage v={viewContext(c)} status={419} title={text.title} body={text.body} />, 403);
        }
    }

    await next();

    const cookies = await c.get('access').jar.setCookieHeaders(new URL(c.req.url).protocol === 'https:');
    for (const cookie of cookies) {
        c.res.headers.append('Set-Cookie', cookie);
    }
    if ((c.res.headers.get('content-type') ?? '').startsWith('text/html')) {
        c.res.headers.set('Cache-Control', 'no-store');
        c.res.headers.set('X-Content-Type-Options', 'nosniff');
        c.res.headers.set('X-Frame-Options', 'SAMEORIGIN');
        c.res.headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    }
});

app.onError((error, c) => {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) {
        console.error(error);
    }
    const headers = error instanceof HttpError ? error.headers : {};
    const text = ERROR_TEXT[status] ?? ERROR_TEXT[500];
    const body = error instanceof HttpError && error.message !== '' ? error.message : text.body;
    if (isApiPath(c.req.path) || (c.req.header('accept') ?? '').includes('application/json')) {
        return c.json({ error: text.title, message: body }, status, headers);
    }
    return c.html(<MessagePage v={viewContext(c)} status={status} title={text.title} body={body} />, status, headers);
});

app.notFound((c) => {
    if (isApiPath(c.req.path)) {
        return c.json({ error: 'not_found', message: ERROR_TEXT[404].body }, 404);
    }
    return c.html(<MessagePage v={viewContext(c)} status={404} title={ERROR_TEXT[404].title} body={ERROR_TEXT[404].body} />, 404);
});

app.all('/mcp', async (c) => {
    const result = await tokenOwner(c);
    if (!result) {
        return c.json({ error: 'unauthorized', message: '需要有效的 API token（npx github:aixwangtw/feedback-desk login）。' }, 401, { 'WWW-Authenticate': 'Bearer' });
    }
    const { handleMcp } = await import('./mcp');
    const base = { env: c.env, origin: new URL(c.req.url).origin, now: c.get('now'), agent: result.agent };
    return handleMcp(
        c.req.raw,
        c.env,
        c.executionCtx as ExecutionContext,
        result.owner.kind === 'developer'
            ? { kind: 'developer', team: { ...base, developer: result.owner.developer } }
            : { kind: 'client', client: { ...base, account: result.owner.account, project: result.owner.project } },
    );
});

app.route('/api/v1', api);
app.route('/', files);
app.route('/', device);
app.route('/', account);
app.route('/', web);

export { app };

export default {
    fetch: app.fetch,
    async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
        if (!secretUsable(env)) {
            console.error('APP_SECRET 未設定或少於 32 字元，排程工作略過。');
            return;
        }
        const now = Date.now();
        await pruneStaleUploads(env, now, 200);
        await pruneExpired(env.DB, now);
        await env.DB.prepare("DELETE FROM device_codes WHERE expires_at < ? OR status = 'consumed'").bind(Math.floor(now / 1000) - 3600).run();
        await env.DB.prepare('DELETE FROM used_upload_nonces WHERE expires_at < ?').bind(Math.floor(now / 1000)).run();
    },
} satisfies ExportedHandler<Env>;
