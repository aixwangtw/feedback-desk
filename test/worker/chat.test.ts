import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
    badgeText,
    compareConversations,
    countUnreadReports,
    messagePreview,
    orderConversations,
    shortTime,
    unreadById,
    unreadSummary,
    withUnreadInLabel,
    withUnreadInTitle,
    type ConversationSortable,
} from '../../src/shared/conversation';
import type { Report } from '../../src/worker/lib/models';
import { Browser, reload, seedAttachment, seedDeveloper, seedProject, seedReport, type SeededProject } from './helpers';

const JSON_HEADERS = { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

interface ListItem {
    id: string;
    number: number;
    title: string;
    status: string;
    deleted: boolean;
    preview: string | null;
    preview_is_mine: boolean;
    latest_at: string | null;
    latest_label: string | null;
    created_at: string;
    unread: number;
    adjustment_updated: boolean;
    has_update: boolean;
    messages_count: number;
    thread_url: string;
    page_url: string;
}

interface ThreadData {
    id: string;
    number: number;
    title: string;
    status: string;
    deleted: boolean;
    page_url: string;
    post_url: string;
    upload_url: string;
    html: string;
}

async function insertMessage(report: Pick<Report, 'id'>, authorType: 'reporter' | 'owner' | 'agent', at: string, body = '留言', name: string | null = null): Promise<number> {
    const row = await env.DB.prepare('INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id')
        .bind(report.id, authorType, name, body, at, at)
        .first<{ id: number }>();
    await env.DB.prepare('UPDATE reports SET latest_activity_at = ?, updated_at = ? WHERE id = ?').bind(at, at, report.id).run();
    return row?.id ?? 0;
}

async function list(browser: Browser, seeded: SeededProject): Promise<{ items: ListItem[]; unread_total: number }> {
    const response = await browser.get(`/p/${seeded.project.slug}/conversations`, JSON_HEADERS);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
    return response.json();
}

async function thread(browser: Browser, seeded: SeededProject, report: Pick<Report, 'public_id'>): Promise<ThreadData> {
    const response = await browser.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS);
    expect(response.status).toBe(200);
    return response.json();
}

const at = (base: number, seconds: number) => new Date(base + seconds * 1000).toISOString();

describe('chat panel list', () => {
    it('puts unread first, then threads with messages, then reports without messages, with previews', async () => {
        const seeded = await seedProject();
        const base = Date.now() - 600_000;
        const { developer } = await seedDeveloper();
        const { report: emptyOld } = await seedReport(seeded.project, { title: '沒留言較舊', at: base });
        const { report: read } = await seedReport(seeded.project, { title: '已讀有留言', at: base + 1000 });
        const { report: unread } = await seedReport(seeded.project, { title: '有未讀', at: base + 2000 });
        const { report: emptyNew } = await seedReport(seeded.project, { title: '沒留言最新', at: base + 3000 });
        const { report: fromTeam } = await seedReport(seeded.project, { title: '開發者建的', creator: 'developer', developerId: developer.id, at: base + 4000 });
        await insertMessage(unread, 'reporter', at(base, 10), '很長的留言'.repeat(30));
        await insertMessage(unread, 'reporter', at(base, 20), '很長的留言'.repeat(30));
        await insertMessage(read, 'reporter', at(base, 30), '問一下');
        await insertMessage(read, 'owner', at(base, 40), '已修正\n\n  請再看看');
        await env.DB.prepare('UPDATE reports SET owner_last_read_at = ? WHERE id = ?').bind(at(base, 50), read.id).run();
        await env.DB.prepare('UPDATE reports SET client_deleted_at = ? WHERE id = ?').bind(at(base, 60), emptyOld.id).run();

        const owner = await new Browser().asOwner(seeded);
        const data = await list(owner, seeded);
        expect(data.items.map((item) => item.title)).toEqual(['有未讀', '已讀有留言', '開發者建的', '沒留言最新', '沒留言較舊']);
        const [first, second] = data.items;
        expect(first).toMatchObject({ id: unread.public_id, unread: 2, messages_count: 2, has_update: true, preview_is_mine: false, number: 3, status: '待處理', deleted: false });
        expect(first.preview).toBe(`${'很長的留言'.repeat(6)}...`);
        expect(first.thread_url).toBe(`/p/${seeded.project.slug}/conversations/${unread.public_id}`);
        expect(first.page_url).toBe(`/p/${seeded.project.slug}/reports/${unread.public_id}`);
        expect(first.latest_at).toBe(at(base, 20));
        expect(first.latest_label).toMatch(/^(\d{2}:\d{2}|\d{1,2}\/\d{1,2})$/);
        expect(second).toMatchObject({ preview: '已修正 請再看看', preview_is_mine: true, unread: 0, has_update: false });
        expect(data.items[3].preview).toBeNull();
        expect(data.items[3].latest_label).toBeNull();
        expect(data.items[3].created_at).toBe(emptyNew.created_at);
        expect(data.items[4].deleted).toBe(true);
        expect(data.unread_total).toBe(2);
        expect(fromTeam.id).toBeGreaterThan(0);
    });

    it('client list hides team-created and deleted reports and counts team replies and adjustment changes', async () => {
        const seeded = await seedProject();
        const base = Date.now() - 600_000;
        const { developer } = await seedDeveloper();
        const { report: replied } = await seedReport(seeded.project, { title: '開發者回了', at: base });
        const { report: adjusted } = await seedReport(seeded.project, { title: '調整重點有更新', at: base + 1000 });
        const { report: deleted } = await seedReport(seeded.project, { title: '已刪除的單', at: base + 2000 });
        await seedReport(seeded.project, { title: '開發者自己的單', creator: 'developer', developerId: developer.id, at: base + 3000 });
        await insertMessage(replied, 'owner', at(base, 10), '看過了');
        await insertMessage(replied, 'agent', at(base, 20), 'AI 回覆');
        await env.DB.prepare('UPDATE reports SET adjustment_updated_at = ? WHERE id = ?').bind(at(base, 30), adjusted.id).run();
        await env.DB.prepare('UPDATE reports SET client_deleted_at = ? WHERE id = ?').bind(at(base, 40), deleted.id).run();

        const client = await new Browser().asClient(seeded);
        const data = await list(client, seeded);
        expect(data.items.map((item) => item.title)).toEqual(['開發者回了', '調整重點有更新']);
        expect(data.items[0]).toMatchObject({ unread: 2, preview: 'AI 回覆', preview_is_mine: false, number: 3 });
        expect(data.items[1]).toMatchObject({ unread: 1, adjustment_updated: true, has_update: true, number: 2 });
        expect(data.unread_total).toBe(3);
        expect(JSON.stringify(data)).not.toContain('開發者自己的單');
    });

    it('does not mark anything read and answers 304 until something changes', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        await insertMessage(report, 'reporter', new Date().toISOString());
        const owner = await new Browser().asOwner(seeded);
        const first = await owner.get(`/p/${seeded.project.slug}/conversations`, JSON_HEADERS);
        const etag = first.headers.get('etag') as string;
        expect(etag).toMatch(/^W\//);
        expect(first.headers.get('cache-control')).toBe('private, no-cache');
        expect(((await first.json()) as { items: ListItem[] }).items[0].unread).toBe(1);
        expect((await owner.get(`/p/${seeded.project.slug}/conversations`, { ...JSON_HEADERS, 'if-none-match': etag })).status).toBe(304);
        expect((await reload('reports', report)).owner_last_read_at).toBeNull();

        await tick();
        await insertMessage(report, 'reporter', new Date().toISOString());
        const changed = await owner.get(`/p/${seeded.project.slug}/conversations`, { ...JSON_HEADERS, 'if-none-match': etag });
        expect(changed.status).toBe(200);
        expect(((await changed.json()) as { items: ListItem[] }).items[0].unread).toBe(2);
    });
});

describe('chat panel caching', () => {
    it('moves the project chat version on every change the list shows', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const owner = await new Browser().asOwner(seeded);
        const client = await new Browser().asClient(seeded);
        const slug = seeded.project.slug;
        let etag = (await owner.get(`/p/${slug}/conversations`, JSON_HEADERS)).headers.get('etag') as string;
        const changes: Array<[string, () => Promise<unknown>]> = [
            ['status', () => owner.post(`/p/${slug}/reports/${report.public_id}/status`, { status: 'needs_input' })],
            ['adjustment', () => owner.post(`/p/${slug}/reports/${report.public_id}/adjustment`, { adjustment_note: '改好了' })],
            ['client delete', () => client.post(`/p/${slug}/reports/${report.public_id}/client-delete`)],
            ['restore', () => owner.post(`/p/${slug}/reports/${report.public_id}/restore`)],
            ['new report', () => seedReport(seeded.project)],
            ['agent message', () => insertMessage(report, 'agent', new Date().toISOString())],
            ['delete', () => owner.post(`/p/${slug}/reports/${report.public_id}/delete`)],
        ];
        for (const [name, change] of changes) {
            await change();
            const response = await owner.get(`/p/${slug}/conversations`, { ...JSON_HEADERS, 'if-none-match': etag });
            expect(response.status, name).toBe(200);
            etag = response.headers.get('etag') as string;
            expect((await owner.get(`/p/${slug}/conversations`, { ...JSON_HEADERS, 'if-none-match': etag })).status, `${name} (unchanged)`).toBe(304);
        }
        // Reading only refreshes the reader's own list: the team opening a report leaves the client's tag alone.
        const { report: fresh } = await seedReport(seeded.project);
        const clientTag = (await client.get(`/p/${slug}/conversations`, JSON_HEADERS)).headers.get('etag') as string;
        etag = (await owner.get(`/p/${slug}/conversations`, JSON_HEADERS)).headers.get('etag') as string;
        await owner.get(`/p/${slug}/conversations/${fresh.public_id}`, JSON_HEADERS);
        expect((await client.get(`/p/${slug}/conversations`, { ...JSON_HEADERS, 'if-none-match': clientTag })).status).toBe(304);
        const ownerAfterRead = await owner.get(`/p/${slug}/conversations`, { ...JSON_HEADERS, 'if-none-match': etag });
        expect(ownerAfterRead.status).toBe(200);
        etag = ownerAfterRead.headers.get('etag') as string;
        await client.get(`/p/${slug}/conversations/${fresh.public_id}`, JSON_HEADERS);
        expect((await owner.get(`/p/${slug}/conversations`, { ...JSON_HEADERS, 'if-none-match': etag })).status).toBe(304);
        expect((await client.get(`/p/${slug}/conversations`, { ...JSON_HEADERS, 'if-none-match': clientTag })).status).toBe(200);

        // Another project's changes do not touch this one.
        const other = await seedProject();
        await seedReport(other.project);
        expect((await owner.get(`/p/${slug}/conversations`, { ...JSON_HEADERS, 'if-none-match': etag })).status).toBe(304);
    });

    it('lets relative times move on: the thread tag changes with the time bucket', async () => {
        const { relativeTimeBucket } = await import('../../src/worker/routes/web');
        const now = Date.parse('2026-10-19T06:00:30.000Z');
        expect(relativeTimeBucket('2026-10-19T05:59:00.000Z', now)).not.toBe(relativeTimeBucket('2026-10-19T05:59:00.000Z', now + 60_000));
        expect(relativeTimeBucket('2026-10-19T03:00:00.000Z', now)).toBe(relativeTimeBucket('2026-10-19T03:00:00.000Z', now + 60_000));
        expect(relativeTimeBucket('2026-10-19T03:00:00.000Z', now)).not.toBe(relativeTimeBucket('2026-10-19T03:00:00.000Z', now + 3_600_000));
        expect(relativeTimeBucket('2026-10-10T03:00:00.000Z', now)).toBe(relativeTimeBucket('2026-10-10T03:00:00.000Z', now + 3_600_000));
    });

    it('orders reports with the newest message in the same second by number', async () => {
        const seeded = await seedProject();
        const base = Date.parse('2026-10-01T00:00:00.000Z');
        const { report: older } = await seedReport(seeded.project, { title: '先建的', at: base });
        const { report: newer } = await seedReport(seeded.project, { title: '後建的', at: base + 1000 });
        // The older report's message is 400 ms later, but within the same second: the newer number wins.
        await insertMessage(newer, 'owner', '2026-10-02T00:00:00.100Z');
        await insertMessage(older, 'owner', '2026-10-02T00:00:00.500Z');
        const owner = await new Browser().asOwner(seeded);
        expect((await list(owner, seeded)).items.map((item) => item.title)).toEqual(['後建的', '先建的']);
        const html = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        expect(html.indexOf('>後建的</button>')).toBeLessThan(html.indexOf('>先建的</button>'));
    });
});

describe('chat panel conversation', () => {
    it('marks the report read for the viewing side only and answers 304 while unchanged', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project, { title: '要標已讀的單' });
        await insertMessage(report, 'reporter', new Date().toISOString());
        const before = await reload('reports', report);
        const owner = await new Browser().asOwner(seeded);
        await tick();
        const response = await owner.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS);
        expect(response.status).toBe(200);
        const data = (await response.json()) as ThreadData;
        expect(data).toMatchObject({
            id: report.public_id,
            title: '要標已讀的單',
            number: 1,
            post_url: `/p/${seeded.project.slug}/reports/${report.public_id}/messages`,
            page_url: `/p/${seeded.project.slug}/reports/${report.public_id}`,
            upload_url: `/p/${seeded.project.slug}/uploads?purpose=message&report=${report.public_id}`,
        });
        const after = await reload('reports', report);
        expect(after.owner_last_read_at).not.toBeNull();
        expect(after.client_last_read_at).toBe(before.client_last_read_at);
        expect(after.latest_activity_at).toBe(before.latest_activity_at);
        expect((await list(owner, seeded)).unread_total).toBe(0);

        const etag = response.headers.get('etag') as string;
        await env.DB.prepare('UPDATE reports SET owner_last_read_at = NULL WHERE id = ?').bind(report.id).run();
        expect((await owner.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, { ...JSON_HEADERS, 'if-none-match': etag })).status).toBe(304);
        // A 304 loads nothing and writes nothing.
        expect((await reload('reports', report)).owner_last_read_at).toBeNull();
    });

    it('places each side and shows the adjustment, opened and marked for the client when it changed', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const client = await new Browser().asClient(seeded);
        const owner = await new Browser().asOwner(seeded);
        expect((await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: '按鈕跑掉了' })).status).toBe(302);
        await tick();
        expect((await owner.post(`/p/${seeded.project.slug}/reports/${report.public_id}/adjustment`, { adjustment_note: '已調整按鈕位置' })).status).toBe(302);
        const messageId = await insertMessage(report, 'owner', new Date(Date.now() + 10).toISOString(), '附圖給你看');
        const attachmentId = await seedAttachment(report, { messageId, name: 'fixed.png' });

        let html = (await thread(owner, seeded, report)).html;
        expect(html).toMatch(/data-author="reporter" data-side="theirs"/);
        expect(html).toMatch(/data-author="owner" data-side="mine"/);
        expect(html).toContain('data-lightbox-trigger');
        expect(html).toContain(`/p/${seeded.project.slug}/reports/${report.public_id}/attachments/${attachmentId}`);
        expect(html).toContain('已調整按鈕位置');
        expect(html).not.toContain('有更新');

        const clientFirst = await client.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS);
        html = ((await clientFirst.json()) as ThreadData).html;
        expect(html).toMatch(/data-author="reporter" data-side="mine"/);
        expect(html).toMatch(/data-author="owner" data-side="theirs"/);
        expect(html).toContain('有更新');
        expect(html).toMatch(/<details[^>]*open[^>]*data-chat-adjustment/);
        // Opened once: no longer new, and the cached answer (with "有更新") is not reused.
        const again = await client.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, { ...JSON_HEADERS, 'if-none-match': clientFirst.headers.get('etag') as string });
        expect(again.status).toBe(200);
        expect(((await again.json()) as ThreadData).html).not.toContain('有更新');
    });

    it('takes replies as JSON, with images uploaded one PUT each', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const client = await new Browser().asClient(seeded);
        await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: '還是不行' });
        const { developer, password } = await seedDeveloper(undefined, undefined, '王小明');
        const owner = new Browser();
        await owner.loginAs(seeded.project.slug, developer.username, password);
        const uploadId = await owner.uploadId(seeded.project.slug, `purpose=message&report=${report.public_id}`, undefined, 'fixed.png');

        const response = await owner.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: '已處理，附圖給你看', 'upload_ids[]': [uploadId] }, JSON_HEADERS);
        expect(response.status).toBe(201);
        expect(await response.json()).toMatchObject({ message: '訊息已送出。' });
        const message = await env.DB.prepare('SELECT * FROM messages WHERE report_id = ? ORDER BY id DESC LIMIT 1').bind(report.id).first<{ id: number; author_type: string; author_name: string }>();
        expect(message).toMatchObject({ author_type: 'owner', author_name: '王小明' });
        const attachment = await env.DB.prepare('SELECT * FROM attachments WHERE message_id = ?').bind(message?.id).first<{ original_name: string }>();
        expect(attachment?.original_name).toBe('fixed.png');
        expect((await list(owner, seeded)).unread_total).toBe(0);
        expect((await thread(owner, seeded, report)).html).toContain('已處理，附圖給你看');

        const reply = await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: '收到，謝謝' }, JSON_HEADERS);
        expect(reply.status).toBe(201);
    });

    it('returns validation errors as JSON', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const owner = await new Browser().asOwner(seeded);
        const url = `/p/${seeded.project.slug}/reports/${report.public_id}/messages`;
        const empty = await owner.post(url, { body: '' }, JSON_HEADERS);
        expect(empty.status).toBe(422);
        expect(await empty.json()).toMatchObject({ message: '訊息內容 為必填。', errors: { body: ['訊息內容 為必填。'] } });
        const stale = await owner.post(url, { body: '附圖', 'upload_ids[]': ['not-mine'] }, JSON_HEADERS);
        expect(stale.status).toBe(422);
        expect(((await stale.json()) as { message: string }).message).toContain('截圖上傳已失效');
        expect((await env.DB.prepare('SELECT COUNT(*) AS total FROM messages WHERE report_id = ?').bind(report.id).first<{ total: number }>())?.total).toBe(0);
    });
});

describe('chat panel access', () => {
    it('refuses guests and single-report reporters', async () => {
        const seeded = await seedProject();
        const { report, token } = await seedReport(seeded.project);
        const guest = new Browser();
        expect((await guest.get(`/p/${seeded.project.slug}/conversations`, JSON_HEADERS)).status).toBe(403);
        expect((await guest.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS)).status).toBe(403);
        const redirect = await guest.get(`/p/${seeded.project.slug}/conversations`);
        expect(redirect.status).toBe(302);
        expect(redirect.headers.get('location')).toBe(`/p/${seeded.project.slug}/login`);

        const reporter = new Browser();
        expect((await reporter.get(`/p/${seeded.project.slug}/reports/${report.public_id}?access=${token}`)).status).toBe(302);
        const page = await reporter.get(`/p/${seeded.project.slug}/reports/${report.public_id}`);
        expect(page.status).toBe(200);
        expect(await page.text()).not.toContain('data-chat-root');
        expect((await reporter.get(`/p/${seeded.project.slug}/conversations`, JSON_HEADERS)).status).toBe(403);
        expect((await reporter.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS)).status).toBe(403);
    });

    it('keeps projects apart', async () => {
        const seeded = await seedProject();
        const other = await seedProject();
        const { report: otherReport } = await seedReport(other.project, { title: '別的專案的單' });
        const owner = await new Browser().asOwner(seeded);
        expect((await owner.get(`/p/${other.project.slug}/conversations`, JSON_HEADERS)).status).toBe(403);
        expect((await owner.get(`/p/${other.project.slug}/conversations/${otherReport.public_id}`, JSON_HEADERS)).status).toBe(403);
        expect((await owner.get(`/p/${seeded.project.slug}/conversations/${otherReport.public_id}`, JSON_HEADERS)).status).toBe(404);
        expect(JSON.stringify(await list(owner, seeded))).not.toContain('別的專案的單');
    });

    it('does not open team-created or deleted reports for the client', async () => {
        const seeded = await seedProject();
        const { developer } = await seedDeveloper();
        const { report: teamReport } = await seedReport(seeded.project, { creator: 'developer', developerId: developer.id });
        const { report: deleted } = await seedReport(seeded.project);
        await env.DB.prepare('UPDATE reports SET client_deleted_at = ? WHERE id = ?').bind(new Date().toISOString(), deleted.id).run();
        const client = await new Browser().asClient(seeded);
        expect((await client.get(`/p/${seeded.project.slug}/conversations/${teamReport.public_id}`, JSON_HEADERS)).status).toBe(404);
        expect((await client.get(`/p/${seeded.project.slug}/conversations/${deleted.public_id}`, JSON_HEADERS)).status).toBe(404);
        expect((await client.post(`/p/${seeded.project.slug}/reports/${teamReport.public_id}/messages`, { body: '試試看' }, JSON_HEADERS)).status).toBe(404);
        const owner = await new Browser().asOwner(seeded);
        expect((await thread(owner, seeded, deleted)).deleted).toBe(true);
    });

    it('escapes titles, names and messages', async () => {
        const seeded = await seedProject();
        const payload = '<script>alert("x")</script>';
        const { report } = await seedReport(seeded.project, { title: `${payload}標題` });
        await insertMessage(report, 'reporter', new Date().toISOString(), payload, '<b>名字</b>');
        const owner = await new Browser().asOwner(seeded);
        const listed = await list(owner, seeded);
        expect(listed.items[0].title).toBe(`${payload}標題`);
        const html = (await thread(owner, seeded, report)).html;
        expect(html).not.toContain('<script>alert');
        expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
        expect(html).not.toContain('<b>名字</b>');
        expect(html).toContain('&lt;b&gt;名字&lt;/b&gt;');
        const page = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        expect(page).not.toContain('<script>alert');
        expect(await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text()).not.toContain('<script>alert');
    });

    it('shows the panel and the chat buttons to signed-in members only', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const owner = new Browser();
        expect(await (await owner.get(`/p/${seeded.project.slug}/login`)).text()).not.toContain('data-chat-root');
        await owner.asOwner(seeded);
        await insertMessage(report, 'reporter', new Date().toISOString());
        const page = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        expect(page).toContain('data-chat-root');
        expect(page).toContain('data-viewer="owner"');
        expect(page).toContain(`data-list-url="/p/${seeded.project.slug}/conversations"`);
        expect(page).toContain(`data-chat-open="${report.public_id}"`);
        expect(await (await owner.get(`/p/${seeded.project.slug}?view=board`)).text()).toContain(`data-chat-open="${report.public_id}"`);
        const reportPage = await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        expect(reportPage).toContain('data-chat-root');
        expect(reportPage).toContain('在對話面板開啟');

        await insertMessage(report, 'owner', new Date(Date.now() + 1000).toISOString());
        const client = await new Browser().asClient(seeded);
        const clientPage = await (await client.get(`/p/${seeded.project.slug}`)).text();
        expect(clientPage).toContain('data-viewer="client"');
        expect(clientPage).toMatch(new RegExp(`data-chat-open="${report.public_id}"[^>]*aria-label="[^"]*共 2 則留言，1 則未讀`));
        expect(clientPage).toMatch(/data-unread-badge="" data-new-reply-badge="">1</);
    });

    it('shows the thread as chat bubbles on the report page', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const client = await new Browser().asClient(seeded);
        await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: '第一則老師留言' });
        await tick();
        await insertMessage(report, 'owner', new Date(Date.now() + 1000).toISOString(), '開發者回覆內容');
        const html = await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        const positions = ['第一則老師留言', '開發者回覆內容', 'id="body"'].map((text) => html.indexOf(text));
        expect(positions.every((position) => position > 0)).toBe(true);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        expect(html).toMatch(/data-author="reporter" data-side="mine"/);
        const owner = await new Browser().asOwner(seeded);
        expect(await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text()).toMatch(/data-author="owner" data-side="mine"/);
        // The polled fragment uses the same bubbles.
        expect(await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}/activity`)).text()).toMatch(/data-author="reporter" data-side="theirs"/);
    });
});

describe('portal default order', () => {
    it('lists and boards use the chat panel order; column sorts offer a way back', async () => {
        const seeded = await seedProject();
        const base = Date.now() - 600_000;
        const { report: emptyOld } = await seedReport(seeded.project, { title: '甲沒留言舊', at: base });
        const { report: readOld } = await seedReport(seeded.project, { title: '乙已讀', at: base + 1000 });
        const { report: unreadOld } = await seedReport(seeded.project, { title: '丙未讀', at: base + 2000 });
        const { report: emptyNew } = await seedReport(seeded.project, { title: '丁沒留言新', at: base + 3000 });
        await insertMessage(readOld, 'reporter', at(base, 100));
        await env.DB.prepare('UPDATE reports SET owner_last_read_at = ? WHERE id = ?').bind(at(base, 200), readOld.id).run();
        await insertMessage(unreadOld, 'reporter', at(base, 50));
        const owner = await new Browser().asOwner(seeded);
        const expected = ['丙未讀', '乙已讀', '丁沒留言新', '甲沒留言舊'];
        for (const query of ['', '?view=board']) {
            const html = await (await owner.get(`/p/${seeded.project.slug}${query}`)).text();
            const positions = expected.map((title) => html.indexOf(`>${title}</button>`));
            expect(positions.every((position) => position > 0)).toBe(true);
            expect([...positions].sort((a, b) => a - b)).toEqual(positions);
            expect(html).toContain('<option value="conversation" selected="">預設（新留言優先）</option>');
            expect(html).not.toContain('name="direction"');
            expect(html).not.toContain('data-sort-reset');
        }
        // The panel list agrees.
        expect((await list(owner, seeded)).items.map((item) => item.title)).toEqual(expected);

        const sorted = await (await owner.get(`/p/${seeded.project.slug}?sort=title&direction=asc`)).text();
        expect(sorted).toContain('name="direction"');
        expect(sorted).toMatch(/href="\/p\/[^"?]+\?view=list"[^>]*data-sort-reset[^>]*>恢復預設排序（新留言優先）/);
        expect(emptyOld.id + emptyNew.id).toBeGreaterThan(0);
    });

    it('groups by status: pending first for the team, needs-input first for the client', async () => {
        const seeded = await seedProject();
        const base = Date.now() - 600_000;
        await seedReport(seeded.project, { title: '甲待處理舊', at: base });
        const { report: oldNeedsInput } = await seedReport(seeded.project, { title: '乙待審核舊', at: base + 1000 });
        await env.DB.prepare('UPDATE reports SET status = ? WHERE id = ?').bind('needs_input', oldNeedsInput.id).run();
        await seedReport(seeded.project, { title: '丙待處理新', at: base + 2000 });
        const { report: newNeedsInput } = await seedReport(seeded.project, { title: '丁待審核新', at: base + 3000 });
        await env.DB.prepare('UPDATE reports SET status = ? WHERE id = ?').bind('needs_input', newNeedsInput.id).run();
        const { report: done } = await seedReport(seeded.project, { title: '戊已完成', at: base + 4000 });
        await env.DB.prepare('UPDATE reports SET status = ? WHERE id = ?').bind('completed', done.id).run();
        const titlesOf = async (browser: Browser, query = ''): Promise<string[]> => {
            const html = await (await browser.get(`/p/${seeded.project.slug}${query}`)).text();
            return ['甲待處理舊', '乙待審核舊', '丙待處理新', '丁待審核新', '戊已完成'].sort((a, b) => html.indexOf(`>${a}</button>`) - html.indexOf(`>${b}</button>`));
        };
        const owner = await new Browser().asOwner(seeded);
        expect(await titlesOf(owner)).toEqual(['丙待處理新', '甲待處理舊', '丁待審核新', '乙待審核舊', '戊已完成']);
        const client = await new Browser().asClient(seeded);
        expect(await titlesOf(client)).toEqual(['丁待審核新', '乙待審核舊', '丙待處理新', '甲待處理舊', '戊已完成']);
        // A manual sort ignores the status groups.
        expect(await titlesOf(owner, '?sort=created_at&direction=desc')).toEqual(['戊已完成', '丁待審核新', '丙待處理新', '乙待審核舊', '甲待處理舊']);
    });

    it('orders the client side by the client unread state', async () => {
        const seeded = await seedProject();
        const base = Date.now() - 600_000;
        const { report: replied } = await seedReport(seeded.project, { title: '甲有新回覆', at: base });
        const { report: adjusted } = await seedReport(seeded.project, { title: '乙調整更新', at: base + 1000 });
        await seedReport(seeded.project, { title: '丙沒留言', at: base + 2000 });
        await insertMessage(replied, 'owner', at(base, 10));
        await env.DB.prepare('UPDATE reports SET adjustment_updated_at = ? WHERE id = ?').bind(at(base, 20), adjusted.id).run();
        const client = await new Browser().asClient(seeded);
        const html = await (await client.get(`/p/${seeded.project.slug}`)).text();
        // Both unread: 乙 has no messages, so it sorts by its creation time, older than 甲's reply.
        const positions = ['甲有新回覆', '乙調整更新', '丙沒留言'].map((title) => html.indexOf(`>${title}</button>`));
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        expect((await list(client, seeded)).items.map((item) => item.title)).toEqual(['甲有新回覆', '乙調整更新', '丙沒留言']);
    });
});

describe('shared conversation rules', () => {
    const item = (id: string, overrides: Partial<ConversationSortable>): ConversationSortable => ({ id, number: 1, unread: 0, messages_count: 0, latest_at: null, created_at: '2026-10-01T00:00:00.000Z', ...overrides });

    it('sorts like the server and keeps the open conversation in place', () => {
        const items = [
            item('empty-new', { number: 1, created_at: '2026-10-05T00:00:00.000Z' }),
            item('read', { number: 2, messages_count: 1, latest_at: '2026-10-04T00:00:00.000Z' }),
            item('unread-old', { number: 3, unread: 1, messages_count: 1, latest_at: '2026-10-02T00:00:00.000Z' }),
            item('unread-new', { number: 4, unread: 2, messages_count: 2, latest_at: '2026-10-03T00:00:00.000Z' }),
            item('tie-a', { number: 6, messages_count: 1, latest_at: '2026-10-04T00:00:00.400Z' }),
        ];
        expect([...items].sort(compareConversations).map((entry) => entry.id)).toEqual(['unread-new', 'unread-old', 'read', 'tie-a', 'empty-new']);
        const previous = ['unread-new', 'unread-old', 'read', 'tie-a', 'empty-new'];
        const opened = items.map((entry) => (entry.id === 'unread-new' ? { ...entry, unread: 0 } : entry));
        expect(orderConversations(opened, { keepId: 'unread-new', previousIds: previous }).map((entry) => entry.id)[0]).toBe('unread-new');
        expect(orderConversations(opened).map((entry) => entry.id)[0]).toBe('unread-old');
    });

    it('formats badges, labels, previews and times', () => {
        expect(badgeText(5)).toBe('5');
        expect(badgeText(120)).toBe('99+');
        expect(countUnreadReports([{ unread: 1 }, { unread: 0 }, { unread: 3 }])).toBe(2);
        expect(unreadById([{ id: 'a', unread: 2 }, { id: 'b', unread: 1 }], 'a')).toEqual(new Map([['a', 0], ['b', 1]]));
        expect(unreadSummary(0)).toEqual({ count: 0, tone: 'calm', filter: null });
        expect(unreadSummary(2)).toEqual({ count: 2, tone: 'alert', filter: 'unread-only' });
        expect(unreadSummary(0, { unreadOnly: true }).filter).toBe('show-all');
        expect(withUnreadInLabel('開啟「a」的留言對話（共 3 則留言，2 則未讀）', 0)).toBe('開啟「a」的留言對話（共 3 則留言）');
        expect(withUnreadInLabel('開啟「a」的留言對話（共 3 則留言）', 4)).toBe('開啟「a」的留言對話（共 3 則留言，4 則未讀）');
        expect(withUnreadInTitle('留言 3 則，未讀 2', 0)).toBe('留言 3 則');
        expect(withUnreadInTitle('留言 3 則', 1)).toBe('留言 3 則，未讀 1');
        expect(messagePreview('  短短\n\n一句  ')).toBe('短短 一句');
        expect(messagePreview('a'.repeat(61))).toBe(`${'a'.repeat(60)}...`);
        expect(messagePreview('中'.repeat(30))).toBe('中'.repeat(30));
        expect(messagePreview(`${'中'.repeat(29)}ab`)).toBe(`${'中'.repeat(29)}ab`);
        expect(messagePreview(`${'中'.repeat(29)}abc`)).toBe(`${'中'.repeat(29)}ab...`);
        const now = Date.parse('2026-10-19T06:00:00.000Z');
        expect(shortTime('2026-10-19T01:05:00.000Z', now, 480)).toBe('09:05');
        expect(shortTime('2026-10-18T15:59:00.000Z', now, 480)).toBe('10/18');
        expect(shortTime('2026-10-18T16:00:00.000Z', now, 480)).toBe('00:00');
        expect(shortTime('2025-03-02T00:00:00.000Z', now, 480)).toBe('2025/3/2');
    });
});
