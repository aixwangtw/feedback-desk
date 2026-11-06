import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Report } from '../../src/worker/lib/models';
import { api, Browser, seedDeveloper, seedProject, seedReport, seedToken, unique, type SeededProject } from './helpers';

/**
 * 清單與看板上明顯的「N 則未讀」標記，以及頁首通知鈴鐺：對應 Laravel 版 FeedbackUnreadIndicatorsTest。
 * 鈴鐺只列對方發的新留言：客戶看到團隊的新留言，團隊看到客戶的新留言；待審留言只在團隊端另列。
 */
const hourAgo = () => new Date(Date.now() - 3_600_000).toISOString();
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function report(seeded: SeededProject, title: string, creator: 'client' | 'developer' = 'client'): Promise<Report> {
    const { report: created } = await seedReport(seeded.project, { title, creator });
    await env.DB.prepare('UPDATE reports SET owner_last_read_at = ?, client_last_read_at = ? WHERE id = ?').bind(hourAgo(), hourAgo(), created.id).run();
    return created;
}

async function message(target: Report, author: 'reporter' | 'owner' | 'agent', at: string, body: string): Promise<void> {
    await env.DB.prepare('INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(target.id, author, null, body, at, at).run();
}

/** The header bell, which must be there exactly once. */
function bell(html: string): string {
    const matches = html.match(/<details[^>]*data-notification-bell[\s\S]*?<\/details>/g) ?? [];
    expect(matches, '頁首沒有通知鈴鐺').toHaveLength(1);
    return matches[0] ?? "";
}

describe('未讀標記與通知鈴鐺', () => {
    it('team list and board show the unread count as a small dot beside the title, and no extra "待回覆" status', async () => {
        const seeded = await seedProject();
        const waiting = await report(seeded, '客戶等回覆的單');
        await message(waiting, 'owner', minutesAgo(30), '我們先回一次');
        await env.DB.prepare('UPDATE reports SET owner_last_read_at = ? WHERE id = ?').bind(minutesAgo(25), waiting.id).run();
        await message(waiting, 'reporter', minutesAgo(20), '第一則');
        await message(waiting, 'reporter', minutesAgo(10), '第二則');
        await message(waiting, 'reporter', minutesAgo(5), '第三則');
        const answered = await report(seeded, '已回覆的單');
        await message(answered, 'reporter', minutesAgo(20), '問題');
        await message(answered, 'owner', minutesAgo(10), '已處理');
        await env.DB.prepare('UPDATE reports SET owner_last_read_at = ? WHERE id = ?').bind(new Date().toISOString(), answered.id).run();

        const owner = await new Browser().asOwner(seeded);
        for (const query of ['', '?view=board', '?sort=created_at']) {
            const html = await (await owner.get(`/p/${seeded.project.slug}${query}`)).text();
            // 標題右邊的小圓點數字（純指示）；已回覆的單只有空容器。
            expect(html).toContain(`data-unread-slot="${waiting.public_id}"><span class="grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold leading-none text-white" data-unread-dot="" title="3 則未讀留言"`);
            expect(html).not.toContain('data-unread-flag');
            // 不新增「待回覆」標示：狀態只有等工程師、等客戶、已完成。
            expect(html).not.toContain('待回覆');
            expect(html).toContain(`data-unread-slot="${answered.public_id}"></span>`);
        }
    });

    it('client list shows unread team replies with the same flag', async () => {
        const seeded = await seedProject();
        const mine = await report(seeded, '老師的單');
        await message(mine, 'reporter', minutesAgo(20), '老師問');
        await message(mine, 'owner', minutesAgo(10), '團隊回覆一');
        await message(mine, 'agent', minutesAgo(5), '團隊回覆二');

        const client = await new Browser().asClient(seeded);
        // The report waits on the team (status new), so it is under 「全部」, not the client's default tab.
        const html = await (await client.get(`/p/${seeded.project.slug}?tab=all`)).text();
        expect(html).toContain(`data-unread-slot="${mine.public_id}"><span class="grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold leading-none text-white" data-unread-dot="" title="2 則未讀留言"`);
        expect(html).not.toContain('data-unread-flag');
        expect(html).not.toContain('待回覆');
        // The team-only summary never shows on the client side.
        expect(html).not.toContain('有 <span data-unread-report-count');
    });

    it('team bell lists only client messages across projects, with drafts listed separately', async () => {
        const seeded = await seedProject({ name: '甲站' });
        const other = await seedProject({ name: '乙站' });
        const a = await report(seeded, '甲站的單');
        await message(a, 'reporter', minutesAgo(20), '老師較早的留言');
        await message(a, 'reporter', minutesAgo(10), '老師最新的留言');
        await message(a, 'owner', minutesAgo(5), '團隊自己的回覆不進團隊鈴鐺');
        const b = await report(other, '乙站的單');
        await message(b, 'reporter', minutesAgo(3), '乙站老師留言');
        const onlyTeam = await report(seeded, '只有團隊留言的單');
        await message(onlyTeam, 'owner', minutesAgo(2), '團隊留言');
        const at = new Date().toISOString();
        await env.DB.prepare("INSERT INTO message_drafts (report_id, author_name, body, created_at, updated_at) VALUES (?, '開發團隊', '草稿內容不外流', ?, ?)").bind(onlyTeam.id, at, at).run();

        const { developer, password } = await seedDeveloper(unique('dev'));
        const team = new Browser();
        expect((await team.post('/owner/login', { username: developer.username, password })).status).toBe(302);
        const html = await (await team.get(`/p/${seeded.project.slug}`)).text();
        const header = bell(html);

        // Other test files share the database; the global login sees every project, so only check this test's reports.
        expect(header).toContain('甲站的單');
        expect(header).toContain('老師最新的留言');
        expect(header).not.toContain('老師較早的留言');
        expect(header).not.toContain('團隊自己的回覆不進團隊鈴鐺');
        expect(header).toContain('乙站');
        expect(header).toContain('乙站老師留言');
        expect(header).toContain(`data-bell-item="${a.public_id}"`);
        expect(header).toContain(`data-bell-item="${b.public_id}"`);
        expect(header).not.toContain(`data-bell-item="${onlyTeam.public_id}"`);
        expect(header).toContain(`data-bell-draft="${onlyTeam.public_id}"`);
        expect(header).toContain('待審留言 1');
        expect(header).not.toContain('草稿內容不外流');
        expect(header).toContain(`href="/p/${seeded.project.slug}/reports/${a.public_id}#conversation"`);

        // A project-scoped team login counts only that project.
        const scoped = await new Browser().asOwner(other);
        const otherBell = bell(await (await scoped.get(`/p/${other.project.slug}`)).text());
        expect(otherBell).toContain('data-bell-count="1"');
        expect(otherBell).not.toContain('甲站的單');
    });

    it('client bell lists only team replies on reports she can see, and never drafts', async () => {
        const seeded = await seedProject();
        const mine = await report(seeded, '老師的單');
        await message(mine, 'owner', minutesAgo(20), '團隊較早的回覆');
        await message(mine, 'agent', minutesAgo(10), '團隊最新的回覆');
        await message(mine, 'reporter', minutesAgo(5), '老師自己的留言不進老師鈴鐺');
        const at = new Date().toISOString();
        await env.DB.prepare("INSERT INTO message_drafts (report_id, author_name, body, created_at, updated_at) VALUES (?, '開發團隊', '草稿內容不外流', ?, ?)").bind(mine.id, at, at).run();
        const teamOnly = await report(seeded, '團隊內部單', 'developer');
        await message(teamOnly, 'owner', minutesAgo(3), '內部留言');
        const quiet = await report(seeded, '老師自己留言的單');
        await message(quiet, 'reporter', minutesAgo(3), '只有老師留言');

        const client = await new Browser().asClient(seeded);
        const html = await (await client.get(`/p/${seeded.project.slug}`)).text();
        const header = bell(html);

        expect(header).toContain('data-bell-count="2"');
        expect(header).toContain('團隊最新的回覆');
        expect(header).not.toContain('團隊較早的回覆');
        expect(header).not.toContain('老師自己的留言不進老師鈴鐺');
        expect(header).not.toContain('團隊內部單');
        expect(header).not.toContain(`data-bell-item="${quiet.public_id}"`);
        expect(header).toContain('新留言');
        expect(html).not.toContain('未讀留言');
        expect(html).not.toContain('待審留言');
        expect(html).not.toContain('草稿內容不外流');
        expect(html).not.toContain('data-bell-draft');
    });

    it('opening the report from the bell marks it read', async () => {
        const seeded = await seedProject();
        const mine = await report(seeded, '老師的單');
        await message(mine, 'owner', minutesAgo(10), '團隊回覆');

        const client = await new Browser().asClient(seeded);
        expect(bell(await (await client.get(`/p/${seeded.project.slug}`)).text())).toContain('data-bell-count="1"');

        expect((await client.get(`/p/${seeded.project.slug}/reports/${mine.public_id}`)).status).toBe(200);

        const header = bell(await (await client.get(`/p/${seeded.project.slug}`)).text());
        expect(header).toContain('data-bell-count="0"');
        expect(header).toContain('目前沒有新留言');
    });

    it('a message written by the viewer never shows up in their own bell', async () => {
        const seeded = await seedProject();
        const target = await report(seeded, '自己留言');
        const { developer } = await seedDeveloper();
        expect((await api('POST', `/projects/${seeded.project.slug}/reports/${target.public_id}/messages`, await seedToken(developer), { body: '團隊寫的' })).status).toBe(200);
        const owner = await new Browser().asOwner(seeded);
        expect(bell(await (await owner.get(`/p/${seeded.project.slug}`)).text())).not.toContain(`data-bell-item="${target.public_id}"`);

        const client = await new Browser().asClient(seeded);
        expect((await client.post(`/p/${seeded.project.slug}/reports/${target.public_id}/messages`, { body: '老師寫的' })).status).toBe(302);
        const clientBell = bell(await (await client.get(`/p/${seeded.project.slug}`)).text());
        expect(clientBell).not.toContain('老師寫的');
    });
});
