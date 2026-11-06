import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { ADJUSTMENT_DEPRECATED, defaultCompletionBody } from '../../src/shared/completion';
import { COMPLETED_BY_CLIENT_ONLY } from '../../src/shared/work-rule';
import { buildTimeline, latestCompletionRequestId } from '../../src/shared/timeline';
import type { Report } from '../../src/worker/lib/models';
import { api, Browser, mcpCall, PNG_BYTES, rpcResult, seedAttachment, seedDeveloper, seedProject, seedReport, seedToken, type SeededProject } from './helpers';

/**
 * Jira 式改版（對應 Laravel 版 FeedbackJiraRedesignTest）：權限行為。
 * 客戶拿不到草稿、「通過」只有客戶能按、團隊不能直接結案、調整重點網頁寫入回 410。
 */
const JSON_HEADERS = { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' };
const DRAFT_TEXT = '草稿內文：只有團隊能看見';

async function setup() {
    const seeded = await seedProject();
    const { report } = await seedReport(seeded.project, { title: '登入頁跑版' });
    const owner = await new Browser().asOwner(seeded);
    const client = await new Browser().asClient(seeded);
    return { seeded, report, owner, client };
}

const url = (seeded: SeededProject, report: Pick<Report, 'public_id'>, tail = '') => `/p/${seeded.project.slug}/reports/${report.public_id}${tail}`;
const thread = async (browser: Browser, seeded: SeededProject, report: Pick<Report, 'public_id'>) =>
    (await (await browser.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS)).json()) as Record<string, unknown> & { html: string; side_html: string; status_value: string };
const statusOf = async (report: Pick<Report, 'id'>) => (await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(report.id).first<{ status: string }>())?.status;

async function seedDraft(report: Report, withFile = true): Promise<number> {
    const key = `p/${report.project_id}/${crypto.randomUUID()}`;
    await env.FILES.put(key, PNG_BYTES, { httpMetadata: { contentType: 'image/png' } });
    const files = withFile ? JSON.stringify([{ object_key: key, original_name: '草稿圖.png', mime_type: 'image/png', size: PNG_BYTES.byteLength }]) : null;
    const now = new Date().toISOString();
    const row = await env.DB.prepare("INSERT INTO message_drafts (report_id, author_name, body, attachments, created_at, updated_at) VALUES (?, '開發團隊', ?, ?, ?, ?) RETURNING id")
        .bind(report.id, DRAFT_TEXT, files, now, now)
        .first<{ id: number }>();
    return row?.id ?? 0;
}

describe('客戶拿不到草稿（相簿也是）', () => {
    it('keeps drafts and their attachments out of every client response, and answers 403 for the draft file', async () => {
        const { seeded, report, owner, client } = await setup();
        const draftId = await seedDraft(report);
        const fileUrl = url(seeded, report, `/drafts/${draftId}/files/0`);

        // Team: draft in the album (marked as team-only, with its source) and the draft section.
        const team = await thread(owner, seeded, report);
        expect(team.html).toContain('data-album-kind="draft"');
        expect(team.html).toContain(fileUrl);
        expect(team.html).toContain('待審留言');
        expect(team.html).toContain('只有開發團隊看得到');
        expect(String(team.drafts_html)).toContain(DRAFT_TEXT);
        expect((await owner.get(fileUrl)).status).toBe(200);

        // Client: the JSON has no drafts field and neither the draft text nor any draft URL, the album has no draft item.
        const response = await client.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS);
        const raw = await response.text();
        const data = JSON.parse(raw) as Record<string, unknown>;
        expect(data).not.toHaveProperty('drafts_html');
        for (const hidden of [DRAFT_TEXT, '/drafts/', 'data-album-kind="draft"', '草稿圖.png', '待審留言', 'data-message-draft']) {
            expect(raw, hidden).not.toContain(hidden);
        }
        // The same for the report page, the polled thread fragment, the dialogs and the list.
        const pages = [
            await (await client.get(url(seeded, report))).text(),
            await (await client.get(url(seeded, report, '/activity'), { 'if-none-match': 'W/"stale"' })).text(),
            await (await client.get(url(seeded, report, '/dialogs'))).text(),
            await (await client.get(`/p/${seeded.project.slug}?tab=all`)).text(),
        ];
        for (const html of pages) {
            for (const hidden of [DRAFT_TEXT, '/drafts/', 'data-album-kind="draft"', '草稿圖.png', 'data-message-draft']) {
                expect(html, hidden).not.toContain(hidden);
            }
        }
        // The draft file URL answers 403 to the client (and nothing to a visitor without access).
        expect((await client.get(fileUrl)).status).toBe(403);
        expect((await new Browser().get(fileUrl)).status).not.toBe(200);
    });
});

describe('相簿', () => {
    it('lists the original attachments first, then message attachments by message time; collapsed with a count; originals are lazy and not thumbnailed', async () => {
        const { seeded, report, owner, client } = await setup();
        const original = await seedAttachment(report, { name: '開單圖.png' });
        const later = new Date(Date.now() + 2000).toISOString();
        const earlier = new Date(Date.now() + 1000).toISOString();
        const insert = async (author: 'reporter' | 'owner', at: string, body: string) =>
            (await env.DB.prepare('INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?) RETURNING id').bind(report.id, author, body, at, at).first<{ id: number }>())!.id;
        const m2 = await insert('owner', later, '後面的留言');
        const m1 = await insert('reporter', earlier, '前面的留言');
        const second = await seedAttachment(report, { messageId: m2, name: '後面.png' });
        const first = await seedAttachment(report, { messageId: m1, name: '前面.png' });
        // An adjustment image is not an album item.
        await seedAttachment(report, { kind: 'adjustment', name: '舊調整圖.png' });

        for (const browser of [owner, client]) {
            const html = (await thread(browser, seeded, report)).html;
            const album = html.slice(html.indexOf('data-chat-album'), html.indexOf('</details>', html.indexOf('data-chat-album')));
            expect(album).toContain('data-album-count="true">3<');
            expect(album).not.toMatch(/<details[^>]*\sopen/);
            const base = `/p/${seeded.project.slug}/reports/${report.public_id}/attachments`;
            const order = [original, first, second].map((id) => album.indexOf(`${base}/${id}"`));
            expect(order.every((position) => position > 0)).toBe(true);
            expect([...order].sort((a, b) => a - b)).toEqual(order);
            expect(album).not.toContain('舊調整圖');
            // Source and time are shown, thumbnails are the original file loaded lazily (no generated thumbnail URL).
            expect(album.match(/data-album-source[^>]*>([^<]*)</g)?.map((tag) => tag.replace(/.*>([^<]*)<$/, '$1'))).toEqual(['原始附件', '客戶 的留言', '開發團隊 的留言']);
            expect(album).toContain('loading="lazy"');
            expect(album).toContain('data-lightbox-play');
            expect(album).not.toMatch(/thumb|resize/i);
        }
    });

    it('is absent without any attachment and keeps its open state keys for the refresh', async () => {
        const { seeded, report, owner } = await setup();
        expect((await thread(owner, seeded, report)).html).not.toContain('data-chat-album');
        await seedAttachment(report);
        expect((await thread(owner, seeded, report)).html).toContain('data-keep-open="album"');
    });
});

describe('活動時間軸（留言與狀態變更）', () => {
    it('shows status changes between the messages: who changed it for the team, only the new status for the client', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const { developer, password } = await seedDeveloper(undefined, undefined, '王小明');
        const team = new Browser();
        await team.loginAs(seeded.project.slug, developer.username, password);
        const client = await new Browser().asClient(seeded);
        expect((await client.post(url(seeded, report, '/messages'), { body: '客戶先問' }, JSON_HEADERS)).status).toBe(201);
        await new Promise((resolve) => setTimeout(resolve, 1100));
        // The team replies: new → needs_input, recorded as a status event by 王小明.
        expect((await team.post(url(seeded, report, '/messages'), { body: '團隊回覆' }, JSON_HEADERS)).status).toBe(201);

        const teamHtml = (await thread(team, seeded, report)).html;
        const clientHtml = (await thread(client, seeded, report)).html;
        expect(teamHtml).toContain('data-chat-event="status"');
        expect(teamHtml).toContain('王小明 將狀態改為「<span class="font-semibold text-slate-800">等客戶</span>」');
        expect(clientHtml).toContain('將狀態改為「<span class="font-semibold text-slate-800">等客戶</span>」');
        expect(clientHtml).not.toContain('王小明 將狀態改為');
        // The event sits right after the message that caused it, centred; messages keep their side bubbles.
        for (const html of [teamHtml, clientHtml]) {
            expect(html.indexOf('團隊回覆')).toBeLessThan(html.indexOf('data-chat-event="status"'));
            expect(html.indexOf('客戶先問')).toBeLessThan(html.indexOf('團隊回覆'));
            expect(html).toContain('<li class="flex justify-center" data-chat-event="status"');
        }
        expect(teamHtml).toMatch(/data-author="owner" data-side="mine"/);
        expect(clientHtml).toMatch(/data-author="owner" data-side="theirs"/);
    });

    it('sorts by time with the message first inside the same second (pure function)', () => {
        const entries = buildTimeline(
            [{ id: 2, created_at: '2026-11-07T01:00:05.900Z' }, { id: 1, created_at: '2026-11-07T01:00:00.000Z' }],
            [{ id: 9, detail: 'new>needs_input', actor_name: 'x', agent: null, created_at: '2026-11-07T01:00:05.100Z' }, { id: 10, detail: 'bad', actor_name: 'x', agent: null, created_at: '2026-11-07T01:00:01.000Z' }],
        );
        expect(entries.map((entry) => (entry.type === 'message' ? `m${entry.message.id}` : `s${entry.id}`))).toEqual(['m1', 'm2', 's9']);
        expect(latestCompletionRequestId([{ id: 1, is_completion_request: 1 }, { id: 4, is_completion_request: 0 }, { id: 3, is_completion_request: 1 }])).toBe(3);
        expect(latestCompletionRequestId([{ id: 1 }])).toBeNull();
    });
});

describe('請客戶確認完成 與「通過」', () => {
    it('the team sends a confirmation message: status stays 等客戶, the default text names the site label, completed reports are refused', async () => {
        const { seeded, report, owner } = await setup();
        const response = await owner.post(url(seeded, report, '/request-completion'), {}, JSON_HEADERS);
        expect(response.status).toBe(201);
        const data = (await response.json()) as { status: string; message: string; message_id: number };
        expect(data.status).toBe('needs_input');
        expect(data.message).toContain('要等客戶按「通過」才會變成已完成');
        const row = await env.DB.prepare('SELECT body, author_type, is_completion_request FROM messages WHERE id = ?').bind(data.message_id).first<{ body: string; author_type: string; is_completion_request: number }>();
        expect(row).toEqual({ body: defaultCompletionBody('客戶'), author_type: 'owner', is_completion_request: 1 });
        expect(await statusOf(report)).toBe('needs_input');
        // A custom text (edited in the dialog) is used as typed.
        expect((await owner.post(url(seeded, report, '/request-completion'), { body: '改過字的確認：請看登入頁' }, JSON_HEADERS)).status).toBe(201);
        expect((await env.DB.prepare('SELECT body FROM messages WHERE report_id = ? ORDER BY id DESC LIMIT 1').bind(report.id).first<{ body: string }>())?.body).toBe('改過字的確認：請看登入頁');
        // Too long and already completed are refused with a code.
        const long = await owner.post(url(seeded, report, '/request-completion'), { body: 'x'.repeat(10_001) }, JSON_HEADERS);
        expect(long.status).toBe(422);
        expect(await long.json()).toMatchObject({ error: 'body_too_long' });
        await env.DB.prepare("UPDATE reports SET status = 'completed' WHERE id = ?").bind(report.id).run();
        const done = await owner.post(url(seeded, report, '/request-completion'), {}, JSON_HEADERS);
        expect(done.status).toBe(422);
        expect(await done.json()).toMatchObject({ error: 'already_completed' });
    });

    it('only the client can press 通過, only on the latest confirmation message and only while the report is not completed', async () => {
        const { seeded, report, owner, client } = await setup();
        await owner.post(url(seeded, report, '/request-completion'), { body: '第一次確認' }, JSON_HEADERS);
        await new Promise((resolve) => setTimeout(resolve, 5));
        await owner.post(url(seeded, report, '/request-completion'), { body: '第二次確認' }, JSON_HEADERS);

        const clientThread = (await thread(client, seeded, report)).html;
        expect(clientThread.match(/data-completion-approve="/g)).toHaveLength(1);
        expect(clientThread.indexOf('data-completion-approve-form')).toBeGreaterThan(clientThread.indexOf('第二次確認'));
        expect(clientThread).toContain('data-completion-request-badge');
        expect(clientThread).toMatch(/data-completion-approve="[^"]+">通過</);
        // The same on the page and the polled fragment; the team side never gets the button, in any of the places.
        expect((await (await client.get(url(seeded, report))).text()).match(/data-completion-approve="/g)).toHaveLength(1);
        expect(await (await client.get(url(seeded, report, '/activity'), { 'if-none-match': 'W/"stale"' })).text()).toContain('data-completion-approve="');
        const teamPlaces = [(await thread(owner, seeded, report)).html, await (await owner.get(url(seeded, report))).text(), await (await owner.get(url(seeded, report, '/activity'), { 'if-none-match': 'W/"stale"' })).text()];
        for (const html of teamPlaces) {
            expect(html).not.toContain('data-completion-approve');
            expect(html).toContain('第二次確認');
        }
        // The team's own 完成 button only opens the confirmation dialog; there is no status form for the team.
        const teamSide = (await thread(owner, seeded, report)).side_html;
        expect(teamSide).toContain(`data-dialog-open="request-completion-${report.public_id}"`);
        expect(teamSide).not.toContain('data-complete-report');
        expect((await thread(client, seeded, report)).side_html).toContain('data-complete-report');

        // Pressing 通過 goes through the client-only status endpoint and completes the report.
        const approved = await client.post(url(seeded, report, '/status'), { status: 'completed' }, JSON_HEADERS);
        expect(approved.status).toBe(200);
        expect(await statusOf(report)).toBe('completed');
        const after = await thread(client, seeded, report);
        expect(after.html).not.toContain('data-completion-approve');
        expect(after.side_html).not.toContain('data-complete-report');
        expect(after.status_value).toBe('completed');
    });

    it('the client cannot send a confirmation request', async () => {
        const { seeded, report, client } = await setup();
        const refused = await client.post(url(seeded, report, '/request-completion'), {}, JSON_HEADERS);
        expect(refused.status).toBe(403);
        expect(await refused.json()).toMatchObject({ error: 'team_only' });
        expect((await new Browser().post(url(seeded, report, '/request-completion'), {}, JSON_HEADERS)).status).toBe(403);
        expect(await env.DB.prepare('SELECT COUNT(*) AS total FROM messages WHERE report_id = ?').bind(report.id).first()).toEqual({ total: 0 });
    });
});

describe('團隊不能直接結案', () => {
    it('refuses completed from the team on the web, the API, the patrol API and MCP, while request-completion is open to all of them', async () => {
        const { seeded, report, owner } = await setup();
        const slug = seeded.project.slug;
        // Web: the team gets 403 for every status value (JSON or form).
        for (const accept of [{ accept: 'application/json' }, {} as Record<string, string>]) {
            expect((await owner.post(url(seeded, report, '/status'), { status: 'completed' }, accept)).status).toBe(403);
        }
        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        // API (CLI): completed_by_client_only, with the new pointer to request-completion.
        const refused = await api('POST', `/projects/${slug}/reports/${report.public_id}/status`, token, { status: 'completed' });
        expect(refused.status).toBe(422);
        expect(await refused.json()).toMatchObject({ error: 'completed_by_client_only', message: COMPLETED_BY_CLIENT_ONLY });
        expect(COMPLETED_BY_CLIENT_ONLY).toContain('request_completion');
        // MCP: the same refusal.
        const mcp = await rpcResult<{ isError?: boolean; content: Array<{ text: string }> }>(await mcpCall(token, 'tools/call', { name: 'set_status', arguments: { project: slug, report: report.public_id, status: 'completed' } }));
        expect(mcp.isError).toBe(true);
        expect(mcp.content[0].text).toContain('completed_by_client_only');
        expect(await statusOf(report)).toBe('new');

        // API: sends the confirmation message, the status follows the message rule (new → needs_input), nothing is completed.
        const sent = await api('POST', `/projects/${slug}/reports/${report.public_id}/request-completion`, token, { body: '用 CLI 請你確認' });
        expect(sent.status).toBe(201);
        expect(await sent.json()).toMatchObject({ status: 'needs_input', status_label: '等客戶', title: '登入頁跑版' });
        expect(await statusOf(report)).toBe('needs_input');
        // Without text: the default; numbers are refused (public_id only); a completed report is refused.
        const defaulted = await api('POST', `/projects/${slug}/reports/${report.public_id}/request-completion`, token, {});
        expect(defaulted.status).toBe(201);
        expect((await env.DB.prepare('SELECT body FROM messages WHERE report_id = ? ORDER BY id DESC LIMIT 1').bind(report.id).first<{ body: string }>())?.body).toBe(defaultCompletionBody('客戶'));
        expect((await api('POST', `/projects/${slug}/reports/1/request-completion`, token, {})).status).toBe(422);

        // MCP tool.
        const tool = await rpcResult<{ isError?: boolean; content: Array<{ text: string }> }>(await mcpCall(token, 'tools/call', { name: 'request_completion', arguments: { project: slug, report: report.public_id, body: 'MCP 請確認' } }));
        expect(tool.isError).toBeFalsy();
        expect(JSON.parse(tool.content[0].text)).toMatchObject({ status: 'needs_input' });
        expect(await statusOf(report)).toBe('needs_input');
        const listed = await rpcResult<{ tools: Array<{ name: string; description: string }> }>(await mcpCall(token, 'tools/list'));
        expect(listed.tools.find((entry) => entry.name === 'request_completion')?.description).toContain('不可以直接改成已完成');

        // A client token cannot use it.
        const clientRefused = await api('POST', `/projects/${slug}/reports/${report.public_id}/request-completion`, 'fdk_nope', {});
        expect(clientRefused.status).toBe(401);
        await env.DB.prepare("UPDATE reports SET status = 'completed' WHERE id = ?").bind(report.id).run();
        const done = await api('POST', `/projects/${slug}/reports/${report.public_id}/request-completion`, token, {});
        expect(done.status).toBe(422);
        expect(await done.json()).toMatchObject({ error: 'already_completed' });
    });
});

describe('調整重點停用', () => {
    it('answers 410 on the web after the permission check; the API and MCP still write but warn that it is deprecated', async () => {
        const { seeded, report, owner, client } = await setup();
        const slug = seeded.project.slug;
        expect((await client.post(url(seeded, report, '/adjustment'), { adjustment_note: 'x' })).status).toBe(403);
        const gone = await owner.post(url(seeded, report, '/adjustment'), { adjustment_note: '網頁寫入' }, JSON_HEADERS);
        expect(gone.status).toBe(410);
        expect(await gone.json()).toMatchObject({ error: 'adjustment_disabled' });
        expect((await env.DB.prepare('SELECT adjustment_note FROM reports WHERE id = ?').bind(report.id).first<{ adjustment_note: string | null }>())?.adjustment_note).toBeNull();

        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        const written = await api('POST', `/projects/${slug}/reports/${report.public_id}/adjustment`, token, { note: 'API 寫入' });
        expect(written.status).toBe(200);
        expect(await written.json()).toMatchObject({ note: 'replaced', warning: ADJUSTMENT_DEPRECATED });
        const viaMcp = await rpcResult<{ content: Array<{ text: string }> }>(await mcpCall(token, 'tools/call', { name: 'write_adjustment', arguments: { project: slug, report: report.public_id, note: 'MCP 寫入' } }));
        expect(JSON.parse(viaMcp.content[0].text)).toMatchObject({ warning: ADJUSTMENT_DEPRECATED });
        const tools = await rpcResult<{ tools: Array<{ name: string; description: string }> }>(await mcpCall(token, 'tools/list'));
        expect(tools.tools.find((entry) => entry.name === 'write_adjustment')?.description).toContain('已停用');
        // Old content shows read-only as 過去的處理說明, collapsed, only when there is some.
        const html = (await thread(client, seeded, report)).html;
        expect(html).toContain('過去的處理說明');
        expect(html).toContain('MCP 寫入');
        const dialogs = await (await client.get(url(seeded, report, '/dialogs'))).text();
        expect(dialogs).toContain('過去的處理說明');
        expect(dialogs).not.toContain('編輯調整重點');
    });

    it('a status change caused by a team message no longer mentions the adjustment', async () => {
        const { seeded, report, owner } = await setup();
        const response = await owner.post(url(seeded, report, '/messages'), { body: '收到' }, JSON_HEADERS);
        const data = (await response.json()) as { message: string };
        expect(data.message).toBe('訊息已送出。狀態已改為「等客戶」。');
        expect(data.message).not.toContain('調整重點');
    });
});

describe('詳情視窗右側窄欄', () => {
    it('is delivered with the conversation (status, complete button, creator, times) so it follows status changes', async () => {
        const { seeded, report, owner, client } = await setup();
        const first = await thread(client, seeded, report);
        expect(first.status_value).toBe('new');
        expect(first.side_html).toContain('data-detail-side');
        expect(first.side_html).toContain('data-report-creator');
        expect(first.side_html).toContain('建立時間');
        expect(first.side_html).toContain('最後更新');
        await owner.post(url(seeded, report, '/messages'), { body: '收到' }, JSON_HEADERS);
        const second = await thread(client, seeded, report);
        expect(second.status_value).toBe('needs_input');
        expect(second.side_html).toContain('等客戶');
        // The detail dialog is the slide-over layout with the side column after the title.
        const dialogs = await (await owner.get(url(seeded, report, '/dialogs'))).text();
        expect(dialogs).toContain('detail-panel');
        expect(dialogs.indexOf('data-detail-side-box')).toBeGreaterThan(dialogs.indexOf('detail-report-title-'));
        expect(dialogs.indexOf('data-detail-side-box')).toBeLessThan(dialogs.indexOf('data-report-description'));
        expect(dialogs).toContain('grid-cols-[minmax(0,1fr)]');
        expect(dialogs).toContain('overflow-x-hidden');
        expect(dialogs).toContain(`id="request-completion-${report.public_id}"`);
        expect(await (await seedClientDialogs(client, seeded, report))).not.toContain('request-completion-');
    });
});

async function seedClientDialogs(client: Browser, seeded: SeededProject, report: Report): Promise<string> {
    return (await client.get(url(seeded, report, '/dialogs'))).text();
}
