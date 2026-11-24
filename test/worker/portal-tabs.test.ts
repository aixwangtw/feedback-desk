import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { config } from '../../src/worker/env';
import type { Report } from '../../src/worker/lib/models';
import type { ReportStatus } from '../../src/shared/status';
import { Browser, seedProject, seedReport, workerEnv, type SeededProject } from './helpers';

/**
 * 問題清單與看板的三個頁籤（取代狀態篩選下拉）、每張單上的狀態標示，以及狀態切換鈕。
 * 頁籤名稱固定「待處理／待回覆／已完成」（2026-11-19 Laravel 版 8a75259），直接對應狀態：待處理＝new、待回覆＝needs_input。
 * 狀態切換鈕只有一顆（Laravel 版 594e6c7）：未完成顯示「完成」、已完成顯示「待處理」，客戶與開發團隊都能按。
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
    it('team side opens on the 待處理 tab (status new) with counts; three equal tabs, and the status dropdown is gone', async () => {
        const { seeded, a, b, c, d, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        const html = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        const all = [a, b, c, d, e];

        expect(labels).toEqual({ new: '等工程師', needs_input: '等客戶', completed: '已完成' });
        expect(rowsOf(html, all)).toEqual(['甲等工程師']);
        // 頁籤一樣大、名稱固定，滑鼠移上去顯示狀態名稱。
        expect(html).toMatch(new RegExp(`title="${labels.new}的單" aria-current="page" data-portal-tab="developer">待處理 <span[^>]*>1</span>`));
        expect(html).toMatch(new RegExp(`title="${labels.needs_input}的單" data-portal-tab="client">待回覆 <span[^>]*>3</span>`));
        expect(html).toMatch(/title="已完成的單" data-portal-tab="completed">已完成 <span[^>]*>1<\/span>/);
        expect(html).toContain('data-portal-tab="all">全部 5</a>');
        expect(html).not.toContain('篩選狀態');
        expect(html).not.toMatch(/<select name="status"/);
        expect(html).not.toContain('待審核');
        // 清單頁說明：三個頁籤、會自動切換、雙方都能用切換鈕。
        const guide = /data-status-auto-guide[^>]*>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '';
        expect(guide).toContain('問題分成「待處理」「待回覆」「已完成」三個頁籤');
        expect(guide).toContain('狀態會自動切換');
        expect(guide).toContain('客戶留言就變「待處理」，開發團隊回覆就變「待回覆」；已完成的單客戶又留言，也會自動改回「待處理」');
        expect(guide).toContain('雙方也都能隨時在操作欄、詳情或留言區下面按一下「完成」（已完成的單是「待處理」）自己切換');
        expect(html).toContain('待處理（等工程師）');
        expect(html).toContain('待回覆（等客戶）');
        expect(html).toContain('問題已解決；之後客戶再留言會自動改回「待處理」。');
        expect(html).toContain('同一個人 30 分鐘內重複送出標題與說明都一樣的單，系統會自動合併成一張（保留先送出的那張）。');
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
        expect(html).toMatch(/title="等業主的單" data-portal-tab="client">待回覆 <span/);
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

    it('completed reports sit under the 已完成 tab; 全部 shows everything; old status= links still filter by status only', async () => {
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

describe('狀態切換鈕：一顆鈕，雙方都能按', () => {
    const switchOf = (html: string, target: Report) =>
        new RegExp(`data-status-switch="${target.public_id}"><input type="hidden" name="_back" value="[^"]*"/><input type="hidden" name="status" value="(\\w+)"/><button[^>]*>([^<]+)</button>`).exec(html)?.slice(1);

    it('list rows, board cards, the detail side and the bottom of the thread show 完成 (or 待處理 once completed) on both sides', async () => {
        const { seeded, a, c, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        const client = await new Browser().asClient(seeded);
        for (const browser of [owner, client]) {
            for (const query of ['?tab=all', '?tab=all&view=board']) {
                const html = await (await browser.get(`/p/${seeded.project.slug}${query}`)).text();
                expect(switchOf(html, c)).toEqual(['completed', '完成']);
                expect(switchOf(html, e)).toEqual(['new', '待處理']);
                expect(html).not.toContain('data-complete-report');
                expect(html).not.toContain('data-request-completion');
            }
            const page = await (await browser.get(`/p/${seeded.project.slug}/reports/${a.public_id}`)).text();
            // 詳情右側欄一顆、留言串最下面一顆。
            expect(page.match(new RegExp(`data-status-switch="${a.public_id}"`, 'g'))).toHaveLength(2);
            expect(page).toContain('data-thread-status-switch');
            expect(page).toContain('data-detail-status-switch');
        }
    });

    it('the status endpoint takes any status from both sides; the client reopening is logged as reopen_by_client', async () => {
        const { seeded, a, c, e } = await fixture();
        const owner = await new Browser().asOwner(seeded);
        const client = await new Browser().asClient(seeded);
        const statusOf = async (target: Report) => (await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(target.id).first<{ status: string }>())?.status;
        const kindsOf = async (target: Report) => (await env.DB.prepare("SELECT kind, detail FROM report_events WHERE report_id = ? AND kind IN ('status', 'reopen_by_client') ORDER BY id").bind(target.id).all<{ kind: string; detail: string }>()).results;

        // 團隊：完成、改回待處理都可以；不認得的值照舊 422。
        expect((await owner.post(`/p/${seeded.project.slug}/reports/${a.public_id}/status`, { status: 'completed' }, { accept: 'application/json' })).status).toBe(200);
        expect(await statusOf(a)).toBe('completed');
        expect((await owner.post(`/p/${seeded.project.slug}/reports/${a.public_id}/status`, { status: 'new' })).status).toBe(302);
        expect(await statusOf(a)).toBe('new');
        expect((await owner.post(`/p/${seeded.project.slug}/reports/${a.public_id}/status`, { status: 'in_progress' }, { accept: 'application/json' })).status).toBe(422);
        expect(await kindsOf(a)).toEqual([{ kind: 'status', detail: 'new>completed' }, { kind: 'status', detail: 'completed>new' }]);

        // 客戶：完成、把已完成改回待處理（記 reopen_by_client）。
        expect((await client.post(`/p/${seeded.project.slug}/reports/${c.public_id}/status`, { status: 'completed' })).status).toBe(302);
        expect(await statusOf(c)).toBe('completed');
        const reopened = await client.post(`/p/${seeded.project.slug}/reports/${e.public_id}/status`, { status: 'new' }, { accept: 'application/json' });
        expect(reopened.status).toBe(200);
        expect(await reopened.json()).toMatchObject({ status: 'new', label: '等工程師', message: '狀態已更新為「等工程師」。' });
        expect(await kindsOf(e)).toEqual([{ kind: 'reopen_by_client', detail: 'completed>new' }]);
        const teamPage = await (await owner.get(`/p/${seeded.project.slug}/reports/${e.public_id}`)).text();
        expect(teamPage).toContain('按「待處理」改回等工程師（原本是已完成）');

        // 沒登入、別的專案的人照舊擋下。
        expect((await new Browser().post(`/p/${seeded.project.slug}/reports/${a.public_id}/status`, { status: 'completed' }, { accept: 'application/json' })).status).toBeGreaterThanOrEqual(400);
        const other = await new Browser().asClient(await seedProject());
        expect((await other.post(`/p/${seeded.project.slug}/reports/${a.public_id}/status`, { status: 'completed' }, { accept: 'application/json' })).status).toBeGreaterThanOrEqual(400);
        expect(await statusOf(a)).toBe('new');
    });

    it('no status dropdown or drag anywhere; the status shows as text', async () => {
        const { seeded, a, c } = await fixture();
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
        const row = list.slice(list.indexOf(`data-report-row="${c.public_id}"`));
        expect(row.slice(0, row.indexOf('</tr>'))).toMatch(/data-status-text="needs_input"[^>]*>等客戶</);

        const teamPage = await (await owner.get(`/p/${seeded.project.slug}/reports/${a.public_id}`)).text();
        expect(teamPage).not.toContain('更新狀態');
        expect(teamPage).not.toMatch(/<select[^>]*name="status"/);
        expect(teamPage).toContain('data-report-status-panel');
        expect(teamPage).toMatch(/data-report-status-panel[\s\S]*等工程師/);
    });
});
