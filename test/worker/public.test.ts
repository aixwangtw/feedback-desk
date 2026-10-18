import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Report } from '../../src/worker/lib/models';
import { Browser, seedAttachment, seedProject, seedReport, unique } from './helpers';

async function publicSetup(options: { enabled?: boolean; vars?: Record<string, string> } = {}) {
    const seeded = await seedProject({ client: false, publicReporting: options.enabled ?? true });
    const vars = { FEEDBACK_HOME_PUBLIC_PROJECT: seeded.project.slug, ...options.vars };
    return { seeded, slug: seeded.project.slug, vars, browser: () => new Browser(`10.1.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, vars) };
}

async function submit(browser: Browser, form: Record<string, string | string[]> = {}) {
    return browser.post('/public-reports', { title: '首頁按鈕太小', description: '手機上不好按', ...form });
}

async function latestPublicReport(projectId: number): Promise<Report> {
    return (await env.DB.prepare("SELECT * FROM reports WHERE project_id = ? AND creator_type = 'public' ORDER BY id DESC LIMIT 1").bind(projectId).first<Report>()) as Report;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('home page public reporting', () => {
    it('keeps the plain home page unless both the setting and the project switch are on', async () => {
        const off = await publicSetup({ enabled: false });
        expect(await (await off.browser().get('/')).text()).not.toContain('data-public-report-form');
        expect((await submit(off.browser())).status).toBe(404);
        const missing = new Browser(undefined, { FEEDBACK_HOME_PUBLIC_PROJECT: unique('nope') });
        expect(await (await missing.get('/')).text()).not.toContain('data-public-report-form');
        const on = await publicSetup();
        const html = await (await on.browser().get('/')).text();
        expect(html).toContain('data-public-report-form');
        expect(html).toContain('不需要註冊，也不用留 email');
        expect(html).not.toContain('data-public-github');
    });

    it('shows links only when they are https', async () => {
        const { browser } = await publicSetup({ vars: { FEEDBACK_PUBLIC_GITHUB_URL: 'https://github.com/x', FEEDBACK_PUBLIC_BLOG_URL: 'javascript:alert(1)', FEEDBACK_PUBLIC_NOTICE: '歡迎用中文或英文回報' } });
        const html = await (await browser().get('/')).text();
        expect(html).toContain('data-public-github');
        expect(html).not.toContain('data-public-blog');
        expect(html).toContain('歡迎用中文或英文回報');
    });

    it('creates a public report, shows the private URL once and remembers it in this browser', async () => {
        const { seeded, slug, browser } = await publicSetup();
        const visitor = browser();
        const response = await submit(visitor, { reporter_name: '小明' });
        expect(response.status).toBe(302);
        const report = await latestPublicReport(seeded.project.id);
        expect(report).toMatchObject({ creator_type: 'public', reporter_name: '小明', title: '首頁按鈕太小' });
        const page = await (await visitor.get(`/p/${slug}/reports/${report.public_id}`)).text();
        expect(page).toContain('存下這個網址才能回來看');
        const url = /data-private-url="true"|value="([^"]+access=[^"]+)"/.exec(page);
        expect(page).toMatch(/value="https:\/\/feedback\.test\/p\/[^"]+\?access=[A-Za-z0-9]{48}"/);
        expect(url).not.toBeNull();
        expect(page).toContain('回首頁');
        expect(page).not.toContain('data-logout');
        const again = await (await visitor.get(`/p/${slug}/reports/${report.public_id}`)).text();
        expect(again).not.toContain('存下這個網址才能回來看');
        const home = await (await visitor.get('/')).text();
        expect(home).toContain('你送出的單');
        expect(home).toContain('首頁按鈕太小');
        expect(await (await browser().get('/')).text()).not.toContain('你送出的單');
    });

    it('lets a fresh browser in with the private URL, but only into that report', async () => {
        const { seeded, slug, browser } = await publicSetup();
        const { report, token } = await seedReport(seeded.project, { creator: 'public', title: '我的單' });
        const { report: other } = await seedReport(seeded.project, { creator: 'public', title: '別人的單' });
        const fresh = browser();
        expect((await fresh.get(`/p/${slug}/reports/${report.public_id}?access=${token}`)).status).toBe(302);
        expect((await fresh.get(`/p/${slug}/reports/${report.public_id}`)).status).toBe(200);
        expect((await fresh.get(`/p/${slug}/reports/${other.public_id}`)).status).toBe(404);
        expect((await fresh.get(`/p/${slug}/reports/${other.public_id}?access=${token}`)).status).toBe(404);
        expect((await fresh.get(`/p/${slug}`)).status).toBe(302);
        expect(await (await fresh.get('/')).text()).toContain('我的單');
    });

    it('reporters cannot change status, edit, delete, write adjustments or gain client access', async () => {
        const { seeded, slug, browser } = await publicSetup();
        const visitor = browser();
        await submit(visitor);
        const report = await latestPublicReport(seeded.project.id);
        const base = `/p/${slug}/reports/${report.public_id}`;
        expect((await visitor.post(`${base}/status`, { status: 'completed' })).status).toBe(302);
        expect((await visitor.post(`${base}/update`, { title: 'x', description: 'y' })).status).toBe(302);
        expect((await visitor.post(`${base}/client-delete`)).status).toBe(302);
        expect((await visitor.post(`${base}/delete`)).status).toBe(302);
        expect((await visitor.post(`${base}/adjustment`, { adjustment_note: 'x' })).status).toBe(302);
        expect((await visitor.get(`/p/${slug}`)).status).toBe(302);
        const after = await env.DB.prepare('SELECT status, title, client_deleted_at, adjustment_note FROM reports WHERE id = ?').bind(report.id).first();
        expect(after).toEqual({ status: 'new', title: '首頁按鈕太小', client_deleted_at: null, adjustment_note: null });
    });

    it('existing clients never see public reports', async () => {
        const seeded = await seedProject({ publicReporting: true });
        const { report } = await seedReport(seeded.project, { creator: 'public', title: '陌生人的單' });
        const client = await new Browser().asClient(seeded);
        expect(await (await client.get(`/p/${seeded.project.slug}`)).text()).not.toContain('陌生人的單');
        expect((await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).status).toBe(404);
    });

    it('a stranger cannot message or download attachments of a public report', async () => {
        const { seeded, slug, browser } = await publicSetup();
        const { report } = await seedReport(seeded.project, { creator: 'public' });
        const attachment = await seedAttachment(report);
        const stranger = browser();
        expect((await stranger.post(`/p/${slug}/reports/${report.public_id}/messages`, { body: 'hi' })).status).toBe(302);
        expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE report_id = ?').bind(report.id).first('n')).toBe(0);
        const download = await stranger.get(`/p/${slug}/reports/${report.public_id}/attachments/${attachment}`);
        expect(download.status).toBe(302);
        expect(download.headers.get('content-type') ?? '').not.toContain('image');
        expect((await stranger.upload(slug, `purpose=message&report=${report.public_id}`)).status).toBe(403);
    });

    it('honeypot submissions are dropped silently', async () => {
        const { seeded, browser } = await publicSetup();
        const response = await submit(browser(), { contact_website: 'http://spam.example' });
        expect(response.headers.get('location')).toBe('/');
        expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE project_id = ?').bind(seeded.project.id).first('n')).toBe(0);
    });

    it('validates fields and limits screenshots to three of at most 5 MB', async () => {
        const { slug, browser } = await publicSetup();
        const visitor = browser();
        const empty = await submit(visitor, { title: '', reporter_name: 'x'.repeat(51) });
        expect(empty.status).toBe(422);
        const html = await empty.text();
        expect(html).toContain('標題 為必填。');
        expect(html).toContain('稱呼 不能超過 50 個字元。');
        const big = await visitor.request('PUT', `/p/${slug}/uploads?purpose=public`, { body: new Uint8Array(16), headers: { 'content-length': String(5 * 1024 * 1024 + 1) } });
        expect(big.status).toBe(413);
        const ids = [];
        for (let i = 0; i < 4; i++) ids.push(await visitor.uploadId(slug, 'purpose=public'));
        const tooMany = await submit(visitor, { 'upload_ids[]': ids });
        expect(await tooMany.text()).toContain('截圖最多 3 張。');
        expect((await submit(visitor, { 'upload_ids[]': ids.slice(0, 3) })).status).toBe(302);
    });

    it('throttles submissions per IP per minute', async () => {
        const { browser } = await publicSetup({ vars: { FEEDBACK_PUBLIC_THROTTLE_PER_MINUTE: '2' } });
        const visitor = browser();
        expect((await submit(visitor)).status).toBe(302);
        expect((await submit(visitor)).status).toBe(302);
        const blocked = await submit(visitor);
        expect(blocked.status).toBe(429);
        expect(await blocked.text()).toContain('嘗試次數過多');
        expect((await submit(browser())).status).toBe(302);
    });

    it('throttles reporter messages but not the team, and caps attachments per report', async () => {
        const { seeded, slug, browser } = await publicSetup({ vars: { FEEDBACK_PUBLIC_MESSAGE_THROTTLE_PER_MINUTE: '2', FEEDBACK_PUBLIC_MAX_ATTACHMENTS: '2' } });
        const visitor = browser();
        await submit(visitor);
        const report = await latestPublicReport(seeded.project.id);
        const base = `/p/${slug}/reports/${report.public_id}`;
        const images = [await visitor.uploadId(slug, `purpose=message&report=${report.public_id}`), await visitor.uploadId(slug, `purpose=message&report=${report.public_id}`), await visitor.uploadId(slug, `purpose=message&report=${report.public_id}`)];
        const capped = await visitor.post(`${base}/messages`, { body: '附三張', 'upload_ids[]': images });
        expect(capped.status).toBe(422);
        expect(await capped.text()).toContain('這張單的附圖總數不可超過 2 張。');
        expect((await visitor.post(`${base}/messages`, { body: '第二則' })).status).toBe(302);
        expect((await visitor.post(`${base}/messages`, { body: '第三則' })).status).toBe(429);

        const owner = new Browser(undefined, { FEEDBACK_HOME_PUBLIC_PROJECT: slug });
        await owner.asOwner(seeded);
        for (let i = 0; i < 4; i++) {
            expect((await owner.post(`${base}/messages`, { body: `團隊回覆 ${i}` })).status).toBe(302);
        }
    });

    it('team messages on public reports show only the team label', async () => {
        const { seeded, slug, browser } = await publicSetup();
        const visitor = browser();
        await submit(visitor, { reporter_name: '阿華' });
        const report = await latestPublicReport(seeded.project.id);
        const owner = new Browser(undefined, { FEEDBACK_HOME_PUBLIC_PROJECT: slug });
        const { seedDeveloper } = await import('./helpers');
        const { developer, password } = await seedDeveloper(undefined, undefined, '王小明');
        await owner.loginAs(slug, developer.username, password);
        await owner.post(`/p/${slug}/reports/${report.public_id}/messages`, { body: '收到' });
        await visitor.post(`/p/${slug}/reports/${report.public_id}/messages`, { body: '謝謝' });
        const names = await env.DB.prepare('SELECT author_name FROM messages WHERE report_id = ? ORDER BY id').bind(report.id).all<{ author_name: string }>();
        expect(names.results.map((row) => row.author_name)).toEqual(['開發團隊', '阿華']);
        const page = await (await visitor.get(`/p/${slug}/reports/${report.public_id}`)).text();
        expect(page).not.toContain('王小明');
    });

    it('becomes read-only for reporters when intake stops', async () => {
        const { seeded, slug, browser } = await publicSetup();
        const visitor = browser();
        await submit(visitor);
        const report = await latestPublicReport(seeded.project.id);
        await env.DB.prepare('UPDATE projects SET public_reporting_enabled = 0 WHERE id = ?').bind(seeded.project.id).run();
        const page = await (await visitor.get(`/p/${slug}/reports/${report.public_id}`)).text();
        expect(page).toContain('已停止收件，這張單只能查看，不能再留言。');
        const message = await visitor.post(`/p/${slug}/reports/${report.public_id}/messages`, { body: '還可以嗎' });
        expect(message.status).toBe(403);
        expect(await message.text()).toContain('這個專案已停止收件');
    });

    it('team sees public reports with the creator filter option', async () => {
        const { seeded, slug } = await publicSetup();
        await seedReport(seeded.project, { creator: 'public', reporterName: '路人', title: '公開的單' });
        const owner = await new Browser().asOwner(seeded);
        const html = await (await owner.get(`/p/${slug}?creator=public`)).text();
        expect(html).toContain('公開的單');
        expect(html).toContain('<option value="public" selected="">公開回報</option>');
    });
});

describe('turnstile', () => {
    const keys = { FEEDBACK_TURNSTILE_SITE_KEY: 'site-key', FEEDBACK_TURNSTILE_SECRET_KEY: 'secret-key' };

    it('stays off with only one key', async () => {
        const { browser } = await publicSetup({ vars: { FEEDBACK_TURNSTILE_SITE_KEY: 'site-key' } });
        expect(await (await browser().get('/')).text()).not.toContain('cf-turnstile');
    });

    it('renders the widget and refuses when siteverify fails or is unreachable', async () => {
        const { seeded, browser } = await publicSetup({ vars: keys });
        expect(await (await browser().get('/')).text()).toContain('data-sitekey="site-key"');
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ success: false })));
        const failed = await submit(browser(), { 'cf-turnstile-response': 'token' });
        expect(failed.status).toBe(422);
        expect(await failed.text()).toContain('人機驗證沒有通過');
        spy.mockRejectedValueOnce(new Error('network down'));
        expect((await submit(browser(), { 'cf-turnstile-response': 'token' })).status).toBe(422);
        expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE project_id = ?').bind(seeded.project.id).first('n')).toBe(0);
    });

    it('accepts a passing check and sends the secret, skipped for honeypot hits', async () => {
        const { seeded, browser } = await publicSetup({ vars: keys });
        const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ success: true })));
        expect((await submit(browser(), { contact_website: 'x' })).status).toBe(302);
        expect(spy).not.toHaveBeenCalled();
        expect((await submit(browser(), { 'cf-turnstile-response': 'token' })).status).toBe(302);
        const body = String((spy.mock.calls[0][1] as RequestInit).body);
        expect(body).toContain('secret=secret-key');
        expect(body).toContain('response=token');
        expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE project_id = ?').bind(seeded.project.id).first('n')).toBe(1);
    });
});
