import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { issuePatrolToken } from '../../src/worker/lib/patrol';
import type { Report } from '../../src/worker/lib/models';
import { api, Browser, BASE, mcpCall, PNG_BYTES, rpcResult, seedAttachment, seedDeveloper, seedProject, seedReport, seedToken, unique, workerEnv, type SeededProject } from './helpers';

/**
 * 編輯、收回自己發的留言（對應 Laravel 版 FeedbackMessageManagementTest）：
 * 只能動自己的、不留痕跡（沒有「已編輯」、收回後整則消失）、不改單的狀態；收回後老師端的 HTML、JSON、相簿、附件網址都拿不到該則內容。
 */
const JSON_HEADERS = { accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' };

async function insertMessage(report: Report, authorType: 'reporter' | 'owner', body: string, at: string, extra: { completion?: boolean; accountId?: number } = {}): Promise<number> {
    const row = await env.DB.prepare(
        'INSERT INTO messages (report_id, author_type, author_name, author_client_account_id, body, is_completion_request, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    )
        .bind(report.id, authorType, authorType === 'owner' ? '王工程師' : '老師', extra.accountId ?? null, body, extra.completion ? 1 : 0, at, at)
        .first<{ id: number }>();
    return row!.id;
}

async function setup() {
    const seeded = await seedProject();
    const { report } = await seedReport(seeded.project, { title: '登入頁跑版' });
    await env.DB.prepare("UPDATE reports SET status = 'needs_input' WHERE id = ?").bind(report.id).run();
    const owner = await new Browser().asOwner(seeded);
    const client = await new Browser().asClient(seeded);
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const halfHourAgo = new Date(Date.now() - 1800_000).toISOString();
    const teamMessage = await insertMessage(report, 'owner', '團隊原文ALPHA', hourAgo);
    const teacherMessage = await insertMessage(report, 'reporter', '老師原文BETA', halfHourAgo);
    return { seeded, report, owner, client, teamMessage, teacherMessage };
}

const messageUrl = (seeded: SeededProject, report: Pick<Report, 'public_id'>, id: number, action: 'update' | 'withdraw') => `/p/${seeded.project.slug}/reports/${report.public_id}/messages/${id}/${action}`;
const conversation = async (browser: Browser, seeded: SeededProject, report: Pick<Report, 'public_id'>) =>
    (await (await browser.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS)).json()) as { html: string; album_html: string; album_count: number };
const bodyOf = async (id: number) => (await env.DB.prepare('SELECT body FROM messages WHERE id = ?').bind(id).first<{ body: string }>())?.body;
const deletedAt = async (id: number) => (await env.DB.prepare('SELECT deleted_at FROM messages WHERE id = ?').bind(id).first<{ deleted_at: string | null }>())?.deleted_at;
const statusOf = async (report: Pick<Report, 'id'>) => (await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(report.id).first<{ status: string }>())?.status;

describe('編輯、收回自己的留言', () => {
    it('the team edits its own message without any edited mark and without changing the status', async () => {
        const { seeded, report, owner, teamMessage } = await setup();
        const response = await owner.post(messageUrl(seeded, report, teamMessage, 'update'), { body: '  團隊新文字GAMMA  ' }, JSON_HEADERS);
        expect(response.status).toBe(200);
        expect(await bodyOf(teamMessage)).toBe('團隊新文字GAMMA');
        expect(await statusOf(report)).toBe('needs_input');
        for (const html of [(await conversation(owner, seeded, report)).html, await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text()]) {
            expect(html).toContain('團隊新文字GAMMA');
            expect(html).not.toContain('已編輯');
            expect(html).not.toContain('編輯過');
        }
    });

    it('shows the menu and edit form only on messages the viewer may manage', async () => {
        const { seeded, report, owner, client, teamMessage, teacherMessage } = await setup();
        const ownerHtml = (await conversation(owner, seeded, report)).html;
        expect(ownerHtml.match(/data-message-menu/g)).toHaveLength(1);
        expect(ownerHtml).toContain(messageUrl(seeded, report, teamMessage, 'withdraw'));
        expect(ownerHtml).not.toContain(messageUrl(seeded, report, teacherMessage, 'withdraw'));
        const clientHtml = (await conversation(client, seeded, report)).html;
        expect(clientHtml.match(/data-message-menu/g)).toHaveLength(1);
        expect(clientHtml).toContain(messageUrl(seeded, report, teacherMessage, 'withdraw'));
        expect(clientHtml).not.toContain(messageUrl(seeded, report, teamMessage, 'withdraw'));
    });

    it('neither side can edit or withdraw the other side\'s messages', async () => {
        const { seeded, report, owner, client, teamMessage, teacherMessage } = await setup();
        expect((await client.post(messageUrl(seeded, report, teamMessage, 'update'), { body: '偷改' }, JSON_HEADERS)).status).toBe(404);
        expect((await client.post(messageUrl(seeded, report, teamMessage, 'withdraw'), {}, JSON_HEADERS)).status).toBe(404);
        expect((await owner.post(messageUrl(seeded, report, teacherMessage, 'update'), { body: '偷改' }, JSON_HEADERS)).status).toBe(404);
        expect((await owner.post(messageUrl(seeded, report, teacherMessage, 'withdraw'), {}, JSON_HEADERS)).status).toBe(404);
        expect(await bodyOf(teamMessage)).toBe('團隊原文ALPHA');
        expect(await bodyOf(teacherMessage)).toBe('老師原文BETA');
        expect(await deletedAt(teamMessage)).toBeNull();
        expect(await deletedAt(teacherMessage)).toBeNull();
    });

    it('a teacher account cannot touch another teacher account\'s message', async () => {
        const { canManageMessage } = await import('../../src/shared/message-manage');
        const mine = { author_type: 'reporter' as const, author_client_account_id: 7 };
        expect(canManageMessage(mine, { isOwner: false, clientAccountId: 7 })).toBe(true);
        expect(canManageMessage(mine, { isOwner: false, clientAccountId: 8 })).toBe(false);
        expect(canManageMessage(mine, { isOwner: false, clientAccountId: null })).toBe(false);
        expect(canManageMessage(mine, { isOwner: true, clientAccountId: 7 })).toBe(false);
        expect(canManageMessage({ author_type: 'owner', author_client_account_id: null }, { isOwner: true, clientAccountId: null })).toBe(true);
        expect(canManageMessage({ author_type: 'agent', author_client_account_id: null }, { isOwner: false, clientAccountId: null })).toBe(false);
    });

    it('a withdrawn message leaves no trace for the teacher in html, json, album, unread, list or the file url', async () => {
        const { seeded, report, owner, client, teamMessage } = await setup();
        await env.DB.prepare('UPDATE messages SET created_at = ? WHERE id = ?').bind(new Date(Date.now() + 60_000).toISOString(), teamMessage).run();
        const attachmentId = await seedAttachment(report, { messageId: teamMessage, name: 'secret-photo.png' });
        const attachmentUrl = `/p/${seeded.project.slug}/reports/${report.public_id}/attachments/${attachmentId}`;
        const unread = async () => ((await (await client.get(`/p/${seeded.project.slug}/conversations`, JSON_HEADERS)).json()) as { unread_total: number }).unread_total;
        expect((await client.get(attachmentUrl)).status).toBe(200);
        expect(await unread()).toBe(1);

        expect((await owner.post(messageUrl(seeded, report, teamMessage, 'withdraw'), {}, JSON_HEADERS)).status).toBe(200);
        expect(await deletedAt(teamMessage)).not.toBeNull();
        expect(await statusOf(report)).toBe('needs_input');

        const json = await client.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS);
        const payloads = [
            await json.text(),
            await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text(),
            await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}/activity`, { 'if-none-match': 'W/"stale"' })).text(),
            await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}/activity?part=album`, { 'if-none-match': 'W/"stale"' })).text(),
            await (await client.get(`/p/${seeded.project.slug}/conversations`, JSON_HEADERS)).text(),
            await (await client.get(`/p/${seeded.project.slug}?tab=all`)).text(),
        ];
        for (const payload of payloads) {
            expect(payload).not.toContain('團隊原文ALPHA');
            expect(payload).not.toContain('secret-photo');
            expect(payload).not.toContain('已收回');
        }
        const data = await conversation(client, seeded, report);
        expect(data.album_count).toBe(0);
        expect(data.album_html).toBe('');
        expect(data.html).toContain('老師原文BETA');
        expect(await unread()).toBe(0);
        expect((await client.get(attachmentUrl)).status).toBe(404);
        expect((await owner.get(attachmentUrl)).status).toBe(404);
    });

    it('withdrawing the completion request removes the approve button and does not fall back to an older request', async () => {
        const { seeded, report, owner, client } = await setup();
        const older = await insertMessage(report, 'owner', '舊的確認留言', new Date(Date.now() - 600_000).toISOString(), { completion: true });
        const latest = await insertMessage(report, 'owner', '請確認完成XYZ', new Date(Date.now() - 300_000).toISOString(), { completion: true });
        const approve = async () => (await conversation(client, seeded, report)).html;
        expect(await approve()).toContain('data-completion-approve=');
        expect((await owner.post(messageUrl(seeded, report, latest, 'withdraw'), {}, JSON_HEADERS)).status).toBe(200);
        const html = await approve();
        expect(html).not.toContain('data-completion-approve=');
        expect(html).not.toContain('請確認完成XYZ');
        expect(html).toContain('舊的確認留言');
        expect(await statusOf(report)).toBe('needs_input');
        expect(older).toBeGreaterThan(0);
    });

    it('edit can remove and add attachments', async () => {
        const { seeded, report, client, teacherMessage } = await setup();
        const old = await seedAttachment(report, { messageId: teacherMessage, name: 'old.png' });
        const upload = await client.request('PUT', `/p/${seeded.project.slug}/uploads?purpose=message&report=${report.public_id}`, {
            body: PNG_BYTES,
            headers: { 'content-type': 'image/png', 'x-filename': 'new-shot.png', 'content-length': String(PNG_BYTES.byteLength), accept: 'application/json' },
        });
        expect(upload.status).toBe(201);
        const { id } = (await upload.json()) as { id: string };
        const response = await client.post(messageUrl(seeded, report, teacherMessage, 'update'), { body: '老師改過', 'remove_attachments[]': String(old), 'upload_ids[]': id }, JSON_HEADERS);
        expect(response.status).toBe(200);
        const names = (await env.DB.prepare('SELECT original_name FROM attachments WHERE message_id = ?').bind(teacherMessage).all<{ original_name: string }>()).results.map((row) => row.original_name);
        expect(names).toEqual(['new-shot.png']);
        expect(await bodyOf(teacherMessage)).toBe('老師改過');
    });
});

describe('API、MCP、巡檢 API 編輯與收回團隊留言', () => {
    it('the API edits and withdraws team messages but never the teacher\'s', async () => {
        const seeded = await seedProject();
        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        const { report } = await seedReport(seeded.project);
        const team = await insertMessage(report, 'owner', '團隊留言', new Date(Date.now() - 2000).toISOString());
        const teacher = await insertMessage(report, 'reporter', '老師留言', new Date(Date.now() - 1000).toISOString());
        const base = `/projects/${seeded.project.slug}/reports/${report.public_id}/messages`;
        expect((await api('PUT', `${base}/${team}`, token, { body: 'API改的' })).status).toBe(200);
        expect(await bodyOf(team)).toBe('API改的');
        expect((await api('PUT', `${base}/${teacher}`, token, { body: '偷改' })).status).toBe(404);
        expect((await api('DELETE', `${base}/${teacher}`, token)).status).toBe(404);
        expect((await api('DELETE', `${base}/${team}`, token)).status).toBe(200);
        expect(await deletedAt(team)).not.toBeNull();
        expect(await deletedAt(teacher)).toBeNull();
        const detail = (await (await api('GET', `/projects/${seeded.project.slug}/reports/${report.public_id}`, token)).json()) as { messages: Array<{ id: number; body: string }> };
        expect(detail.messages.map((message) => message.id)).toEqual([teacher]);
    });

    it('MCP edit_message and withdraw_message work on team messages only', async () => {
        const seeded = await seedProject();
        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        const { report } = await seedReport(seeded.project);
        const team = await insertMessage(report, 'owner', '團隊留言', new Date(Date.now() - 2000).toISOString());
        const teacher = await insertMessage(report, 'reporter', '老師留言', new Date(Date.now() - 1000).toISOString());
        const call = async (name: string, args: Record<string, unknown>) =>
            rpcResult<{ isError?: boolean; content: Array<{ text: string }> }>(await mcpCall(token, 'tools/call', { name, arguments: { project: seeded.project.slug, report: report.public_id, ...args } }));
        expect((await call('edit_message', { message_id: team, body: 'MCP改的' })).isError).toBeFalsy();
        expect(await bodyOf(team)).toBe('MCP改的');
        expect((await call('edit_message', { message_id: teacher, body: '偷改' })).isError).toBe(true);
        expect((await call('withdraw_message', { message_id: teacher })).isError).toBe(true);
        expect((await call('withdraw_message', { message_id: team })).isError).toBeFalsy();
        expect(await deletedAt(team)).not.toBeNull();
        expect(await deletedAt(teacher)).toBeNull();
    });

    it('the patrol API edits and withdraws team messages only', async () => {
        const seeded = await seedProject();
        const { developer } = await seedDeveloper(unique('alex'), undefined, 'Alex');
        const issued = await issuePatrolToken(workerEnv, developer, '雲端排程', Date.now());
        const { report } = await seedReport(seeded.project);
        const team = await insertMessage(report, 'owner', '團隊留言', new Date(Date.now() - 2000).toISOString());
        const teacher = await insertMessage(report, 'reporter', '老師留言', new Date(Date.now() - 1000).toISOString());
        const patrol = (method: string, id: number, body?: unknown) =>
            exports.default.fetch(
                new Request(`${BASE}/api/patrol/projects/${seeded.project.slug}/reports/${report.public_id}/messages/${id}`, {
                    method,
                    headers: { authorization: `Bearer ${issued.token}`, 'cf-connecting-ip': '10.8.8.9', accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
                    body: body === undefined ? null : JSON.stringify(body),
                }),
            );
        expect((await patrol('PUT', team, { body: '巡檢改的' })).status).toBe(200);
        expect(await bodyOf(team)).toBe('巡檢改的');
        expect((await patrol('PUT', teacher, { body: '偷改' })).status).toBe(404);
        expect((await patrol('DELETE', teacher)).status).toBe(404);
        expect((await patrol('DELETE', team)).status).toBe(200);
        expect(await deletedAt(team)).not.toBeNull();
        expect(await deletedAt(teacher)).toBeNull();
    });
});
