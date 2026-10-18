import { Hono } from 'hono';
import { charLength } from '../../shared/text';
import { DUMMY_PASSWORD_HASH, verifyPassword } from '../lib/crypto';
import { findDeveloperByUsername } from '../lib/db';
import { clear, clientIp, hit } from '../lib/rate-limit';
import { DevicePage } from '../views/pages';
import { field, readForm, viewContext, type AppContext, type AppEnv } from './context';
import { checkLoginRateLimit, loginLimits } from './web';

/** Browser side of `feedback-desk login`: a team account signs in and approves the code shown in the terminal. */
export const device = new Hono<AppEnv>();

export function normalizeUserCode(input: string): string {
    const compact = input.toUpperCase().replace(/[^A-Z]/g, '');
    return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

async function pendingCode(c: AppContext, code: string) {
    if (code === '') {
        return null;
    }
    return c.env.DB.prepare("SELECT * FROM device_codes WHERE user_code = ? AND status = 'pending' AND expires_at >= ?")
        .bind(code, Math.floor(c.get('now') / 1000))
        .first<{ id: number; client_name: string }>();
}

device.get('/device', async (c) => {
    const code = normalizeUserCode(c.req.query('code') ?? '');
    const developer = await c.get('access').teamDeveloper();
    const pending = await pendingCode(c, code);
    return c.html(
        <DevicePage
            v={viewContext(c)}
            developer={developer}
            code={code}
            clientName={pending?.client_name ?? null}
            state={developer ? 'confirm' : 'login'}
            error={developer && code !== '' && !pending ? '授權碼不存在或已過期，請回終端機重新執行 login。' : undefined}
        />,
    );
});

device.post('/device/login', async (c) => {
    const form = await readForm(c);
    const username = field(form, 'username');
    const password = form.get('password') ?? '';
    const code = normalizeUserCode(form.get('code') ?? '');
    const rerender = (error: string) =>
        c.html(<DevicePage v={viewContext(c)} developer={null} code={code} clientName={null} state="login" error={error} username={username} />, 422);
    if (username === '' || password === '' || charLength(username) > 50 || charLength(password) > 200) {
        return rerender('請輸入帳號與密碼。');
    }
    const limits = loginLimits(username, clientIp(c.req.raw));
    await checkLoginRateLimit(c, limits);
    const developer = await findDeveloperByUsername(c.env.DB, username);
    const matches = await verifyPassword(password, developer?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!developer || !matches) {
        await hit(c.env.DB, limits, c.get('now'));
        return rerender('帳號或密碼錯誤。');
    }
    await clear(c.env.DB, limits[0], c.get('now'));
    await c.get('access').grantTeam(developer);
    return c.redirect(code !== '' ? `/device?code=${encodeURIComponent(code)}` : '/device', 302);
});

device.post('/device/approve', async (c) => {
    const access = c.get('access');
    const developer = await access.teamDeveloper();
    const form = await readForm(c);
    const code = normalizeUserCode(form.get('code') ?? '');
    if (!developer) {
        return c.html(<DevicePage v={viewContext(c)} developer={null} code={code} clientName={null} state="login" error="登入已逾時，請重新登入。" />, 403);
    }
    const pending = await pendingCode(c, code);
    if (!pending) {
        return c.html(<DevicePage v={viewContext(c)} developer={developer} code={code} clientName={null} state="confirm" error="授權碼不存在或已過期，請回終端機重新執行 login。" />, 422);
    }
    const approve = form.get('decision') === 'approve';
    await c.env.DB.prepare('UPDATE device_codes SET status = ?, developer_id = ? WHERE id = ?')
        .bind(approve ? 'approved' : 'denied', approve ? developer.id : null, pending.id)
        .run();
    return c.html(<DevicePage v={viewContext(c)} developer={developer} code={code} clientName={pending.client_name} state={approve ? 'approved' : 'denied'} />);
});
