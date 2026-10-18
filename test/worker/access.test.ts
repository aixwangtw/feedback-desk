import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { randomString, sha256Hex } from '../../src/worker/lib/crypto';
import { Browser, seedAttachment, seedDeveloper, seedProject, seedReport, unique } from './helpers';

describe('entry links and login', () => {
    it('sends a guest opening the portal to the login form and back after login', async () => {
        const seeded = await seedProject({ clientUsername: 'teacher', clientPassword: 'client-password-1234567' });
        const browser = new Browser();
        const portal = await browser.get(`/p/${seeded.project.slug}?status=new`);
        expect(portal.status).toBe(302);
        expect(portal.headers.get('location')).toBe(`/p/${seeded.project.slug}/login`);
        const loginPage = await browser.get(`/p/${seeded.project.slug}/login`);
        expect(await loginPage.text()).toContain('登入問題清單');
        const login = await browser.loginAs(seeded.project.slug, 'teacher', 'client-password-1234567');
        expect(login.status).toBe(302);
        expect(login.headers.get('location')).toBe(`/p/${seeded.project.slug}?status=new`);
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(200);
    });

    it('rejects wrong credentials with a Chinese message and keeps the username', async () => {
        const seeded = await seedProject({ clientUsername: 'teacher', clientPassword: 'client-password-1234567' });
        const browser = new Browser();
        const response = await browser.loginAs(seeded.project.slug, 'teacher', 'wrong');
        expect(response.status).toBe(422);
        const html = await response.text();
        expect(html).toContain('帳號或密碼錯誤。');
        expect(html).toContain('value="teacher"');
    });

    it('rate limits failed logins per account and IP', async () => {
        const seeded = await seedProject({ clientUsername: 'teacher', clientPassword: 'client-password-1234567' });
        const browser = new Browser();
        for (let i = 0; i < 5; i++) {
            expect((await browser.loginAs(seeded.project.slug, 'teacher', 'wrong')).status).toBe(422);
        }
        const blocked = await browser.loginAs(seeded.project.slug, 'teacher', 'client-password-1234567');
        expect(blocked.status).toBe(429);
        expect(blocked.headers.get('retry-after')).toBeTruthy();
        // Another IP is unaffected.
        expect((await new Browser().loginAs(seeded.project.slug, 'teacher', 'client-password-1234567')).status).toBe(302);
    });

    it('accepts a team account on every project and remembers who created reports', async () => {
        const first = await seedProject();
        const second = await seedProject();
        const { developer, password } = await seedDeveloper();
        for (const seeded of [first, second]) {
            const browser = new Browser();
            expect((await browser.loginAs(seeded.project.slug, developer.username, password)).status).toBe(302);
            const store = await browser.post(`/p/${seeded.project.slug}/reports`, { 'issues[0][title]': '團隊建立', 'issues[0][description]': '說明' });
            expect(store.status).toBe(302);
            const row = await env.DB.prepare('SELECT creator_type, creator_developer_id FROM reports WHERE project_id = ?').bind(seeded.project.id).first();
            expect(row).toEqual({ creator_type: 'developer', creator_developer_id: developer.id });
        }
    });

    it('only accepts each project its own client account', async () => {
        const first = await seedProject({ clientUsername: 'teacher', clientPassword: 'client-password-1234567' });
        const second = await seedProject();
        const browser = new Browser();
        expect((await browser.loginAs(second.project.slug, 'teacher', 'client-password-1234567')).status).toBe(422);
        expect((await browser.loginAs(first.project.slug, 'teacher', 'client-password-1234567')).status).toBe(302);
    });

    it('rejects invalid entry tokens and rotated links stop working for remembered logins', async () => {
        const seeded = await seedProject();
        const browser = new Browser();
        expect((await browser.get(`/p/${seeded.project.slug}/access?token=wrong`)).status).toBe(403);
        await browser.asClient(seeded);
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(200);
        const newToken = randomString(48);
        await env.DB.prepare('UPDATE projects SET client_token_hash = ?, updated_at = ? WHERE id = ?').bind(await sha256Hex(newToken), new Date().toISOString(), seeded.project.id).run();
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(302);
    });

    it('invalidates a developer login after the password changes', async () => {
        const seeded = await seedProject();
        const { developer, password } = await seedDeveloper();
        const browser = new Browser();
        await browser.loginAs(seeded.project.slug, developer.username, password);
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(200);
        await env.DB.prepare("UPDATE developers SET password_hash = 'pbkdf2_sha256$10000$AAAA$BBBB' WHERE id = ?").bind(developer.id).run();
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(302);
    });

    it('rejects a tampered cookie', async () => {
        const seeded = await seedProject();
        const browser = await new Browser().asOwner(seeded);
        const value = browser.cookies.get('fd_auth') as string;
        browser.cookies.set('fd_auth', value.slice(0, -4) + (value.endsWith('AAAA') ? 'BBBB' : 'AAAA'));
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(302);
    });

    it('logs out and clears the remembered login', async () => {
        const seeded = await seedProject();
        const browser = await new Browser().asOwner(seeded);
        const logout = await browser.post(`/p/${seeded.project.slug}/logout`);
        expect(logout.headers.get('location')).toBe(`/p/${seeded.project.slug}/login`);
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(302);
    });

    it('owner page sends clients to the owner login form, JSON requests get 403', async () => {
        const seeded = await seedProject();
        const client = await new Browser().asClient(seeded);
        const response = await client.get(`/owner/${seeded.project.slug}`);
        expect(response.headers.get('location')).toBe(`/owner/${seeded.project.slug}/login`);
        const form = await client.get(`/owner/${seeded.project.slug}/login`);
        expect(await form.text()).toContain('開發團隊登入');
        expect((await client.get(`/owner/${seeded.project.slug}`, { accept: 'application/json' })).status).toBe(403);
    });

    it('never prefills credentials unless prefill is enabled', async () => {
        const seeded = await seedProject({ clientUsername: 'teacher', clientPassword: 'client-password-1234567', prefill: true });
        const html = await (await new Browser().get(`/p/${seeded.project.slug}/login`)).text();
        expect(html).not.toContain('client-password-1234567');
        expect(html).not.toContain('value="teacher"');
    });

    it('refuses cross-site form posts', async () => {
        const seeded = await seedProject();
        const browser = await new Browser().asOwner(seeded);
        const response = await browser.post(`/p/${seeded.project.slug}/reports`, { 'issues[0][title]': 'x', 'issues[0][description]': 'y' }, { origin: 'https://evil.example' });
        expect(response.status).toBe(403);
        const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE project_id = ?').bind(seeded.project.id).first<{ n: number }>();
        expect(count?.n).toBe(0);
    });
});

describe('isolation', () => {
    it('keeps projects apart: a session of one project cannot read or change another', async () => {
        const mine = await seedProject();
        const other = await seedProject();
        const { report } = await seedReport(other.project);
        const attachmentId = await seedAttachment(report);
        const browser = await new Browser().asOwner(mine);
        expect((await browser.get(`/p/${other.project.slug}`)).status).toBe(302);
        expect((await browser.get(`/p/${other.project.slug}/reports/${report.public_id}`)).status).toBe(302);
        expect((await browser.get(`/p/${other.project.slug}/reports/${report.public_id}/attachments/${attachmentId}`)).status).toBe(302);
        expect((await browser.post(`/p/${other.project.slug}/reports/${report.public_id}/status`, { status: 'completed' })).status).toBe(302);
        // A report addressed through the wrong project slug does not exist.
        expect((await browser.get(`/p/${mine.project.slug}/reports/${report.public_id}`)).status).toBe(404);
        expect((await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(report.id).first())?.status).toBe('new');
    });

    it('hides team-created reports from clients on every route', async () => {
        const seeded = await seedProject();
        const { developer } = await seedDeveloper();
        const { report } = await seedReport(seeded.project, { creator: 'developer', developerId: developer.id, title: '團隊內部單' });
        const attachmentId = await seedAttachment(report);
        const client = await new Browser().asClient(seeded);
        expect(await (await client.get(`/p/${seeded.project.slug}`)).text()).not.toContain('團隊內部單');
        for (const path of [
            `/p/${seeded.project.slug}/reports/${report.public_id}`,
            `/p/${seeded.project.slug}/reports/${report.public_id}/activity`,
            `/p/${seeded.project.slug}/reports/${report.public_id}/attachments/${attachmentId}`,
        ]) {
            expect((await client.get(path)).status).toBe(404);
        }
        expect((await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/status`, { status: 'completed' })).status).toBe(404);
        expect((await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: 'hi' })).status).toBe(404);
        expect((await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/update`, { title: 'x', description: 'y' })).status).toBe(404);
        const owner = await new Browser().asOwner(seeded);
        expect(await (await owner.get(`/p/${seeded.project.slug}`)).text()).toContain('團隊內部單');
    });

    it('renumbers the client list over client reports only and keeps counts apart', async () => {
        const seeded = await seedProject();
        const now = Date.now();
        await seedReport(seeded.project, { title: '客戶一', at: now - 3000 });
        await seedReport(seeded.project, { title: '團隊單', creator: 'owner_shared', at: now - 2000 });
        await seedReport(seeded.project, { title: '客戶二', at: now - 1000 });
        const client = await new Browser().asClient(seeded);
        const html = await (await client.get(`/p/${seeded.project.slug}`)).text();
        expect(html).toContain('共 2 題');
        expect(html).not.toContain('團隊單');
        const owner = await new Browser().asOwner(seeded);
        const ownerHtml = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        expect(ownerHtml).toContain('共 3 題');
        expect(ownerHtml).toContain('開發團隊（共用）');
    });

    it('client deletion hides the report for the client only; the owner can restore it', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project, { title: '要刪的單' });
        const client = await new Browser().asClient(seeded);
        expect((await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/client-delete`)).status).toBe(302);
        expect(await (await client.get(`/p/${seeded.project.slug}`)).text()).not.toContain(`data-report-row="${report.public_id}"`);
        expect((await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).status).toBe(404);
        // The client cannot restore or delete permanently.
        expect((await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/restore`)).status).toBe(403);
        expect((await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/delete`)).status).toBe(403);

        const owner = await new Browser().asOwner(seeded);
        const ownerHtml = await (await owner.get(`/p/${seeded.project.slug}?deleted=only`)).text();
        expect(ownerHtml).toContain('要刪的單');
        expect(ownerHtml).toContain('客戶已刪除');
        const restore = await owner.post(`/p/${seeded.project.slug}/reports/${report.public_id}/restore`, { _back: `/p/${seeded.project.slug}?deleted=only` });
        expect(restore.headers.get('location')).toBe(`/p/${seeded.project.slug}?deleted=only`);
        expect(await (await client.get(`/p/${seeded.project.slug}`)).text()).toContain(`data-report-row="${report.public_id}"`);
    });

    it('owner deletion removes the report, its rows and its files', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        await seedAttachment(report);
        const keys = await env.DB.prepare('SELECT object_key FROM attachments WHERE report_id = ?').bind(report.id).all<{ object_key: string }>();
        const owner = await new Browser().asOwner(seeded);
        expect((await owner.post(`/p/${seeded.project.slug}/reports/${report.public_id}/delete`)).status).toBe(302);
        expect(await env.DB.prepare('SELECT id FROM reports WHERE id = ?').bind(report.id).first()).toBeNull();
        expect(await env.DB.prepare('SELECT id FROM attachments WHERE report_id = ?').bind(report.id).first()).toBeNull();
        expect(await env.FILES.get(keys.results[0].object_key)).toBeNull();
    });

    it('reporter tracking links open only their own report and cannot manage it', async () => {
        const seeded = await seedProject();
        const { report, token } = await seedReport(seeded.project);
        const { report: other } = await seedReport(seeded.project);
        const browser = new Browser();
        const open = await browser.get(`/p/${seeded.project.slug}/reports/${report.public_id}?access=${token}`);
        expect(open.headers.get('location')).toBe(`/p/${seeded.project.slug}/reports/${report.public_id}`);
        expect((await browser.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).status).toBe(200);
        expect((await browser.get(`/p/${seeded.project.slug}/reports/${other.public_id}`)).status).toBe(302);
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(302);
        expect((await browser.post(`/p/${seeded.project.slug}/reports/${report.public_id}/status`, { status: 'completed' })).status).toBe(302);
        expect((await browser.post(`/p/${seeded.project.slug}/reports/${report.public_id}/adjustment`, { adjustment_note: 'x' })).status).toBe(302);
    });

    it('unknown slugs give 404', async () => {
        expect((await new Browser().get(`/p/${unique('missing')}`)).status).toBe(404);
    });
});
