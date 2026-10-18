import { Hono } from 'hono';
import { charLength } from '../../shared/text';
import { DUMMY_PASSWORD_HASH, verifyPassword } from '../lib/crypto';
import { findDeveloperByUsername } from '../lib/db';
import { clear, clientIp, hit } from '../lib/rate-limit';
import { DevicePage, type DeviceRequest } from '../views/pages';
import { field, readForm, viewContext, type AppContext, type AppEnv } from './context';
import { checkLoginRateLimit, loginLimits } from './web';

/**
 * Browser side of `feedback-desk login`. The code is never taken from the URL: the person types
 * what their own terminal shows, so a link sent by someone else cannot pre-fill an approval.
 */
export const device = new Hono<AppEnv>();

export function normalizeUserCode(input: string): string {
    const compact = input.toUpperCase().replace(/[^A-Z]/g, '');
    return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

/** First half of the requester's address, enough to notice "this is not my network". */
export function ipPrefix(ip: string): string | null {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        const [a, b] = ip.split('.');
        return `${a}.${b}.x.x`;
    }
    if (ip.includes(':')) {
        const groups = ip.split(':').filter((part) => part !== '');
        return groups.length >= 2 ? `${groups[0]}:${groups[1]}:…` : null;
    }
    return null;
}

async function pendingCode(c: AppContext, code: string): Promise<(DeviceRequest & { id: number }) | null> {
    if (!/^[A-Z]{4}-[A-Z]{4}$/.test(code)) {
        return null;
    }
    const row = await c.env.DB.prepare("SELECT id, user_code, client_name, created_at, requester_ip FROM device_codes WHERE user_code = ? AND status = 'pending' AND expires_at >= ?")
        .bind(code, Math.floor(c.get('now') / 1000))
        .first<{ id: number; user_code: string; client_name: string; created_at: string; requester_ip: string | null }>();
    return row ? { id: row.id, code: row.user_code, clientName: row.client_name, requestedAt: row.created_at, requesterIp: row.requester_ip } : null;
}

const INVALID_CODE = '授權碼不存在、已使用或已過期，請確認終端機上的授權碼；過期請重新執行 login。';

device.get('/device', async (c) => {
    const developer = await c.get('access').teamDeveloper();
    return c.html(<DevicePage v={viewContext(c)} developer={developer} state={developer ? 'enter' : 'login'} />);
});

device.post('/device/login', async (c) => {
    const form = await readForm(c);
    const username = field(form, 'username');
    const password = form.get('password') ?? '';
    const rerender = (error: string) => c.html(<DevicePage v={viewContext(c)} developer={null} state="login" error={error} username={username} />, 422);
    if (username === '' || password === '' || charLength(username) > 50 || charLength(password) > 200) {
        return rerender('請輸入帳號與密碼。');
    }
    const limits = loginLimits(username, clientIp(c.req.raw));
    await checkLoginRateLimit(c, limits);
    const found = await findDeveloperByUsername(c.env.DB, username);
    const developer = found && !found.disabled_at ? found : null;
    const matches = await verifyPassword(password, developer?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!developer || !matches) {
        await hit(c.env.DB, limits, c.get('now'));
        return rerender('帳號或密碼錯誤。');
    }
    await clear(c.env.DB, limits[0], c.get('now'));
    await c.get('access').grantTeam(developer);
    return c.redirect('/device', 302);
});

device.post('/device/confirm', async (c) => {
    const developer = await c.get('access').teamDeveloper();
    if (!developer) {
        return c.html(<DevicePage v={viewContext(c)} developer={null} state="login" error="登入已逾時，請重新登入。" />, 403);
    }
    const form = await readForm(c);
    const request = await pendingCode(c, normalizeUserCode(form.get('code') ?? ''));
    if (!request) {
        return c.html(<DevicePage v={viewContext(c)} developer={developer} state="enter" error={INVALID_CODE} />, 422);
    }
    return c.html(<DevicePage v={viewContext(c)} developer={developer} state="confirm" request={request} />);
});

device.post('/device/approve', async (c) => {
    const access = c.get('access');
    const developer = await access.teamDeveloper();
    if (!developer) {
        return c.html(<DevicePage v={viewContext(c)} developer={null} state="login" error="登入已逾時，請重新登入。" />, 403);
    }
    const form = await readForm(c);
    const request = await pendingCode(c, normalizeUserCode(form.get('code') ?? ''));
    if (!request) {
        return c.html(<DevicePage v={viewContext(c)} developer={developer} state="enter" error={INVALID_CODE} />, 422);
    }
    const approve = form.get('decision') === 'approve';
    await c.env.DB.prepare("UPDATE device_codes SET status = ?, developer_id = ? WHERE id = ? AND status = 'pending'")
        .bind(approve ? 'approved' : 'denied', approve ? developer.id : null, request.id)
        .run();
    return c.html(<DevicePage v={viewContext(c)} developer={developer} state={approve ? 'approved' : 'denied'} request={request} />);
});
