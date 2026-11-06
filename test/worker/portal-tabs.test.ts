import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/worker/env';
import type { Report } from '../../src/worker/lib/models';
import type { ReportStatus } from '../../src/shared/status';
import { Browser, seedProject, seedReport, workerEnv, type SeededProject } from './helpers';

/**
 * 問題清單與看板的頁籤（取代狀態篩選下拉）、每張單「等誰」的標示、客戶端的「完成」按鈕，
 * 以及開發團隊不能改成已完成。等誰由狀態與留言時間推導，不新增狀態值。
 */
const labels = config(workerEnv).labels;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function report(seeded: SeededProject, title: string, status: ReportStatus): Promise<Report> {
    const { report: created } = await seedReport(seeded.project, { title });
    await env.DB.prepare('UPDATE reports SET status = ?, completed_at = ? WHERE id = ?').bind(status, status === 'completed' ? minutesAgo(1) : null, created.id).run();
    return created;
}

async function message(target: Report, author: 'reporter' | 'owner' | 'agent', at: string): Promise<void> {
    await env.DB.prepare('INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)').bind(target.id, author, '留言', at, at).run();
}

/** A: 待處理；B: 待審核但客戶後來又留言；C: 待審核、團隊最後回覆；D: 待審核、調整重點比客戶留言新；E: 已完成。 */
async function fixture() {
    const seeded = await seedProject();
    const a = await report(seeded, '甲待處理', 'new');
    const b = await report(seeded, '乙客戶追問', 'needs_input');
    await message(b, 'owner', minutesAgo(30));
    await message(b, 'reporter', minutesAgo(10));
    const c = await report(seeded, '丙團隊已回', 'needs_input');
    await message(c, 'reporter', minutesAgo(30));
    await message(c, 'agent', minutesAgo(10));
    const d = await report(seeded, '丁調整重點較新', 'needs_input');
    await message(d, 'reporter', minutesAgo(30));
    await env.DB.prepare('UPDATE reports SET adjustment_updated_at = ? WHERE id = ?').bind(minutesAgo(5), d.id).run();
    const e = await report(seeded, '戊已完成', 'completed');
    return { seeded, a, b, c, d, e };
}

const rowsOf = (html: string, reports: Report[]) => reports.filter((target) => html.includes(`data-report-row="${target.public_id}"`) || html.includes(`data-report-id="${target.public_id}"`)).map((target) => target.title);
const tabLink = (html: string, tab: string) => new RegExp(`<a href="([^"]*)"[^>]*data-portal-tab="${tab}"`).exec(html)?.[1]?.replaceAll('&amp;', '&') ?? '';

describe('清單頁籤與等誰標示', () => {
    it('team side opens on 待{團隊}回覆 with counts, and the status dropdown is gone', async () => {
        const { seeded, a, b, c, d, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        const html = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        const all = [a, b, c, d, e];

        expect(rowsOf(html, all).sort()).toEqual(['乙客戶追問', '甲待處理'].sort());
        expect(html).toMatch(new RegExp(`aria-current="page" data-portal-tab="developer">待${labels.owner}回覆 <span[^>]*>2</span>`));
        expect(html).toMatch(new RegExp(`data-portal-tab="client">待${labels.client}回覆 <span[^>]*>2</span>`));
        expect(html).toContain('data-portal-tab="completed">已完成 1</a>');
        expect(html).toContain('data-portal-tab="all">全部 5</a>');
        expect(html).not.toContain('篩選狀態');
        expect(html).not.toMatch(/<select name="status" data-auto-submit/);
        expect(html).not.toContain('待回覆<');
    });

    it('client side opens on 待{客戶}回覆', async () => {
        const { seeded, a, b, c, d, e } = await fixture();
        const client = await new Browser().asClient(seeded);
        const html = await (await client.get(`/p/${seeded.project.slug}`)).text();
        expect(rowsOf(html, [a, b, c, d, e]).sort()).toEqual(['丁調整重點較新', '丙團隊已回'].sort());
        expect(html).toMatch(/aria-current="page" data-portal-tab="client"/);
    });

    it('both sides show the same 等… label on each report; completed reports have none', async () => {
        const { seeded, a, b, c, d, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        const client = await new Browser().asClient(seeded);
        const pages = [await (await owner.get(`/p/${seeded.project.slug}?tab=all`)).text(), await (await client.get(`/p/${seeded.project.slug}?tab=all`)).text(), await (await owner.get(`/p/${seeded.project.slug}?tab=all&view=board`)).text()];
        const labelOf = (html: string, target: Report) => {
            const start = Math.max(html.indexOf(`data-report-row="${target.public_id}"`), html.indexOf(`data-report-id="${target.public_id}"`));
            const rest = html.slice(start);
            const row = rest.slice(0, rest.search(/<\/tr>|<\/article>/));
            return /data-waiting="(developer|client)">([^<]+)</.exec(row)?.[2] ?? null;
        };
        for (const html of pages) {
            expect(labelOf(html, a)).toBe(`等${labels.owner}`);
            expect(labelOf(html, b)).toBe(`等${labels.owner}`);
            expect(labelOf(html, c)).toBe(`等${labels.client}`);
            expect(labelOf(html, d)).toBe(`等${labels.client}`);
        }
        expect(pages[0]).not.toContain(`data-waiting="completed"`);
        const completedRow = pages[0].slice(pages[0].indexOf(`data-report-row="${e.public_id}"`));
        expect(completedRow.slice(0, completedRow.indexOf('</tr>'))).not.toContain('data-waiting');
    });

    it('keeps the tab in the URL: view switch links and the search form carry it', async () => {
        const { seeded, a, b, c, d, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        const html = await (await owner.get(`/p/${seeded.project.slug}?tab=client`)).text();
        expect(html).toMatch(/href="[^"]*view=board[^"]*tab=client"[^>]*data-view-mode="board"/);
        expect(html).toContain('<input type="hidden" name="tab" value="client"/>');
        expect(rowsOf(html, [a, b, c, d, e]).sort()).toEqual(['丁調整重點較新', '丙團隊已回'].sort());
        const board = await (await owner.get(`/p/${seeded.project.slug}?view=board&tab=client`)).text();
        expect(rowsOf(board, [a, b, c, d, e]).sort()).toEqual(['丁調整重點較新', '丙團隊已回'].sort());
        expect(board).toMatch(/href="[^"]*view=list[^"]*tab=client"[^>]*data-view-mode="list"/);
        expect(tabLink(board, 'developer')).toContain('view=board');
    });

    it('completed reports sit under the small 已完成 link; 全部 shows everything; old status= links still filter by status only', async () => {
        const { seeded, a, b, c, d, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        const first = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        expect(tabLink(first, 'completed')).toContain('tab=completed');
        const completed = await (await owner.get(tabLink(first, 'completed'))).text();
        expect(rowsOf(completed, [a, b, c, d, e])).toEqual(['戊已完成']);
        const everything = await (await owner.get(tabLink(first, 'all'))).text();
        expect(rowsOf(everything, [a, b, c, d, e])).toHaveLength(5);
        const legacy = await (await owner.get(`/p/${seeded.project.slug}?status=needs_input`)).text();
        expect(rowsOf(legacy, [a, b, c, d, e]).sort()).toEqual(['丁調整重點較新', '丙團隊已回', '乙客戶追問'].sort());
        expect(legacy).not.toMatch(/aria-current="page" data-portal-tab=/);
    });
});

describe('完成只由客戶確認', () => {
    it('the client has a 完成 button (with confirm) on list rows and board cards and can complete a report', async () => {
        const { seeded, c, e } = await fixture();
        const client = await new Browser().asClient(seeded);
        for (const query of ['?tab=all', '?tab=all&view=board']) {
            const html = await (await client.get(`/p/${seeded.project.slug}${query}`)).text();
            expect(html).toMatch(new RegExp(`action="/p/[^"]+/reports/${c.public_id}/status" data-confirm="[^"]+"><input type="hidden" name="_back"[^>]*/><input type="hidden" name="status" value="completed"/><button[^>]*data-complete-report`));
            expect(html).not.toContain(`reports/${e.public_id}/status" data-confirm`);
        }
        expect((await client.post(`/p/${seeded.project.slug}/reports/${c.public_id}/status`, { status: 'completed' })).status).toBe(302);
        expect((await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(c.id).first<{ status: string }>())?.status).toBe('completed');
    });

    it('the team cannot set completed: the server answers 403 and the menus have no 已完成 option', async () => {
        const { seeded, a, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        expect((await owner.post(`/p/${seeded.project.slug}/reports/${a.public_id}/status`, { status: 'completed' })).status).toBe(403);
        expect((await owner.post(`/p/${seeded.project.slug}/reports/${a.public_id}/status`, { status: 'completed' }, { accept: 'application/json' })).status).toBe(403);
        expect((await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(a.id).first<{ status: string }>())?.status).toBe('new');
        // Moving back from completed is still allowed.
        expect((await owner.post(`/p/${seeded.project.slug}/reports/${e.public_id}/status`, { status: 'needs_input' })).status).toBe(302);
        await env.DB.prepare("UPDATE reports SET status = 'completed' WHERE id = ?").bind(e.id).run();

        const list = await (await owner.get(`/p/${seeded.project.slug}?tab=all`)).text();
        expect(list).not.toContain('data-complete-report');
        expect(list).not.toMatch(/<option value="completed"[^>]*>已完成<\/option>/);
        expect(list).toMatch(/<option value="completed"[^>]*selected=""[^>]*disabled=""[^>]*>已完成（由客戶確認）<\/option>/);
        const page = await (await owner.get(`/p/${seeded.project.slug}/reports/${a.public_id}`)).text();
        expect(page).not.toMatch(/<option value="completed"/);
        const done = await (await owner.get(`/p/${seeded.project.slug}/reports/${e.public_id}`)).text();
        expect(done).toContain('已完成（由客戶確認）');

        const client = await new Browser().asClient(seeded);
        expect(await (await client.get(`/p/${seeded.project.slug}/reports/${a.public_id}`)).text()).toMatch(/<option value="completed"[^>]*>已完成<\/option>/);
    });
});
