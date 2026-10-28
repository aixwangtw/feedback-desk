import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { categoryProblem, parseCategoryInput } from '../../src/shared/categories';
import type { Project, Report } from '../../src/worker/lib/models';
import { api, Browser, seedDeveloper, seedProject, seedReport, seedToken, unique } from './helpers';

const CLIENT_PASSWORD = 'client-password-1234567';

async function setup() {
    const username = unique('cli');
    const seeded = await seedProject({ clientUsername: username, clientPassword: CLIENT_PASSWORD });
    const owner = new Browser();
    expect((await owner.get(`/owner/${seeded.project.slug}/access?token=${seeded.ownerToken}`)).status).toBe(302);
    const client = new Browser();
    expect((await client.loginAs(seeded.project.slug, username, CLIENT_PASSWORD)).status).toBe(302);
    return { seeded, slug: seeded.project.slug, owner, client };
}

async function categoriesOf(id: number): Promise<string | null> {
    return ((await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<Project>()) as Project).report_categories;
}

describe('per-project report categories', () => {
    it('parses commas (half and full width) and newlines, trims and dedupes', () => {
        expect(parseCategoryInput(' 程式問題，排版 ,\n其他\r\n排版,, ')).toEqual(['程式問題', '排版', '其他']);
        expect(parseCategoryInput('   ')).toEqual([]);
        expect(categoryProblem(Array.from({ length: 21 }, (_, i) => `c${i}`))).toContain('最多 20 個');
        expect(categoryProblem(['字'.repeat(51)])).toContain('太長');
        expect(categoryProblem(['字'.repeat(50)])).toBeNull();
    });

    it('owner sees project settings on my account and saves, then clears, the categories', async () => {
        const { seeded, slug, owner } = await setup();
        const page = await (await owner.get(`/p/${slug}/account`)).text();
        expect(page).toContain('data-project-settings');

        const saved = await owner.post(`/p/${slug}/settings/categories`, { categories: '程式問題，排版\n其他,排版' });
        expect(saved.status).toBe(303);
        expect(JSON.parse((await categoriesOf(seeded.project.id)) as string)).toEqual(['程式問題', '排版', '其他']);
        const after = await (await owner.get(`/p/${slug}/account`)).text();
        expect(after).toContain('value="程式問題,排版,其他"');
        expect(after).toContain('已更新開單分類');

        expect((await owner.post(`/p/${slug}/settings/categories`, { categories: '  ' })).status).toBe(303);
        expect(await categoriesOf(seeded.project.id)).toBeNull();
    });

    it('rejects too many or too long categories and keeps the old value', async () => {
        const { seeded, slug, owner } = await setup();
        await owner.post(`/p/${slug}/settings/categories`, { categories: '甲,乙' });
        const tooMany = await owner.post(`/p/${slug}/settings/categories`, { categories: Array.from({ length: 21 }, (_, i) => `c${i}`).join(',') });
        expect(tooMany.status).toBe(422);
        expect(await tooMany.text()).toContain('分類最多 20 個');
        expect((await owner.post(`/p/${slug}/settings/categories`, { categories: '字'.repeat(51) })).status).toBe(422);
        expect(JSON.parse((await categoriesOf(seeded.project.id)) as string)).toEqual(['甲', '乙']);
    });

    it('clients neither see nor change project settings', async () => {
        const { seeded, slug, client } = await setup();
        expect(await (await client.get(`/p/${slug}/account`)).text()).not.toContain('data-project-settings');
        expect((await client.post(`/p/${slug}/settings/categories`, { categories: '亂改' })).status).toBe(403);
        expect(await categoriesOf(seeded.project.id)).toBeNull();
    });

    it('categories belong to one project only; projects without them show no category field', async () => {
        const { slug, owner } = await setup();
        const other = await setup();
        await owner.post(`/p/${slug}/settings/categories`, { categories: '專屬分類' });
        expect(await (await owner.get(`/p/${slug}`)).text()).toContain('data-issue-category');
        const otherHtml = await (await other.owner.get(`/p/${other.slug}`)).text();
        expect(otherHtml).not.toContain('data-issue-category');
        expect(otherHtml).not.toContain('專屬分類');
    });

    it('new reports require a project category; edit keeps a legacy category preselected and allows clearing', async () => {
        const { seeded, slug, owner } = await setup();
        await owner.post(`/p/${slug}/settings/categories`, { categories: '程式問題,排版' });
        const create = (category?: string) =>
            owner.post(`/p/${slug}/reports`, { 'issues[0][title]': '標題', 'issues[0][description]': '說明', ...(category === undefined ? {} : { 'issues[0][category]': category }) });
        expect((await create()).status).toBe(422);
        expect((await create('不存在')).status).toBe(422);
        expect((await create('排版')).status).toBe(302);

        const { report } = await seedReport(seeded.project);
        await env.DB.prepare('UPDATE reports SET category = ? WHERE id = ?').bind('舊分類', report.id).run();
        const dialogs = await (await owner.get(`/p/${slug}/reports/${report.public_id}/dialogs`)).text();
        expect(dialogs).toMatch(/<option value="舊分類" selected/);
        expect(dialogs).toContain('未分類');
        const update = (category: string) => owner.post(`/p/${slug}/reports/${report.public_id}/update`, { title: 't', description: 'd', category });
        expect((await update('舊分類')).status).toBe(302);
        expect((await update('')).status).toBe(302);
        const saved = (await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(report.id).first<Report>()) as Report;
        expect(saved.category).toBeNull();
    });

    it('API (CLI project categories) shows, sets, clears and applies to all projects', async () => {
        const a = await seedProject();
        const b = await seedProject();
        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        const shown = await (await api('GET', `/projects/${a.project.slug}/categories`, token)).json<{ updated: boolean; projects: Array<{ categories: string[] }> }>();
        expect(shown).toEqual({ updated: false, projects: [{ slug: a.project.slug, categories: [] }] });

        const set = await api('POST', `/projects/${a.project.slug}/categories`, token, { categories: '甲，乙' });
        expect(set.status).toBe(200);
        expect(JSON.parse((await categoriesOf(a.project.id)) as string)).toEqual(['甲', '乙']);

        expect((await api('POST', `/projects/${a.project.slug}/categories`, token, { categories: '字'.repeat(51) })).status).toBe(422);

        expect((await api('POST', '/projects/all/categories', token, { categories: '共用' })).status).toBe(200);
        expect(JSON.parse((await categoriesOf(b.project.id)) as string)).toEqual(['共用']);

        expect((await api('POST', `/projects/${a.project.slug}/categories`, token, { clear: true })).status).toBe(200);
        expect(await categoriesOf(a.project.id)).toBeNull();
        expect((await api('GET', '/projects/no-such-project/categories', token)).status).toBe(404);
    });

    it('detail dialog and page switch the category directly with JSON responses', async () => {
        const { seeded, slug, owner, client } = await setup();
        await owner.post(`/p/${slug}/settings/categories`, { categories: '程式問題,排版' });
        const { report } = await seedReport(seeded.project);
        await env.DB.prepare('UPDATE reports SET category = ? WHERE id = ?').bind('舊分類', report.id).run();
        const dialogs = await (await client.get(`/p/${slug}/reports/${report.public_id}/dialogs`)).text();
        expect(dialogs).toContain(`id="detail-category-${report.public_id}"`);
        expect(dialogs).toMatch(/data-category-autosave[\s\S]*<option value="舊分類" selected/);
        const page = await (await client.get(`/p/${slug}/reports/${report.public_id}`)).text();
        expect(page).toContain(`id="page-category-${report.public_id}"`);

        const path = `/p/${slug}/reports/${report.public_id}/category`;
        const json = { accept: 'application/json' };
        const patch = (browser: Browser, category: string) => browser.request('PATCH', path, { body: new URLSearchParams({ category }), headers: { ...json, 'content-type': 'application/x-www-form-urlencoded' } });
        const category = async () => ((await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(report.id).first<Report>()) as Report).category;

        const bad = await patch(client, '亂填');
        expect(bad.status).toBe(422);
        expect((await bad.json<{ message: string }>()).message).toBe('這個分類不在專案的分類清單裡，請重新整理後再選。');
        expect(await category()).toBe('舊分類');

        const ok = await patch(client, '排版');
        expect(ok.status).toBe(200);
        expect(await ok.json()).toMatchObject({ category: '排版' });
        expect(await category()).toBe('排版');
        expect((await patch(owner, '')).status).toBe(200);
        expect(await category()).toBeNull();

        expect((await patch(new Browser(), '排版')).status).toBe(403);
        await owner.post(`/p/${slug}/settings/categories`, { categories: '' });
        const none = await patch(owner, '排版');
        expect(none.status).toBe(422);
        expect((await none.json<{ message: string }>()).message).toBe('這個專案沒有設定分類。');
        expect(await (await owner.get(`/p/${slug}/reports/${report.public_id}/dialogs`)).text()).not.toContain('data-category-autosave');
    });

    it('list rows and board cards switch the category with the same dropdown; none without categories', async () => {
        const { seeded, slug, owner, client } = await setup();
        const { report } = await seedReport(seeded.project);
        expect(await (await owner.get(`/p/${slug}`)).text()).not.toContain('data-category-autosave');
        await owner.post(`/p/${slug}/settings/categories`, { categories: '程式問題,排版' });
        const list = await (await client.get(`/p/${slug}`)).text();
        expect(list).toContain(`id="row-category-${report.public_id}"`);
        const board = await (await client.get(`/p/${slug}?view=board`)).text();
        expect(board).toContain(`id="card-category-${report.public_id}"`);
    });
});
