import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { app } from '../../src/worker/index';
import { isSafeLocalPath } from '../../src/worker/lib/access';
import { attempt, ipv6Prefix64 } from '../../src/worker/lib/rate-limit';
import { pruneStaleUploads } from '../../src/worker/lib/uploads';
import { api, BASE, Browser, seedDeveloper, seedProject, seedReport, seedToken, unique, workerEnv } from './helpers';

async function fetchWithEnv(path: string, vars: Record<string, unknown>): Promise<Response> {
    const ctx = createExecutionContext();
    const response = await app.fetch(new Request(`${BASE}${path}`), { ...env, ...vars }, ctx);
    await waitOnExecutionContext(ctx);
    return response;
}

describe('APP_SECRET', () => {
    it('refuses to serve anything when the secret is missing or short', async () => {
        for (const secret of [undefined, '', 'short-secret']) {
            const response = await fetchWithEnv('/', { APP_SECRET: secret });
            expect(response.status).toBe(500);
            expect(await response.text()).toContain('APP_SECRET');
            expect(response.headers.get('set-cookie')).toBeNull();
        }
        const seeded = await seedProject();
        const link = await fetchWithEnv(`/owner/${seeded.project.slug}/access?token=${seeded.ownerToken}`, { APP_SECRET: undefined });
        expect(link.status).toBe(500);
        expect((await fetchWithEnv('/', {})).status).toBe(200);
    });
});

describe('headers and redirects', () => {
    it('sends a Content-Security-Policy without inline script allowances', async () => {
        const response = await new Browser().get('/');
        const csp = response.headers.get('content-security-policy') ?? '';
        expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
        expect(csp).toContain("style-src 'self'");
        expect(csp).not.toContain('unsafe-inline');
        expect(csp).toContain("frame-ancestors 'self'");
    });

    it('accepts only plain same-site paths as return targets', () => {
        expect(isSafeLocalPath('/p/demo?status=new')).toBe(true);
        expect(isSafeLocalPath('//evil.example')).toBe(false);
        expect(isSafeLocalPath('/\\evil.example')).toBe(false);
        expect(isSafeLocalPath('/p/demo\n')).toBe(false);
        expect(isSafeLocalPath('https://evil.example')).toBe(false);
    });

    it('does not follow a backslash return target after login', async () => {
        const seeded = await seedProject({ clientUsername: 'teacher', clientPassword: 'client-password-1234567' });
        const browser = new Browser();
        await browser.get(`/p/${seeded.project.slug}/reports/x/../../%5Cevil.example`);
        const login = await browser.loginAs(seeded.project.slug, 'teacher', 'client-password-1234567');
        expect(login.headers.get('location')?.startsWith('/')).toBe(true);
        expect(login.headers.get('location')).not.toContain('\\');
    });
});

describe('rate limits', () => {
    it('groups IPv6 addresses by /64', () => {
        expect(ipv6Prefix64('2001:db8:1:2:aaaa::1')).toBe('2001:0db8:0001:0002::/64');
        expect(ipv6Prefix64('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:0db8:0001:0002::/64');
        expect(ipv6Prefix64('::1')).toBe('0000:0000:0000:0000::/64');
        expect(ipv6Prefix64('203.0.113.9')).toBeNull();
    });

    it('treats two addresses of one /64 as the same visitor', async () => {
        const seeded = await seedProject({ clientUsername: 'teacher', clientPassword: 'client-password-1234567' });
        for (let i = 0; i < 5; i++) {
            await new Browser(`2001:db8:aa:bb::${i + 1}`).loginAs(seeded.project.slug, 'teacher', 'wrong');
        }
        const blocked = await new Browser('2001:db8:aa:bb:ffff::9').loginAs(seeded.project.slug, 'teacher', 'client-password-1234567');
        expect(blocked.status).toBe(429);
        expect((await new Browser('2001:db8:aa:cc::1').loginAs(seeded.project.slug, 'teacher', 'client-password-1234567')).status).toBe(302);
    });

    it('stops writing once a limit is reached', async () => {
        const key = unique('flood');
        const limit = [{ key, max: 3, period: 3600 }];
        const results = [];
        for (let i = 0; i < 6; i++) results.push(await attempt(env.DB, limit));
        expect(results.slice(0, 3)).toEqual([null, null, null]);
        expect(results.slice(3).every((value) => typeof value === 'number' && value > 0)).toBe(true);
        const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE key LIKE ?').bind(`${key}@%`).first<{ count: number }>();
        expect(row?.count).toBe(3);
    });
});

describe('public uploads', () => {
    async function publicSite(vars: Record<string, string> = {}) {
        const seeded = await seedProject({ client: false, publicReporting: true });
        return { seeded, browser: () => new Browser(`10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, { FEEDBACK_HOME_PUBLIC_PROJECT: seeded.project.slug, ...vars }) };
    }

    it('caps pending public uploads site-wide', async () => {
        // Leftovers of other tests count too, so the cap is set relative to what is already pending.
        const pending = (await env.DB.prepare("SELECT COUNT(*) AS n FROM uploads WHERE purpose = 'public'").first<{ n: number }>())!.n;
        const { seeded, browser } = await publicSite({ FEEDBACK_PUBLIC_PENDING_UPLOADS_MAX: String(pending + 2) });
        expect((await browser().upload(seeded.project.slug, 'purpose=public')).status).toBe(201);
        expect((await browser().upload(seeded.project.slug, 'purpose=public')).status).toBe(201);
        const third = await browser().upload(seeded.project.slug, 'purpose=public');
        expect(third.status).toBe(429);
        expect(((await third.json()) as { message: string }).message).toContain('上傳量過多');
    });

    it('caps pending public bytes site-wide', async () => {
        const { seeded, browser } = await publicSite({ FEEDBACK_PUBLIC_PENDING_UPLOAD_MB_MAX: '1' });
        const big = await browser().request('PUT', `/p/${seeded.project.slug}/uploads?purpose=public`, { body: new Uint8Array(16), headers: { 'content-length': String(2 * 1024 * 1024) } });
        expect(big.status).toBe(429);
    });

    it('drops unattached public uploads after an hour, others after a day', async () => {
        const { seeded, browser } = await publicSite();
        const publicId = await browser().uploadId(seeded.project.slug, 'purpose=public');
        const team = await seedProject();
        const client = await new Browser().asClient(team);
        const teamId = await client.uploadId(team.project.slug, 'purpose=report');
        const twoHoursAgo = new Date(Date.now() - 2 * 3600_000).toISOString();
        await env.DB.prepare('UPDATE uploads SET created_at = ? WHERE id IN (?, ?)').bind(twoHoursAgo, publicId, teamId).run();
        await pruneStaleUploads(workerEnv, Date.now(), 500);
        expect(await env.DB.prepare('SELECT id FROM uploads WHERE id = ?').bind(publicId).first()).toBeNull();
        expect(await env.DB.prepare('SELECT id FROM uploads WHERE id = ?').bind(teamId).first()).not.toBeNull();
    });
});

describe('activity polling', () => {
    it('answers 304 while nothing changed and the new content after a message', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const client = await new Browser().asClient(seeded);
        const page = await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        const etag = /data-etag="([^"]+)"/.exec(page)![1].replaceAll('&quot;', '"');
        const path = `/p/${seeded.project.slug}/reports/${report.public_id}/activity`;
        const unchanged = await client.get(path, { 'if-none-match': etag });
        expect(unchanged.status).toBe(304);
        expect(await unchanged.text()).toBe('');
        await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: '新的留言' });
        const changed = await client.get(path, { 'if-none-match': etag });
        expect(changed.status).toBe(200);
        expect(await changed.text()).toContain('新的留言');
        const nextEtag = changed.headers.get('etag')!;
        expect(nextEtag).not.toBe(etag);
        expect((await client.get(path, { 'if-none-match': nextEtag })).status).toBe(304);
    });
});

describe('team accounts and tokens', () => {
    it('disabling an account ends its web logins and API tokens; enabling does not bring tokens back', async () => {
        const admin = await seedDeveloper();
        const adminToken = await seedToken(admin.developer);
        const { developer, password } = await seedDeveloper();
        const token = await seedToken(developer);
        const seeded = await seedProject();
        const browser = new Browser();
        await browser.loginAs(seeded.project.slug, developer.username, password);
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(200);

        expect((await api('POST', `/developers/${admin.developer.username}/disable`, adminToken)).status).toBe(422);
        const disabled = await (await api('POST', `/developers/${developer.username}/disable`, adminToken)).json<{ tokens_revoked: number }>();
        expect(disabled.tokens_revoked).toBe(1);
        expect((await api('GET', '/me', token)).status).toBe(401);
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(302);
        expect((await new Browser().loginAs(seeded.project.slug, developer.username, password)).status).toBe(422);

        await api('POST', `/developers/${developer.username}/enable`, adminToken);
        expect((await new Browser().loginAs(seeded.project.slug, developer.username, password)).status).toBe(302);
        expect((await api('GET', '/me', token)).status).toBe(401);
    });

    it('resetting a password revokes the account tokens; deleting keeps its reports', async () => {
        const admin = await seedDeveloper();
        const adminToken = await seedToken(admin.developer);
        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        const reset = await (await api('POST', `/developers/${developer.username}/reset`, adminToken, {})).json<{ tokens_revoked: number }>();
        expect(reset.tokens_revoked).toBe(1);
        expect((await api('GET', '/me', token)).status).toBe(401);

        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project, { creator: 'developer', developerId: developer.id });
        await seedToken(developer);
        const deleted = await (await api('DELETE', `/developers/${developer.username}`, adminToken)).json<{ tokens_revoked: number }>();
        expect(deleted.tokens_revoked).toBe(1);
        expect(await env.DB.prepare('SELECT creator_developer_id FROM reports WHERE id = ?').bind(report.id).first('creator_developer_id')).toBeNull();
        expect(await env.DB.prepare('SELECT id FROM developers WHERE id = ?').bind(developer.id).first()).toBeNull();
    });

    it('expired tokens stop working and the expiry is validated', async () => {
        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        const created = await (await api('POST', '/tokens', token, { name: 'short', expires_in_days: 1 })).json<{ token: string; id: number; expires_at: string }>();
        expect((await api('GET', '/me', created.token)).status).toBe(200);
        await env.DB.prepare('UPDATE api_tokens SET expires_at = ? WHERE id = ?').bind('2000-01-01T00:00:00.000Z', created.id).run();
        expect((await api('GET', '/me', created.token)).status).toBe(401);
        expect((await api('POST', '/tokens', token, { expires_in_days: 0 })).status).toBe(422);
        expect((await api('POST', '/tokens', token, { expires_in_days: 99999 })).status).toBe(422);
    });
});
