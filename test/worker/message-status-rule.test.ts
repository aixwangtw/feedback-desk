import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { issuePatrolToken } from '../../src/worker/lib/patrol';
import type { Report } from '../../src/worker/lib/models';
import type { ReportStatus } from '../../src/shared/status';
import { api, BASE, Browser, mcpCall, rpcResult, seedDeveloper, seedProject, seedReport, seedToken, unique, workerEnv, type SeededProject } from './helpers';

/**
 * 留言自動切狀態：對應 Laravel 版 FeedbackMessageStatusRuleTest。
 * 等客戶（needs_input）的單客戶留言 → 等工程師（new）；團隊在等工程師的單送出留言 → 等客戶。
 * 已完成的單不因留言改狀態；草稿本身不改狀態；開單附的通知留言（--for-client）不套用。
 */
const REMINDER = '狀態已改為「等客戶」。';

async function reportWith(seeded: SeededProject, status: ReportStatus): Promise<Report> {
    const { report } = await seedReport(seeded.project);
    const completedAt = status === 'completed' ? new Date(Date.now() - 86_400_000).toISOString() : null;
    await env.DB.prepare('UPDATE reports SET status = ?, completed_at = ? WHERE id = ?').bind(status, completedAt, report.id).run();
    return (await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(report.id).first<Report>()) as Report;
}

async function current(report: Report): Promise<Report> {
    return (await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(report.id).first<Report>()) as Report;
}

async function statusEvents(report: Report): Promise<string[]> {
    const { results } = await env.DB.prepare("SELECT detail FROM report_events WHERE report_id = ? AND kind = 'status' ORDER BY id").bind(report.id).all<{ detail: string }>();
    return results.map((row) => row.detail);
}

function messages(seeded: SeededProject, report: Report): string {
    return `/p/${seeded.project.slug}/reports/${report.public_id}/messages`;
}

describe('留言自動切狀態', () => {
    it('a client message on a needs_input report moves it back to new and is logged', async () => {
        const seeded = await seedProject();
        const report = await reportWith(seeded, 'needs_input');
        const client = await new Browser().asClient(seeded);

        expect((await client.post(messages(seeded, report), { body: '還是不對' })).status).toBe(302);

        expect((await current(report)).status).toBe('new');
        expect(await statusEvents(report)).toEqual(['needs_input>new']);
    });

    it('a client message on a new or completed report keeps the status', async () => {
        const seeded = await seedProject();
        const completed = await reportWith(seeded, 'completed');
        const fresh = await reportWith(seeded, 'new');
        const client = await new Browser().asClient(seeded);

        expect((await client.post(messages(seeded, completed), { body: '謝謝' })).status).toBe(302);
        expect((await client.post(messages(seeded, fresh), { body: '補充' })).status).toBe(302);

        expect(await current(completed)).toMatchObject({ status: 'completed', completed_at: completed.completed_at });
        expect((await current(fresh)).status).toBe('new');
        expect([...(await statusEvents(completed)), ...(await statusEvents(fresh))]).toEqual([]);
    });

    it('a team web message on a new report switches it to needs_input and reminds about the adjustment', async () => {
        const seeded = await seedProject();
        const report = await reportWith(seeded, 'new');
        const owner = await new Browser().asOwner(seeded);

        const response = await owner.post(messages(seeded, report), { body: '已修正', _back: `/p/${seeded.project.slug}/reports/${report.public_id}` });
        expect(response.status).toBe(302);
        const page = await (await owner.get(response.headers.get('location') as string)).text();
        expect(page).toContain('等客戶');
        expect(page).not.toContain('待審核');
        expect(page).toContain(REMINDER);

        expect((await current(report)).status).toBe('needs_input');
        expect(await statusEvents(report)).toEqual(['new>needs_input']);
    });

    it('a team message on a completed or needs_input report keeps the status and shows no reminder', async () => {
        const seeded = await seedProject();
        const completed = await reportWith(seeded, 'completed');
        const waiting = await reportWith(seeded, 'needs_input');
        const owner = await new Browser().asOwner(seeded);

        const first = await owner.post(messages(seeded, completed), { body: '補充說明' }, { accept: 'application/json' });
        expect(await first.json()).toEqual({ message: '訊息已送出。', status: 'completed' });
        expect((await owner.post(messages(seeded, waiting), { body: '再補充' })).status).toBe(302);

        expect((await current(completed)).status).toBe('completed');
        expect((await current(waiting)).status).toBe('needs_input');
    });

    it('drafts do not change the status until sent; sending switches new to needs_input', async () => {
        const seeded = await seedProject();
        const report = await reportWith(seeded, 'new');
        const token = await seedToken((await seedDeveloper()).developer);
        expect((await api('POST', `/projects/${seeded.project.slug}/reports/${report.public_id}/drafts`, token, { body: '草稿' })).status).toBe(201);
        expect((await current(report)).status).toBe('new');

        const draft = await env.DB.prepare('SELECT id FROM message_drafts WHERE report_id = ?').bind(report.id).first<{ id: number }>();
        const owner = await new Browser().asOwner(seeded);
        const sent = await owner.post(`/p/${seeded.project.slug}/reports/${report.public_id}/drafts/${draft?.id}/send`);
        expect(sent.status).toBe(302);
        expect(await (await owner.get(sent.headers.get('location') as string)).text()).toContain(REMINDER);

        expect((await current(report)).status).toBe('needs_input');
    });

    it('API (CLI), MCP and patrol messages switch to needs_input; the patrol needs-input endpoint still works', async () => {
        const seeded = await seedProject();
        const { developer } = await seedDeveloper(unique('dev'));
        const token = await seedToken(developer);

        const viaApi = await reportWith(seeded, 'new');
        const response = await api('POST', `/projects/${seeded.project.slug}/reports/${viaApi.public_id}/messages`, token, { body: '已修正' });
        expect(await response.json()).toMatchObject({ status: 'needs_input', notice: REMINDER });
        expect((await current(viaApi)).status).toBe('needs_input');

        const viaMcp = await reportWith(seeded, 'new');
        const result = await rpcResult<{ content: Array<{ text: string }> }>(
            await mcpCall(token, 'tools/call', { name: 'add_message', arguments: { project: seeded.project.slug, report: viaMcp.public_id, body: '已修正' } }),
        );
        expect(JSON.stringify(result)).toContain('needs_input');
        expect((await current(viaMcp)).status).toBe('needs_input');

        const viaPatrol = await reportWith(seeded, 'new');
        const issued = await issuePatrolToken(workerEnv, developer, '雲端排程', Date.now());
        const patrol = (path: string, body?: unknown) =>
            exports.default.fetch(
                new Request(`${BASE}/api/patrol/projects/${seeded.project.slug}/reports/${viaPatrol.public_id}${path}`, {
                    method: 'POST',
                    headers: { authorization: `Bearer ${issued.token}`, 'content-type': 'application/json', 'cf-connecting-ip': '10.6.6.6' },
                    body: body === undefined ? null : JSON.stringify(body),
                }),
            );
        const posted = await patrol('/messages', { body: '已修正' });
        expect(posted.status).toBe(200);
        expect(await posted.json()).toMatchObject({ status: 'needs_input' });
        expect((await current(viaPatrol)).status).toBe('needs_input');
        expect((await patrol('/needs-input')).status).toBe(200);
        expect((await current(viaPatrol)).status).toBe('needs_input');
    });

    it('a replacement draft sent on a new report also switches it to needs_input', async () => {
        const seeded = await seedProject();
        const report = await reportWith(seeded, 'new');
        const at = new Date().toISOString();
        const original = await env.DB.prepare("INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, 'owner', '開發團隊', '原留言', ?, ?) RETURNING id")
            .bind(report.id, at, at)
            .first<{ id: number }>();
        const token = await seedToken((await seedDeveloper()).developer);
        expect((await api('POST', `/projects/${seeded.project.slug}/reports/${report.public_id}/drafts`, token, { body: '改', replace_message_id: original?.id })).status).toBe(201);
        const draft = await env.DB.prepare('SELECT id FROM message_drafts WHERE report_id = ?').bind(report.id).first<{ id: number }>();

        const owner = await new Browser().asOwner(seeded);
        expect((await owner.post(`/p/${seeded.project.slug}/reports/${report.public_id}/drafts/${draft?.id}/send`)).status).toBe(302);

        expect((await current(report)).status).toBe('needs_input');
    });

    it('the notice left when the team shares a new report with the client keeps it new', async () => {
        const seeded = await seedProject();
        const token = await seedToken((await seedDeveloper()).developer);
        const created = await api('POST', `/projects/${seeded.project.slug}/reports`, token, { title: '請看', description: '說明', for_client: true });
        expect(created.status).toBe(201);
        const { public_id } = await created.json<{ public_id: string }>();
        const report = await env.DB.prepare('SELECT * FROM reports WHERE public_id = ?').bind(public_id).first<Report>();
        expect(report?.status).toBe('new');
        expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE report_id = ?').bind(report?.id).first<{ n: number }>())?.n).toBe(1);
    });
});
