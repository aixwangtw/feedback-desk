import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Report } from '../../src/worker/lib/models';
import { Browser, seedClientAccount, seedProject, seedReport, unique } from './helpers';

const CATEGORIES = '程式使用問題,經典排版,其他';

async function guestSetup(vars: Record<string, string> = {}) {
    const seeded = await seedProject({ client: false });
    const username = unique('guest');
    const { account } = await seedClientAccount(seeded.project, username, 'guest-password-1234567', '張子元');
    const allVars = { FEEDBACK_GUEST_CLIENT_PROJECT: seeded.project.slug, FEEDBACK_GUEST_CLIENT_ACCOUNT: username, FEEDBACK_REPORT_CATEGORIES: CATEGORIES, ...vars };
    const browser = () => new Browser(`10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, allVars);
    return { seeded, slug: seeded.project.slug, account, browser, vars: allVars };
}

function issue(category: string | null = '經典排版', extra: Record<string, string> = {}): Record<string, string> {
    return { 'issues[0][title]': '段落沒有換行', 'issues[0][description]': '第二段黏在一起。', ...(category === null ? {} : { 'issues[0][category]': category }), ...extra };
}

async function reportsOf(projectId: number): Promise<Report[]> {
    return (await env.DB.prepare('SELECT * FROM reports WHERE project_id = ? ORDER BY id').bind(projectId).all<Report>()).results;
}

describe('guest client entry', () => {
    it('opens the portal without login and shows the category options', async () => {
        const { slug, browser } = await guestSetup();
        const response = await browser().get(`/p/${slug}`);
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('data-issue-category');
        expect(html).toContain('經典排版');
        expect(html).not.toContain('data-logout');
        expect(html).not.toContain('data-account-link');
    });

    it('creates reports as the configured client account with the chosen category', async () => {
        const { seeded, slug, account, browser } = await guestSetup();
        const visitor = browser();
        expect((await visitor.post(`/p/${slug}/reports`, issue())).status).toBe(302);
        const [report] = await reportsOf(seeded.project.id);
        expect(report.creator_type).toBe('client');
        expect(report.creator_client_account_id).toBe(account.id);
        expect(report.category).toBe('經典排版');
        const page = await (await visitor.get(`/p/${slug}/reports/${report.public_id}`)).text();
        expect(page).toContain('data-report-category');
        expect(page).toContain('張子元');
    });

    it('rejects a missing or unknown category and the honeypot', async () => {
        const { seeded, slug, browser } = await guestSetup();
        expect((await browser().post(`/p/${slug}/reports`, issue(null))).status).toBe(422);
        expect((await browser().post(`/p/${slug}/reports`, issue('亂填'))).status).toBe(422);
        expect((await browser().post(`/p/${slug}/reports`, issue('其他', { contact_website: 'spam' }))).status).toBe(422);
        expect(await reportsOf(seeded.project.id)).toHaveLength(0);
    });

    it('throttles guest submissions and messages per IP', async () => {
        const { seeded, slug, browser } = await guestSetup({ FEEDBACK_PUBLIC_THROTTLE_PER_MINUTE: '2', FEEDBACK_PUBLIC_MESSAGE_THROTTLE_PER_MINUTE: '1' });
        const visitor = browser();
        expect((await visitor.post(`/p/${slug}/reports`, issue())).status).toBe(302);
        expect((await visitor.post(`/p/${slug}/reports`, issue())).status).toBe(302);
        expect((await visitor.post(`/p/${slug}/reports`, issue())).status).toBe(429);
        const { report } = await seedReport(seeded.project);
        expect((await visitor.post(`/p/${slug}/reports/${report.public_id}/messages`, { body: '補充' })).status).toBe(302);
        expect((await visitor.post(`/p/${slug}/reports/${report.public_id}/messages`, { body: '再補充' })).status).toBe(429);
    });

    it('does not let guests change the account', async () => {
        const { slug, browser } = await guestSetup();
        const response = await browser().post(`/p/${slug}/account/verify`, { current_password: 'guest-password-1234567' });
        expect([302, 403]).toContain(response.status);
        expect(response.status === 302 ? response.headers.get('location') ?? '' : '').not.toContain('/account/password');
    });

    it('keeps other projects and unconfigured sites behind login', async () => {
        const { slug, vars } = await guestSetup();
        const other = await seedProject();
        expect((await new Browser(undefined, vars).get(`/p/${other.project.slug}`)).status).toBe(302);
        expect((await new Browser().get(`/p/${slug}`)).status).toBe(302);
    });

    it('shows a category column and filters by category, including uncategorized', async () => {
        const { seeded, slug, browser, vars } = await guestSetup();
        const visitor = browser();
        await visitor.post(`/p/${slug}/reports`, { 'issues[0][title]': '排版單', 'issues[0][description]': 'd', 'issues[0][category]': '經典排版' });
        await visitor.post(`/p/${slug}/reports`, { 'issues[0][title]': '程式單', 'issues[0][description]': 'd', 'issues[0][category]': '程式使用問題' });
        await seedReport(seeded.project, { title: '舊單' });
        const html = async (query: string, as = visitor) => (await as.get(`/p/${slug}${query}`)).text();

        const all = await html('');
        expect(all).toContain('data-category-filter');
        expect(all).toContain('data-report-category');
        expect(all).toContain('排版單');
        expect(all).toContain('舊單');

        const classic = await html('?category=' + encodeURIComponent('經典排版'));
        expect(classic).toContain('排版單');
        expect(classic).not.toContain('程式單');
        expect(classic).not.toContain('舊單');

        const none = await html('?category=_none');
        expect(none).toContain('舊單');
        expect(none).not.toContain('排版單');

        const owner = new Browser(undefined, vars);
        expect((await owner.get(`/owner/${slug}/access?token=${seeded.ownerToken}`)).status).toBe(302);
        const ownerNone = await html('?category=_none', owner);
        expect(ownerNone).toContain('data-category-filter');
        expect(ownerNone).toContain('舊單');
        expect(ownerNone).not.toContain('排版單');
    });

    it('sites without categories have no category column or filter', async () => {
        const { slug, browser } = await guestSetup({ FEEDBACK_REPORT_CATEGORIES: '' });
        const html = await (await browser().get(`/p/${slug}`)).text();
        expect(html).not.toContain('data-category-filter');
        expect(html).not.toContain('data-report-category');
    });

    it('edit dialog offers the category dropdown preselected and saves a new category', async () => {
        const { seeded, slug, browser } = await guestSetup();
        const { report } = await seedReport(seeded.project);
        await env.DB.prepare('UPDATE reports SET category = ? WHERE id = ?').bind('經典排版', report.id).run();
        const visitor = browser();
        const dialogs = await (await visitor.get(`/p/${slug}/reports/${report.public_id}/dialogs`)).text();
        expect(dialogs).toContain(`id="edit-category-${report.public_id}"`);
        expect(dialogs).toMatch(/<option value="經典排版" selected/);
        const post = (category: string) => visitor.post(`/p/${slug}/reports/${report.public_id}/update`, { title: 't', description: 'd', category });
        expect((await post('亂填')).status).toBe(422);
        expect((await reportsOf(seeded.project.id))[0].category).toBe('經典排版');
        expect((await post('程式使用問題')).status).toBe(302);
        expect((await reportsOf(seeded.project.id))[0].category).toBe('程式使用問題');
    });

    it('edit allows an empty category and preselects uncategorized', async () => {
        const { seeded, slug, browser } = await guestSetup();
        const { report } = await seedReport(seeded.project);
        const visitor = browser();
        expect(await (await visitor.get(`/p/${slug}/reports/${report.public_id}/dialogs`)).text()).toMatch(/<option value="" selected[^>]*>未分類/);
        await env.DB.prepare('UPDATE reports SET category = ? WHERE id = ?').bind('經典排版', report.id).run();
        expect((await visitor.post(`/p/${slug}/reports/${report.public_id}/update`, { title: 't', description: 'd', category: '' })).status).toBe(302);
        expect((await reportsOf(seeded.project.id))[0].category).toBeNull();
    });

    it('edit keeps a legacy category that is no longer configured', async () => {
        const { seeded, slug, browser } = await guestSetup();
        const { report } = await seedReport(seeded.project);
        await env.DB.prepare('UPDATE reports SET category = ? WHERE id = ?').bind('舊分類', report.id).run();
        const visitor = browser();
        expect(await (await visitor.get(`/p/${slug}/reports/${report.public_id}/dialogs`)).text()).toMatch(/<option value="舊分類" selected/);
        expect((await visitor.post(`/p/${slug}/reports/${report.public_id}/update`, { title: 't', description: 'd', category: '舊分類' })).status).toBe(302);
        expect((await reportsOf(seeded.project.id))[0].category).toBe('舊分類');
    });

    it('shows the creator after the description in the detail dialog and page', async () => {
        const { seeded, slug, browser } = await guestSetup();
        const { report } = await seedReport(seeded.project);
        await env.DB.prepare('UPDATE reports SET description = ? WHERE id = ?').bind('說明內文XYZ', report.id).run();
        const visitor = browser();
        for (const html of [await (await visitor.get(`/p/${slug}/reports/${report.public_id}/dialogs`)).text(), await (await visitor.get(`/p/${slug}/reports/${report.public_id}`)).text()]) {
            expect(html.indexOf('建立者：')).toBeGreaterThan(html.indexOf('說明內文XYZ'));
        }
    });
});
