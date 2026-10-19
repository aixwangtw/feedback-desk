import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Report } from '../../src/worker/lib/models';
import { api, Browser, mcpCall, reload, rpcResult, seedAttachment, seedDeveloper, seedProject, seedReport, seedToken, type SeededProject } from './helpers';

/** Lets the clock move on, so times written by consecutive requests differ (comparisons are strict). */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

async function insertMessage(report: Pick<Report, 'id'>, authorType: 'reporter' | 'owner' | 'agent', at: string, body = '留言'): Promise<number> {
    const row = await env.DB.prepare('INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
        .bind(report.id, authorType, null, body, at, at)
        .first<{ id: number }>();
    return row?.id ?? 0;
}

async function portal(browser: Browser, seeded: SeededProject, query = ''): Promise<string> {
    const response = await browser.get(`/p/${seeded.project.slug}${query}`);
    expect(response.status).toBe(200);
    return response.text();
}

async function clientPosts(client: Browser, seeded: SeededProject, report: Report, body: string): Promise<void> {
    expect((await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body })).status).toBe(302);
}

describe('unread client messages on the team side', () => {
    it('counts client messages until the team opens the report page', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project, { title: '登入頁跑版' });
        const { report: other } = await seedReport(seeded.project, { title: '沒有留言的單' });
        const client = await new Browser().asClient(seeded);
        await clientPosts(client, seeded, report, '補充一');
        await tick();
        await clientPosts(client, seeded, report, '補充二');

        const owner = await new Browser().asOwner(seeded);
        let html = await portal(owner, seeded);
        expect(html).toContain('data-unread-messages="2"');
        expect(html).toContain('新留言 2');
        expect(html).toContain('留言 2');
        expect(html).toContain('有 1 張單有未讀留言');
        expect(html).toContain('只看未讀留言');
        expect(html).not.toContain(`data-unread-messages="0"`);

        // The preview dialog on the list does not mark the report read.
        expect((await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}/dialogs`)).status).toBe(200);
        expect(await portal(owner, seeded)).toContain('新留言 2');

        const before = await reload('reports', report);
        await tick();
        expect((await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).status).toBe(200);
        const after = await reload('reports', report);
        expect(after.owner_last_read_at).not.toBeNull();
        expect(after.latest_activity_at).toBe(before.latest_activity_at);
        expect(after.updated_at).toBe(before.updated_at);

        html = await portal(owner, seeded);
        expect(html).not.toMatch(/新留言 \d/);
        expect(html).not.toContain('未讀留言');
        expect(html).toContain('留言 2');
        expect(other.owner_last_read_at).toBeNull();
    });

    it('never counts messages written by the team or by AI agents', async () => {
        const seeded = await seedProject();
        const { developer, password } = await seedDeveloper();
        const { developer: colleague, password: colleaguePassword } = await seedDeveloper();
        const { report } = await seedReport(seeded.project);
        const me = new Browser();
        await me.loginAs(seeded.project.slug, developer.username, password);
        const teammate = new Browser();
        await teammate.loginAs(seeded.project.slug, colleague.username, colleaguePassword);
        expect((await teammate.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: '我來看看' })).status).toBe(302);
        await insertMessage(report, 'agent', new Date(Date.now() + 1000).toISOString());
        const html = await portal(me, seeded);
        expect(html).not.toMatch(/新留言 \d/);
        expect(html).toContain('留言 2');

        // A team member writing a message has seen the report, so earlier client messages are read too.
        const client = await new Browser().asClient(seeded);
        await clientPosts(client, seeded, report, '還是不行');
        expect(await portal(me, seeded)).toContain('新留言 1');
        await tick();
        expect((await me.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: '已修正' })).status).toBe(302);
        expect(await portal(me, seeded)).not.toMatch(/新留言 \d/);
    });

    it('marks the report read when the team polls new activity', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const owner = await new Browser().asOwner(seeded);
        await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}`);
        await tick();
        const client = await new Browser().asClient(seeded);
        await clientPosts(client, seeded, report, '新的問題');
        expect(await portal(owner, seeded)).toContain('新留言 1');
        await tick();
        const poll = await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}/activity`, { 'if-none-match': 'W/"stale"' });
        expect(poll.status).toBe(200);
        expect(await portal(owner, seeded)).not.toMatch(/新留言 \d/);
    });

    it('filters to unread reports, keeps the other filters and sorts by the latest message', async () => {
        const seeded = await seedProject();
        const { report: quiet } = await seedReport(seeded.project, { title: '安靜的單' });
        const { report: older } = await seedReport(seeded.project, { title: '較早留言' });
        const { report: newer } = await seedReport(seeded.project, { title: '後來的留言' });
        const { report: none } = await seedReport(seeded.project, { title: '完全沒留言' });
        const base = Date.now();
        await insertMessage(newer, 'reporter', new Date(base + 2000).toISOString());
        await insertMessage(older, 'reporter', new Date(base + 1000).toISOString());
        await insertMessage(quiet, 'owner', new Date(base + 3000).toISOString());
        const owner = await new Browser().asOwner(seeded);

        let html = await portal(owner, seeded, '?unread=1&q=留言&view=board');
        expect(html).toContain('有 2 張單有未讀留言');
        expect(html).toContain('較早留言');
        expect(html).toContain('後來的留言');
        expect(html).not.toContain('完全沒留言');
        expect(html).not.toContain('安靜的單');
        expect(html).toContain('顯示全部');
        expect(html).toContain('<input type="hidden" name="unread" value="1"/>');
        // Other links keep the unread filter, "顯示全部" drops only it.
        expect(html).toMatch(/href="[^"]*view=list[^"]*unread=1[^"]*"/);
        expect(html).toMatch(/href="\/p\/[^"?]+\?view=board&amp;q=%E7%95%99%E8%A8%80&amp;sort=created_at&amp;direction=desc"[^>]*data-unread-show-all/);

        html = await portal(owner, seeded, '?sort=latest_message_at&direction=desc');
        const order = ['安靜的單', '後來的留言', '較早留言', '完全沒留言'].map((title) => html.indexOf(`>${title}</button>`));
        expect(order.every((position) => position > 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(none.id).toBeGreaterThan(0);
    });
});

describe('new replies on the client side', () => {
    it('shows "有新回覆" after a team reply until the client opens the report', async () => {
        const seeded = await seedProject();
        const client = await new Browser().asClient(seeded);
        const { report } = await seedReport(seeded.project, { title: '匯出失敗' });
        expect(report.client_last_read_at).not.toBeNull();
        expect(report.owner_last_read_at).toBeNull();
        expect(await portal(client, seeded)).not.toContain('有新回覆');

        await tick();
        const owner = await new Browser().asOwner(seeded);
        expect((await owner.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: '請再試一次' })).status).toBe(302);
        let html = await portal(client, seeded);
        expect(html).toContain('data-new-reply="true"');
        expect(html).toContain('有新回覆');

        // The board shows it too.
        expect(await portal(client, seeded, '?view=board')).toContain('有新回覆');

        await tick();
        expect((await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).status).toBe(200);
        html = await portal(client, seeded);
        expect(html).not.toContain('有新回覆');
    });

    it('treats a real adjustment change as a new reply, not saving the same text again', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const client = await new Browser().asClient(seeded);
        const owner = await new Browser().asOwner(seeded);
        await tick();
        expect((await owner.post(`/p/${seeded.project.slug}/reports/${report.public_id}/adjustment`, { adjustment_note: '已改好按鈕顏色' })).status).toBe(302);
        const adjusted = await reload('reports', report);
        expect(adjusted.adjustment_updated_at).not.toBeNull();
        expect(adjusted.owner_last_read_at).not.toBeNull();
        expect(await portal(client, seeded)).toContain('有新回覆');

        await tick();
        await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`);
        expect(await portal(client, seeded)).not.toContain('有新回覆');

        await tick();
        await owner.post(`/p/${seeded.project.slug}/reports/${report.public_id}/adjustment`, { adjustment_note: '已改好按鈕顏色' });
        expect((await reload('reports', report)).adjustment_updated_at).toBe(adjusted.adjustment_updated_at);
        expect(await portal(client, seeded)).not.toContain('有新回覆');

        // Through the API (CLI / MCP) too.
        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        await tick();
        const response = await api('POST', `/projects/${seeded.project.slug}/reports/${report.public_id}/adjustment`, token, { note: '補充：也調整了字級', append: true });
        expect(response.status).toBe(200);
        expect((await reload('reports', report)).adjustment_updated_at).not.toBe(adjusted.adjustment_updated_at);
        expect(await portal(client, seeded)).toContain('有新回覆');
    });

    it('never shows team-side unread data to the client', async () => {
        const seeded = await seedProject();
        const client = await new Browser().asClient(seeded);
        const reports: Report[] = [];
        // Above 20 rows the rows travel as JSON in the page; check that payload as well.
        for (let i = 0; i < 22; i++) {
            reports.push((await seedReport(seeded.project, { title: `單 ${i}` })).report);
        }
        await clientPosts(client, seeded, reports[0], '老師的留言');
        const owner = await new Browser().asOwner(seeded);
        expect(await portal(owner, seeded)).toContain('"unreadMessages":1');

        for (const query of ['', '?unread=1', '?view=board', '?sort=latest_message_at']) {
            const html = await portal(client, seeded, query);
            expect(html).not.toMatch(/新留言 \d/);
            expect(html).not.toContain('未讀留言');
            expect(html).not.toContain('owner_last_read_at');
            expect(html).not.toContain('data-unread-messages');
            expect(html).not.toContain('data-unread-summary');
            expect(html).not.toContain('"unreadMessages":1');
            expect(html).not.toContain('"messagesCount":1');
            expect(html).toContain('單 21');
        }
        const page = await (await client.get(`/p/${seeded.project.slug}/reports/${reports[0].public_id}`)).text();
        expect(page).not.toMatch(/新留言 \d/);
        expect(page).not.toContain('data-unread-messages');
    });

    it('invites the client to write to the team on the report page and in the preview', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const owner = await new Browser().asOwner(seeded);
        await owner.post(`/p/${seeded.project.slug}/reports/${report.public_id}/adjustment`, { adjustment_note: '已調整' });
        const client = await new Browser().asClient(seeded);

        const clientPage = await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        expect(clientPage).toContain('留言給開發團隊');
        expect(clientPage).toContain('有問題或補充可以直接在這裡留言，我們會看到並回覆');
        expect(clientPage).toContain('看完有問題，可直接在下方留言');
        expect(clientPage).toMatch(/<textarea id="body"/);
        expect(clientPage).not.toMatch(/<details[^>]*>\s*<summary[^>]*>[^<]*留言/);

        const ownerPage = await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        expect(ownerPage).toContain('<h2 class="text-base font-semibold text-slate-950">留言</h2>');
        expect(ownerPage).not.toContain('留言給開發團隊');
        expect(ownerPage).not.toContain('我們會看到並回覆');
        expect(ownerPage).not.toContain('看完有問題，可直接在下方留言');

        const clientDialog = await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}/dialogs`)).text();
        expect(clientDialog).toContain('有問題或補充，可以點「查看留言紀錄」直接留言給開發團隊。');
        const ownerDialog = await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}/dialogs`)).text();
        expect(ownerDialog).not.toContain('直接留言給');
    });
});

describe('read state when reports are created', () => {
    it('starts client reports read for the client, team reports read for both sides', async () => {
        const seeded = await seedProject();
        const { developer } = await seedDeveloper();
        const { report: fromClient } = await seedReport(seeded.project, { creator: 'client' });
        const { report: fromTeam } = await seedReport(seeded.project, { creator: 'developer', developerId: developer.id });
        const { report: fromPublic } = await seedReport(seeded.project, { creator: 'public' });
        expect(fromClient.client_last_read_at).toBe(fromClient.created_at);
        expect(fromClient.owner_last_read_at).toBeNull();
        expect(fromPublic.client_last_read_at).toBe(fromPublic.created_at);
        expect(fromTeam.owner_last_read_at).toBe(fromTeam.created_at);
        expect(fromTeam.client_last_read_at).toBe(fromTeam.created_at);
        expect(fromClient.adjustment_updated_at).toBeNull();
    });
});

describe('API, CLI and MCP', () => {
    it('lists unread counts, filters with unread=1 and never marks reports read', async () => {
        const seeded = await seedProject();
        const { report: unread } = await seedReport(seeded.project, { title: '有未讀' });
        const { report: read } = await seedReport(seeded.project, { title: '已讀' });
        const base = Date.now();
        const at = new Date(base + 1000).toISOString();
        await insertMessage(unread, 'reporter', at);
        await insertMessage(unread, 'owner', new Date(base + 500).toISOString());
        await env.DB.prepare('UPDATE reports SET owner_last_read_at = ? WHERE id = ?').bind(new Date(base + 5000).toISOString(), read.id).run();
        await insertMessage(read, 'reporter', new Date(base + 2000).toISOString());
        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);

        type Listed = { unread_only: boolean; reports: Array<{ public_id: string; unread_messages_count: number; latest_message_at: string | null; messages_count: number }> };
        const all = (await (await api('GET', `/projects/${seeded.project.slug}/reports`, token)).json()) as Listed;
        const byId = new Map(all.reports.map((item) => [item.public_id, item]));
        expect(byId.get(unread.public_id)).toMatchObject({ unread_messages_count: 1, messages_count: 2, latest_message_at: at });
        expect(byId.get(read.public_id)?.unread_messages_count).toBe(0);

        const filtered = (await (await api('GET', `/projects/${seeded.project.slug}/reports?unread=1`, token)).json()) as Listed;
        expect(filtered.unread_only).toBe(true);
        expect(filtered.reports.map((item) => item.public_id)).toEqual([unread.public_id]);

        expect((await api('GET', `/projects/${seeded.project.slug}/reports/${unread.public_id}`, token)).status).toBe(200);
        expect((await reload('reports', unread)).owner_last_read_at).toBeNull();

        const result = await rpcResult<{ content: Array<{ text: string }> }>(
            await mcpCall(token, 'tools/call', { name: 'list_reports', arguments: { project: seeded.project.slug, unread: true } }),
        );
        const listed = JSON.parse(result.content[0].text) as Listed;
        expect(listed.reports.map((item) => item.public_id)).toEqual([unread.public_id]);
        expect(listed.reports[0].unread_messages_count).toBe(1);
        await rpcResult(await mcpCall(token, 'tools/call', { name: 'get_report', arguments: { project: seeded.project.slug, report: unread.public_id } }, 2));
        expect((await reload('reports', unread)).owner_last_read_at).toBeNull();
    });
});

describe('migration 0003 back-fill', () => {
    type Migration = { name: string; queries: string[] };

    async function runBackfill(): Promise<void> {
        const migrations = (env as unknown as { TEST_MIGRATIONS: Migration[] }).TEST_MIGRATIONS;
        const migration = migrations.find((item) => item.name.startsWith('0003'));
        expect(migration).toBeDefined();
        const updates = (migration as Migration).queries.filter((query) => /^\s*(--[^\n]*\n\s*)*UPDATE\b/i.test(query));
        expect(updates.length).toBe(2);
        for (const query of updates) {
            await env.DB.prepare(query).run();
        }
    }

    async function legacyReport(seeded: SeededProject, latestActivityAt: string): Promise<Report> {
        const { report } = await seedReport(seeded.project);
        await env.DB.prepare('UPDATE reports SET owner_last_read_at = NULL, client_last_read_at = NULL, adjustment_updated_at = NULL, latest_activity_at = ? WHERE id = ?')
            .bind(latestActivityAt, report.id)
            .run();
        return report;
    }

    it('leaves a trailing client message unread and everything else read', async () => {
        const seeded = await seedProject();
        const t = (minutes: number) => new Date(Date.parse('2026-10-01T00:00:00.000Z') + minutes * 60_000).toISOString();

        // Teacher wrote last, after the team's reply, and nothing happened since: unread.
        const lastWord = await legacyReport(seeded, t(10));
        await insertMessage(lastWord, 'reporter', t(1));
        await insertMessage(lastWord, 'owner', t(5));
        await insertMessage(lastWord, 'reporter', t(10));

        // Same, but the status changed afterwards: read.
        const statusLater = await legacyReport(seeded, t(20));
        await insertMessage(statusLater, 'owner', t(5));
        await insertMessage(statusLater, 'reporter', t(10));

        // The team wrote last: read.
        const teamLast = await legacyReport(seeded, t(10));
        await insertMessage(teamLast, 'reporter', t(5));
        await insertMessage(teamLast, 'owner', t(10));

        // Only client messages and no team action at all: everything unread.
        const noTeam = await legacyReport(seeded, t(10));
        await insertMessage(noTeam, 'reporter', t(3));
        await insertMessage(noTeam, 'reporter', t(10));

        // An adjustment image after the client message counts as the team's last action.
        const imageLater = await legacyReport(seeded, t(10));
        await insertMessage(imageLater, 'reporter', t(10));
        const imageId = await seedAttachment(imageLater, { kind: 'adjustment' });
        await env.DB.prepare('UPDATE attachments SET created_at = ? WHERE id = ?').bind(t(12), imageId).run();

        // No messages: read.
        const silent = await legacyReport(seeded, t(10));

        await runBackfill();

        const after = async (report: Report) => reload('reports', report);
        expect((await after(lastWord)).owner_last_read_at).toBe(t(5));
        expect((await after(noTeam)).owner_last_read_at).toBeNull();
        for (const report of [statusLater, teamLast, imageLater, silent]) {
            const row = await after(report);
            expect(row.owner_last_read_at).not.toBeNull();
            expect(Date.parse(row.owner_last_read_at as string)).toBeGreaterThan(Date.parse(t(20)));
        }
        for (const report of [lastWord, statusLater, teamLast, noTeam, imageLater, silent]) {
            const row = await after(report);
            expect(row.client_last_read_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
            expect(row.adjustment_updated_at).toBeNull();
        }

        const owner = await new Browser().asOwner(seeded);
        const html = await portal(owner, seeded);
        expect(html).toContain('新留言 1');
        expect(html).toContain('新留言 2');
        expect(html).toContain('有 2 張單有未讀留言');
    });
});
