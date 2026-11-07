import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/worker/env';
import type { Report } from '../../src/worker/lib/models';
import type { ReportStatus } from '../../src/shared/status';
import { Browser, seedProject, seedReport, workerEnv, type SeededProject } from './helpers';

/**
 * 問題清單與看板的頁籤（取代狀態篩選下拉）、每張單上的狀態標示、客戶端的「完成」按鈕，
 * 以及網頁上不能手動改狀態（只有客戶能按「完成」）。頁籤直接對應狀態：等工程師＝new、等{客戶}＝needs_input。
 */
const labels = config(workerEnv).statusLabels;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function report(seeded: SeededProject, title: string, status: ReportStatus): Promise<Report> {
    const { report: created } = await seedReport(seeded.project, { title });
    await env.DB.prepare('UPDATE reports SET status = ?, completed_at = ? WHERE id = ?').bind(status, status === 'completed' ? minutesAgo(1) : null, created.id).run();
    return created;
}

async function message(target: Report, author: 'reporter' | 'owner' | 'agent', at: string): Promise<void> {
    await env.DB.prepare('INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)').bind(target.id, author, '留言', at, at).run();
}

/** A: 等工程師；B: 等客戶但客戶後來又留言；C: 等客戶、團隊最後回覆；D: 等客戶、調整重點比客戶留言新；E: 已完成。頁籤只看狀態，不看最後發言者。 */
async function fixture() {
    const seeded = await seedProject();
    const a = await report(seeded, '甲等工程師', 'new');
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
    it('team side opens on the 等工程師 tab (status new) with counts, and the status dropdown is gone', async () => {
        const { seeded, a, b, c, d, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        const html = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        const all = [a, b, c, d, e];

        expect(labels).toEqual({ new: '等工程師', needs_input: '等客戶', completed: '已完成' });
        expect(rowsOf(html, all)).toEqual(['甲等工程師']);
        expect(html).toMatch(new RegExp(`aria-current="page" data-portal-tab="developer">${labels.new} <span[^>]*>1</span>`));
        expect(html).toMatch(new RegExp(`data-portal-tab="client">${labels.needs_input} <span[^>]*>3</span>`));
        expect(html).toContain('data-portal-tab="completed">已完成 1</a>');
        expect(html).toContain('data-portal-tab="all">全部 5</a>');
        expect(html).not.toContain('篩選狀態');
        expect(html).not.toMatch(/<select name="status"/);
        expect(html).not.toContain('待回覆<');
        expect(html).not.toContain('待處理');
        expect(html).not.toContain('待審核');
    });

    it('client side opens on the 等{客戶} tab (status needs_input)', async () => {
        const { seeded, a, b, c, d, e } = await fixture();
        const client = await new Browser().asClient(seeded);
        const html = await (await client.get(`/p/${seeded.project.slug}`)).text();
        expect(rowsOf(html, [a, b, c, d, e]).sort()).toEqual(['丁調整重點較新', '丙團隊已回', '乙客戶追問'].sort());
        expect(html).toMatch(/aria-current="page" data-portal-tab="client"/);
    });

    it('the client label follows the site setting (業主 → 等業主)', async () => {
        const { seeded, a, b } = await fixture();
        const owner = new Browser(undefined, { FEEDBACK_LABEL_CLIENT: '業主' });
        await owner.asOwner(seeded);
        const html = await (await owner.get(`/p/${seeded.project.slug}?tab=all`)).text();
        expect(html).toMatch(/data-portal-tab="client">等業主 <span/);
        expect(html).toContain('等業主');
        expect(html).not.toContain('等客戶');
        expect(rowsOf(html, [a, b]).sort()).toEqual(['乙客戶追問', '甲等工程師'].sort());
    });

    it('both sides show the status name in the status column of each report (no separate waiting tag)', async () => {
        const { seeded, a, b, c, d, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        const client = await new Browser().asClient(seeded);
        const pages = [await (await owner.get(`/p/${seeded.project.slug}?tab=all`)).text(), await (await client.get(`/p/${seeded.project.slug}?tab=all`)).text(), await (await owner.get(`/p/${seeded.project.slug}?tab=all&view=board`)).text()];
        const labelOf = (html: string, target: Report) => {
            const start = Math.max(html.indexOf(`data-report-row="${target.public_id}"`), html.indexOf(`data-report-id="${target.public_id}"`));
            const rest = html.slice(start);
            const row = rest.slice(0, rest.search(/<\/tr>|<\/article>/));
            return /data-status-text="[a-z_]+">([^<]+)</.exec(row)?.[1] ?? null;
        };
        // The board shows the status by column (data-status on the card), not as text on each card.
        const board = pages[2];
        for (const [target, status] of [[a, 'new'], [b, 'needs_input'], [c, 'needs_input'], [d, 'needs_input'], [e, 'completed']] as const) {
            expect(board).toMatch(new RegExp(`data-report-id="${target.public_id}" data-status="${status}"`));
        }
        for (const html of pages.slice(0, 2)) {
            expect(labelOf(html, a)).toBe(labels.new);
            expect(labelOf(html, b)).toBe(labels.needs_input);
            expect(labelOf(html, c)).toBe(labels.needs_input);
            expect(labelOf(html, d)).toBe(labels.needs_input);
        }
        expect(labelOf(pages[0], e)).toBe(labels.completed);
        for (const html of pages) {
            expect(html).not.toContain('data-waiting');
            expect(html).not.toContain('data-report-flags');
        }
    });

    it('keeps the tab in the URL: view switch links and the search form carry it', async () => {
        const { seeded, a, b, c, d, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        const html = await (await owner.get(`/p/${seeded.project.slug}?tab=client`)).text();
        expect(html).toMatch(/href="[^"]*view=board[^"]*tab=client"[^>]*data-view-mode="board"/);
        expect(html).toContain('<input type="hidden" name="tab" value="client"/>');
        expect(rowsOf(html, [a, b, c, d, e]).sort()).toEqual(['丁調整重點較新', '丙團隊已回', '乙客戶追問'].sort());
        const board = await (await owner.get(`/p/${seeded.project.slug}?view=board&tab=client`)).text();
        expect(rowsOf(board, [a, b, c, d, e]).sort()).toEqual(['丁調整重點較新', '丙團隊已回', '乙客戶追問'].sort());
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

describe('網頁上不能手動改狀態，只有客戶能按「完成」', () => {
    it('the 完成 button (no confirm) is on the client list rows, board cards and detail dialog; the client can complete a report, the team gets a request-for-confirmation button instead', async () => {
        const { seeded, c, e } = await fixture();
        const client = await new Browser().asClient(seeded);
        for (const query of ['?tab=all', '?tab=all&view=board']) {
            const html = await (await client.get(`/p/${seeded.project.slug}${query}`)).text();
            expect(html).toContain('data-complete-report');
            expect(html).toContain(`reports/${c.public_id}/status`);
        }
        const teamList = await (await (await new Browser().asOwner(seeded)).get(`/p/${seeded.project.slug}?tab=all`)).text();
        expect(teamList).not.toContain('data-complete-report');
        const dialogs = await (await client.get(`/p/${seeded.project.slug}/reports/${c.public_id}/dialogs`)).text();
        expect(dialogs).toMatch(new RegExp(`action="/p/[^"]+/reports/${c.public_id}/status" data-completion-approve-form[^>]*><input type="hidden" name="_back"[^>]*/><input type="hidden" name="status" value="completed"/><button[^>]*data-complete-report`));
        expect(await (await client.get(`/p/${seeded.project.slug}/reports/${e.public_id}/dialogs`)).text()).not.toContain('data-complete-report');
        expect(dialogs).not.toContain('data-request-completion');
        const owner = await new Browser().asOwner(seeded);
        const ownerDialogs = await (await owner.get(`/p/${seeded.project.slug}/reports/${c.public_id}/dialogs`)).text();
        expect(ownerDialogs).toContain(`data-dialog-open="request-completion-${c.public_id}"`);
        expect(ownerDialogs).not.toContain('data-complete-report');
        expect((await client.post(`/p/${seeded.project.slug}/reports/${c.public_id}/status`, { status: 'completed' })).status).toBe(302);
        expect((await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(c.id).first<{ status: string }>())?.status).toBe('completed');
    });

    it('the status endpoint refuses everything but the client completing: team any value, client new／needs_input', async () => {
        const { seeded, a, c, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        const statusOf = async (target: Report) => (await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(target.id).first<{ status: string }>())?.status;
        for (const [target, value] of [[a, 'completed'], [a, 'needs_input'], [c, 'new'], [e, 'needs_input'], [a, 'in_progress']] as const) {
            expect((await owner.post(`/p/${seeded.project.slug}/reports/${target.public_id}/status`, { status: value })).status).toBe(403);
            expect((await owner.post(`/p/${seeded.project.slug}/reports/${target.public_id}/status`, { status: value }, { accept: 'application/json' })).status).toBe(403);
        }
        const client = await new Browser().asClient(seeded);
        for (const [target, value] of [[c, 'new'], [a, 'needs_input'], [e, 'new']] as const) {
            expect((await client.post(`/p/${seeded.project.slug}/reports/${target.public_id}/status`, { status: value }, { accept: 'application/json' })).status).toBe(403);
        }
        expect([await statusOf(a), await statusOf(c), await statusOf(e)]).toEqual(['new', 'needs_input', 'completed']);
    });

    it('no status dropdown, drag or 更新狀態 anywhere; the status shows as text and the client gets 完成 on the report page', async () => {
        const { seeded, a, c, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        const client = await new Browser().asClient(seeded);
        for (const browser of [owner, client]) {
            for (const query of ['?tab=all', '?tab=all&view=board']) {
                const html = await (await browser.get(`/p/${seeded.project.slug}${query}`)).text();
                expect(html).not.toMatch(/<select name="status"/);
                expect(html).not.toContain('data-status-autosave');
                expect(html).not.toContain('data-kanban-status-form');
                expect(html).not.toContain('移至其他狀態');
                expect(html).not.toContain('拖拉');
                expect(html).not.toContain('cursor-grab');
                expect(html).not.toContain('已完成（由客戶確認）');
            }
        }
        const list = await (await owner.get(`/p/${seeded.project.slug}?tab=all`)).text();
        expect(list).not.toContain('data-complete-report');
        const row = list.slice(list.indexOf(`data-report-row="${c.public_id}"`));
        expect(row.slice(0, row.indexOf('</tr>'))).toMatch(/data-status-text="needs_input"[^>]*>等客戶</);

        const teamPage = await (await owner.get(`/p/${seeded.project.slug}/reports/${a.public_id}`)).text();
        expect(teamPage).not.toContain('更新狀態');
        expect(teamPage).not.toMatch(/<select[^>]*name="status"/);
        expect(teamPage).toContain('data-report-status-panel');
        expect(teamPage).toMatch(/data-report-status-panel[\s\S]*等工程師/);
        expect(teamPage).not.toContain('data-complete-report');

        const clientPage = await (await client.get(`/p/${seeded.project.slug}/reports/${c.public_id}`)).text();
        expect(clientPage).not.toContain('更新狀態');
        expect(clientPage).not.toMatch(/<select[^>]*name="status"/);
        expect(clientPage).toMatch(new RegExp(`action="/p/[^"]+/reports/${c.public_id}/status"[^>]*>[\\s\\S]*?name="status" value="completed"[\\s\\S]*?data-complete-report`));
        const donePage = await (await client.get(`/p/${seeded.project.slug}/reports/${e.public_id}`)).text();
        expect(donePage).not.toContain('data-complete-report');
    });
});
