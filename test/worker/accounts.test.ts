import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { hashPassword, hmac, seal, verifyPassword } from '../../src/worker/lib/crypto';
import type { ClientAccount, Developer } from '../../src/worker/lib/models';
import { selfSetPasswordProblems } from '../../src/shared/password';
import { api, Browser, seedClientAccount, seedDeveloper, seedProject, seedReport, seedToken, unique, type SeededProject } from './helpers';

const JSON_HEADERS = { accept: 'application/json' };
const STRONG = 'Vq7#mZp2!wLx9@Rt';

async function login(seeded: SeededProject, username: string, password: string, browser = new Browser()): Promise<Browser> {
    const response = await browser.loginAs(seeded.project.slug, username, password);
    expect(response.status).toBe(302);
    return browser;
}

async function conversations(browser: Browser, seeded: SeededProject) {
    const response = await browser.get(`/p/${seeded.project.slug}/conversations`, JSON_HEADERS);
    expect(response.status).toBe(200);
    return response.json<{ items: Array<{ id: string; unread: number; creator: string }>; unread_total: number }>();
}

async function teamMessage(seeded: SeededProject, publicId: string, body: string): Promise<void> {
    const { developer } = await seedDeveloper();
    const token = await seedToken(developer);
    expect((await api('POST', `/projects/${seeded.project.slug}/reports/${publicId}/messages`, token, { body })).status).toBe(200);
}

/** Changes the browser's own password through the two-step page. */
async function changePassword(browser: Browser, slug: string, current: string, next: string, confirmation = next): Promise<Response> {
    const verify = await browser.post(`/p/${slug}/account/verify`, { current_password: current });
    if (verify.status !== 303) {
        return verify;
    }
    return browser.post(`/p/${slug}/account/password`, { new_password: next, new_password_confirmation: confirmation });
}

async function clientRow(id: number): Promise<ClientAccount> {
    return (await env.DB.prepare('SELECT * FROM client_accounts WHERE id = ?').bind(id).first<ClientAccount>()) as ClientAccount;
}

async function developerRow(id: number): Promise<Developer> {
    return (await env.DB.prepare('SELECT * FROM developers WHERE id = ?').bind(id).first<Developer>()) as Developer;
}

describe('upgrade from one shared client login (migration 0005)', () => {
    it('copies the login into a client account, keeps its password, and assigns old client data to it', async () => {
        const db = env.UPGRADE_DB;
        const migrations = env.TEST_MIGRATIONS;
        await applyD1Migrations(db, migrations.filter((migration) => migration.name < '0005'));
        const at = '2026-10-01T00:00:00.000Z';
        const hash = await hashPassword('old-shared-client-password');
        await db
            .prepare(
                `INSERT INTO projects (id, name, slug, client_display_name, owner_token_hash, client_username, client_password_hash, created_at, updated_at)
                 VALUES (1, '舊專案', 'old', '陳老師', 'x', 'teacher', ?, ?, ?), (2, '沒帳號', 'linkonly', NULL, 'y', NULL, NULL, ?, ?)`,
            )
            .bind(hash, at, at, at, at)
            .run();
        await db.batch([
            db.prepare(
                `INSERT INTO reports (id, project_id, public_id, reporter_token_hash, creator_type, title, description, latest_activity_at, client_last_read_at, created_at, updated_at)
                 VALUES (1, 1, 'r1', 'h', 'client', '客戶單', 'd', ?, ?, ?, ?), (2, 1, 'r2', 'h', 'owner_shared', '團隊單', 'd', ?, NULL, ?, ?), (3, 2, 'r3', 'h', 'client', '連結單', 'd', ?, ?, ?, ?)`,
            ).bind(at, at, at, at, at, at, at, at, at, at, at),
            db.prepare(
                `INSERT INTO messages (id, report_id, author_type, author_name, body, created_at, updated_at) VALUES (1, 1, 'reporter', '客戶', '客戶留言', ?, ?), (2, 1, 'owner', '王', '團隊留言', ?, ?)`,
            ).bind(at, at, at, at),
            db.prepare(
                `INSERT INTO attachments (id, report_id, message_id, kind, object_key, original_name, mime_type, size, created_at)
                 VALUES (1, 1, NULL, 'feedback', 'k1', 'a.png', 'image/png', 1, ?), (2, 1, 1, 'feedback', 'k2', 'b.png', 'image/png', 1, ?), (3, 1, NULL, 'adjustment', 'k3', 'c.png', 'image/png', 1, ?)`,
            ).bind(at, at, at),
        ]);

        await applyD1Migrations(db, migrations);

        const accounts = (await db.prepare('SELECT * FROM client_accounts').all<ClientAccount>()).results;
        expect(accounts).toHaveLength(1);
        expect(accounts[0]).toMatchObject({ project_id: 1, username: 'teacher', name: '陳老師', password_set_by_self: 0, disabled_at: null });
        expect(await verifyPassword('old-shared-client-password', accounts[0].password_hash)).toBe(true);
        const id = accounts[0].id;
        const reports = (await db.prepare('SELECT id, creator_client_account_id FROM reports ORDER BY id').all<{ id: number; creator_client_account_id: number | null }>()).results;
        expect(reports).toEqual([
            { id: 1, creator_client_account_id: id },
            { id: 2, creator_client_account_id: null },
            { id: 3, creator_client_account_id: null },
        ]);
        const messages = (await db.prepare('SELECT id, author_client_account_id FROM messages ORDER BY id').all()).results;
        expect(messages).toEqual([
            { id: 1, author_client_account_id: id },
            { id: 2, author_client_account_id: null },
        ]);
        const attachments = (await db.prepare('SELECT id, uploader_client_account_id FROM attachments ORDER BY id').all()).results;
        expect(attachments).toEqual([
            { id: 1, uploader_client_account_id: id },
            { id: 2, uploader_client_account_id: id },
            { id: 3, uploader_client_account_id: null },
        ]);
        expect((await db.prepare('SELECT client_account_id, report_id, last_read_at FROM client_reads').all()).results).toEqual([{ client_account_id: id, report_id: 1, last_read_at: at }]);
        const project = await db.prepare('SELECT client_username, client_password_hash FROM projects WHERE id = 1').first();
        expect(project).toEqual({ client_username: 'teacher', client_password_hash: null });
        expect((await db.prepare('SELECT password_set_by_self FROM developers').all()).results).toEqual([]);
    });

    it('keeps a client login made before the upgrade working until that password changes', async () => {
        const seeded = await seedProject({ clientUsername: unique('teacher'), clientPassword: 'client-password-1234567' });
        await env.DB.prepare('UPDATE projects SET client_username = ? WHERE id = ?').bind(seeded.clientAccount!.username, seeded.project.id).run();
        const secret = env.APP_SECRET;
        const fingerprint = await hmac(secret, `${seeded.project.id}|client|password|${seeded.clientAccount!.password_hash}`);
        const cookie = await seal(secret, 'fd_auth', { p: { [seeded.project.id]: { c: { s: 'password', f: fingerprint, e: Math.floor(Date.now() / 1000) + 3600 } } }, r: [] });
        const browser = new Browser();
        browser.cookies.set('fd_auth', cookie);
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(200);

        await env.DB.prepare('UPDATE client_accounts SET password_hash = ? WHERE id = ?').bind(await hashPassword('another-password-123456'), seeded.clientAccount!.id).run();
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(302);
    });
});

describe('client accounts', () => {
    it('signs in each client separately and shows who created each report and message', async () => {
        const seeded = await seedProject({ clientName: '陳老師' });
        const amy = await seedClientAccount(seeded.project, unique('amy'), 'amy-password-1234567', '林小美');
        const ben = await seedClientAccount(seeded.project, unique('ben'), 'ben-password-1234567', '張大文');
        const amyBrowser = await login(seeded, amy.account.username, amy.password);
        const benBrowser = await login(seeded, ben.account.username, ben.password);

        expect((await amyBrowser.post(`/p/${seeded.project.slug}/reports`, { 'issues[0][title]': '小美的單', 'issues[0][description]': 'd' })).status).toBe(302);
        const report = (await env.DB.prepare('SELECT * FROM reports WHERE project_id = ? AND title = ?').bind(seeded.project.id, '小美的單').first<{ public_id: string; creator_client_account_id: number }>())!;
        expect(report.creator_client_account_id).toBe(amy.account.id);

        expect((await benBrowser.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: '大文補充' }, JSON_HEADERS)).status).toBe(201);
        const message = await env.DB.prepare('SELECT author_client_account_id, author_name FROM messages WHERE report_id = (SELECT id FROM reports WHERE public_id = ?)').bind(report.public_id).first();
        expect(message).toEqual({ author_client_account_id: ben.account.id, author_name: '張大文' });

        // Both clients see the report, with its creator; the team sees it too.
        const benPortal = await (await benBrowser.get(`/p/${seeded.project.slug}`)).text();
        expect(benPortal).toContain('小美的單');
        expect(benPortal).toContain('林小美');
        expect((await conversations(benBrowser, seeded)).items.find((item) => item.id === report.public_id)?.creator).toBe('林小美');
        const page = await (await benBrowser.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        expect(page).toContain('建立者：林小美');
        expect(page).toContain('張大文');
        const owner = await new Browser().asOwner(seeded);
        const ownerPortal = await (await owner.get(`/p/${seeded.project.slug}?creator=client:${amy.account.id}`)).text();
        expect(ownerPortal).toContain('小美的單');
        expect(await (await owner.get(`/p/${seeded.project.slug}?creator=client:${ben.account.id}`)).text()).not.toContain('小美的單');

        // A renamed account shows its new name on what it wrote before.
        expect((await amyBrowser.post(`/p/${seeded.project.slug}/account/name`, { name: '林美美' })).status).toBe(303);
        expect(await (await benBrowser.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text()).toContain('建立者：林美美');
        expect((await clientRow(amy.account.id)).username).toBe(amy.account.username);
    });

    it('counts unread replies per client account', async () => {
        const seeded = await seedProject();
        const amy = await seedClientAccount(seeded.project, unique('amy'), 'amy-password-1234567', undefined, { createdAt: '2026-01-01T00:00:00.000Z' });
        const ben = await seedClientAccount(seeded.project, unique('ben'), 'ben-password-1234567', undefined, { createdAt: '2026-01-01T00:00:00.000Z' });
        const { report } = await seedReport(seeded.project, { title: '共用單' });
        const amyBrowser = await login(seeded, amy.account.username, amy.password);
        const benBrowser = await login(seeded, ben.account.username, ben.password);
        await teamMessage(seeded, report.public_id, '團隊回覆');

        expect((await conversations(amyBrowser, seeded)).items[0].unread).toBe(1);
        expect((await conversations(benBrowser, seeded)).items[0].unread).toBe(1);
        expect((await amyBrowser.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).status).toBe(200);
        expect((await conversations(amyBrowser, seeded)).items[0].unread).toBe(0);
        expect((await conversations(benBrowser, seeded)).items[0].unread).toBe(1);
    });

    it('keeps client accounts to their own project', async () => {
        const first = await seedProject();
        const second = await seedProject();
        const amy = await seedClientAccount(first.project, unique('amy'));
        expect((await new Browser().loginAs(second.project.slug, amy.account.username, amy.password)).status).toBe(422);
        const browser = await login(first, amy.account.username, amy.password);
        expect((await browser.get(`/p/${second.project.slug}`)).status).toBe(302);
        const { report } = await seedReport(second.project);
        expect((await browser.get(`/p/${second.project.slug}/reports/${report.public_id}`)).status).toBe(302);
    });

    it('lets the team create, list, disable and delete client accounts with unique login names', async () => {
        const seeded = await seedProject();
        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        const base = `/projects/${seeded.project.slug}/clients`;
        const username = unique('Amy');
        const created = await (await api('POST', base, token, { username, name: '林小美' })).json<{ password: string; account: { name: string } }>();
        expect(created.account.name).toBe('林小美');
        expect(created.password).toMatch(/^[A-Za-z0-9]{24}$/);
        expect((await api('POST', base, token, { username: username.toUpperCase() })).status).toBe(409);
        expect((await api('POST', base, token, { username: developer.username })).status).toBe(409);
        expect((await api('POST', '/developers', token, { username })).status).toBe(409);
        const listed = await (await api('GET', base, token)).json<{ clients: Array<{ username: string; disabled: boolean }> }>();
        expect(listed.clients.map((item) => item.username)).toEqual([username]);

        const browser = await login(seeded, username, created.password);
        expect((await api('POST', `${base}/${username}/disable`, token)).status).toBe(200);
        expect((await browser.get(`/p/${seeded.project.slug}`)).status).toBe(302);
        expect((await new Browser().loginAs(seeded.project.slug, username, created.password)).status).toBe(422);
        expect((await api('POST', `${base}/${username}/enable`, token)).status).toBe(200);
        expect((await api('DELETE', `${base}/${username}`, token)).status).toBe(200);
        expect((await new Browser().loginAs(seeded.project.slug, username, created.password)).status).toBe(422);
    });
});

describe('passwords people choose', () => {
    it('refuses obviously weak passwords', () => {
        expect(selfSetPasswordProblems('short-pass', 'amy')).toEqual(['密碼至少要 16 個字。']);
        expect(selfSetPasswordProblems('aaaaaaaaaaaaaaaa', 'amy')[0]).toContain('同一個字');
        expect(selfSetPasswordProblems('abcabcabcabcabcabc', 'amy')[0]).toContain('同一小段');
        expect(selfSetPasswordProblems('abcdefghijklmnopq', 'amy')[0]).toContain('連續');
        expect(selfSetPasswordProblems('9876543210987654'.slice(0, 10) + 'zyxwvu', 'amy')).toEqual([]);
        expect(selfSetPasswordProblems('my-name-is-amy-and-more', 'Amy')[0]).toContain('包含帳號');
        expect(selfSetPasswordProblems(' leading-space-password', 'amy')[0]).toContain('空白');
        expect(selfSetPasswordProblems(STRONG, 'amy')).toEqual([]);
    });

    it('lets a client change their own password; other sessions end and the team cannot reset it', async () => {
        const seeded = await seedProject();
        const amy = await seedClientAccount(seeded.project, unique('amy'), 'amy-password-1234567');
        await env.DB.prepare('UPDATE projects SET login_prefill_username = ?, login_prefill_password = ? WHERE id = ?').bind(amy.account.username, amy.password, seeded.project.id).run();
        const here = await login(seeded, amy.account.username, amy.password);
        const elsewhere = await login(seeded, amy.account.username, amy.password);
        const slug = seeded.project.slug;

        expect((await here.post(`/p/${slug}/account/password`, { new_password: STRONG, new_password_confirmation: STRONG })).status).toBe(422);
        const wrong = await changePassword(here, slug, 'not-the-password', STRONG);
        expect(wrong.status).toBe(422);
        expect(await wrong.text()).toContain('目前的密碼不正確');
        expect((await changePassword(here, slug, amy.password, 'aaaaaaaaaaaaaaaaaaaa')).status).toBe(422);
        expect((await here.post(`/p/${slug}/account/password`, { new_password: STRONG, new_password_confirmation: `${STRONG}x` })).status).toBe(422);
        expect((await here.post(`/p/${slug}/account/password`, { new_password: STRONG, new_password_confirmation: STRONG })).status).toBe(303);

        expect((await here.get(`/p/${slug}`)).status).toBe(200);
        expect((await elsewhere.get(`/p/${slug}`)).status).toBe(302);
        expect((await new Browser().loginAs(slug, amy.account.username, amy.password)).status).toBe(422);
        expect((await new Browser().loginAs(slug, amy.account.username, STRONG)).status).toBe(302);
        const row = await clientRow(amy.account.id);
        expect(row.password_set_by_self).toBe(1);
        expect(row.password_hash).toMatch(/^pbkdf2_sha256\$10000\$/);
        const project = await env.DB.prepare('SELECT login_prefill_username, login_prefill_password FROM projects WHERE id = ?').bind(seeded.project.id).first();
        expect(project).toEqual({ login_prefill_username: null, login_prefill_password: null });

        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        const reset = await api('POST', `/projects/${slug}/clients/${amy.account.username}/reset`, token);
        expect(reset.status).toBe(409);
        expect((await reset.json<{ error: string; message: string }>()).message).toContain('本人自己設定');
        expect((await api('POST', `/projects/${slug}/client-account`, token, { username: amy.account.username })).status).toBe(409);
        expect((await api('DELETE', `/projects/${slug}/clients/${amy.account.username}`, token)).status).toBe(409);
        expect((await api('POST', `/projects/${slug}/clients/${amy.account.username}/disable`, token)).status).toBe(200);

        // The holder can still change it again; recovery (D1 directly) puts it back to generated.
        await api('POST', `/projects/${slug}/clients/${amy.account.username}/enable`, token);
        const again = await login(seeded, amy.account.username, STRONG);
        expect((await changePassword(again, slug, STRONG, 'Another#Strong-Pass-42')).status).toBe(303);
        await env.DB.prepare('UPDATE client_accounts SET password_hash = ?, password_set_by_self = 0 WHERE id = ?').bind(await hashPassword('recovered-password-123456'), amy.account.id).run();
        expect((await again.get(`/p/${slug}`)).status).toBe(302);
        expect((await api('POST', `/projects/${slug}/clients/${amy.account.username}/reset`, token)).status).toBe(200);
    });

    it('lets a team member change their own password, revoking their API tokens', async () => {
        const seeded = await seedProject();
        const { developer, password } = await seedDeveloper();
        const ownToken = await seedToken(developer);
        const here = await login(seeded, developer.username, password);
        const elsewhere = await login(seeded, developer.username, password);
        const slug = seeded.project.slug;

        const done = await changePassword(here, slug, password, STRONG);
        expect(done.status).toBe(303);
        const page = await (await here.get(`/p/${slug}/account`)).text();
        expect(page).toContain('API token 也已撤銷');
        expect((await here.get(`/p/${slug}`)).status).toBe(200);
        expect((await elsewhere.get(`/p/${slug}`)).status).toBe(302);
        expect((await api('GET', '/me', ownToken)).status).toBe(401);
        expect((await developerRow(developer.id)).password_set_by_self).toBe(1);

        const other = await seedDeveloper();
        const otherToken = await seedToken(other.developer);
        const reset = await api('POST', `/developers/${developer.username}/reset`, otherToken, {});
        expect(reset.status).toBe(409);
        expect((await api('DELETE', `/developers/${developer.username}`, otherToken)).status).toBe(409);
        expect((await api('POST', `/developers/${developer.username}/disable`, otherToken)).status).toBe(200);
    });

    it('asks for the current password again after five minutes and limits wrong guesses', async () => {
        const seeded = await seedProject();
        const amy = await seedClientAccount(seeded.project, unique('amy'), 'amy-password-1234567');
        const browser = await login(seeded, amy.account.username, amy.password, new Browser('10.77.1.1'));
        for (let i = 0; i < 5; i++) {
            expect((await browser.post(`/p/${seeded.project.slug}/account/verify`, { current_password: `wrong-${i}` })).status).toBe(422);
        }
        expect((await browser.post(`/p/${seeded.project.slug}/account/verify`, { current_password: amy.password })).status).toBe(429);
    });

    it('accepts stored hashes with different iteration counts', async () => {
        const seeded = await seedProject();
        const slow = await seedClientAccount(seeded.project, unique('slow'));
        await env.DB.prepare('UPDATE client_accounts SET password_hash = ? WHERE id = ?').bind(await hashPassword(slow.password, 20_000), slow.account.id).run();
        const fast = await seedClientAccount(seeded.project, unique('fast'));
        await env.DB.prepare('UPDATE client_accounts SET password_hash = ? WHERE id = ?').bind(await hashPassword(fast.password, 1_000), fast.account.id).run();
        expect((await new Browser().loginAs(seeded.project.slug, slow.account.username, slow.password)).status).toBe(302);
        expect((await new Browser().loginAs(seeded.project.slug, fast.account.username, fast.password)).status).toBe(302);
        const browser = await login(seeded, slow.account.username, slow.password);
        expect((await changePassword(browser, seeded.project.slug, slow.password, STRONG)).status).toBe(303);
        expect((await clientRow(slow.account.id)).password_hash).toMatch(/^pbkdf2_sha256\$10000\$/);
    });

    it('shows entry-link logins that there is no account to change', async () => {
        const seeded = await seedProject();
        const browser = await new Browser().asClient(seeded);
        const page = await (await browser.get(`/p/${seeded.project.slug}/account`)).text();
        expect(page).toContain('專屬連結登入');
        expect((await browser.post(`/p/${seeded.project.slug}/account/verify`, { current_password: 'x' })).status).toBe(403);
        expect(await (await browser.get(`/p/${seeded.project.slug}`)).text()).not.toContain('data-account-link');
    });
});
