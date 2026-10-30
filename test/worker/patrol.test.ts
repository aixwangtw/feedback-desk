import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/worker/lib/crypto';
import { issuePatrolToken } from '../../src/worker/lib/patrol';
import { PATROL_TOKEN_PER_MINUTE } from '../../src/worker/routes/patrol';
import { api, BASE, seedAttachment, seedDeveloper, seedProject, seedReport, seedToken, unique, workerEnv } from './helpers';
import type { Report } from '../../src/worker/lib/models';

async function patrol(method: string, path: string, token: string | null, body?: unknown, ip = '10.8.8.8'): Promise<Response> {
    const headers: Record<string, string> = { 'cf-connecting-ip': ip, accept: 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    return exports.default.fetch(new Request(`${BASE}/api/patrol${path}`, { method, headers, body: body === undefined ? null : JSON.stringify(body) }));
}

async function setup() {
    const seeded = await seedProject();
    const { developer } = await seedDeveloper(unique('alex'), undefined, 'Alex');
    const issued = await issuePatrolToken(workerEnv, developer, '雲端排程', Date.now());
    return { seeded, developer, plain: issued.token, tokenId: issued.id };
}

async function addMessage(report: Report, authorType: 'reporter' | 'owner', at: string, body = '留言'): Promise<void> {
    await env.DB.prepare('INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(report.id, authorType, null, body, at, at).run();
}

describe('scheduled patrol API', () => {
    it('refuses requests without a valid patrol token, including regular API tokens', async () => {
        const { developer, plain } = await setup();
        const missing = await patrol('GET', '/projects', null);
        expect(missing.status).toBe(401);
        expect(missing.headers.get('www-authenticate')).toContain('Bearer');
        expect((await patrol('GET', '/projects', 'fdp_nope')).status).toBe(401);
        expect((await patrol('GET', '/projects', `fdk_${plain.slice(4)}`)).status).toBe(401);
        expect((await patrol('GET', '/projects', await seedToken(developer))).status).toBe(401);
        // A patrol token does not open the regular API either.
        expect((await api('GET', '/me', plain)).status).toBe(401);
    });

    it('stores only the SHA-256 hash and stops working when revoked or the account is disabled', async () => {
        const { developer, plain, tokenId } = await setup();
        const row = await env.DB.prepare('SELECT * FROM patrol_tokens WHERE id = ?').bind(tokenId).first<Record<string, unknown>>();
        expect(row?.token_hash).toBe(await sha256Hex(plain));
        expect(JSON.stringify(row)).not.toContain(plain);
        expect((await patrol('GET', '/projects', plain)).status).toBe(200);

        const manager = await seedToken((await seedDeveloper()).developer);
        const listed = await (await api('GET', '/patrol-tokens', manager)).json<{ tokens: Array<{ id: number; developer: string }> }>();
        expect(listed.tokens.find((t) => t.id === tokenId)?.developer).toBe(developer.username);
        expect(JSON.stringify(listed)).not.toContain('token_hash');
        expect((await api('DELETE', `/patrol-tokens/${tokenId}`, manager)).status).toBe(200);
        expect((await patrol('GET', '/projects', plain)).status).toBe(401);
        expect((await api('DELETE', '/patrol-tokens/999999', manager)).status).toBe(404);

        const second = await setup();
        await env.DB.prepare('UPDATE developers SET disabled_at = ? WHERE id = ?').bind(new Date().toISOString(), second.developer.id).run();
        expect((await patrol('GET', '/projects', second.plain)).status).toBe(401);
    });

    it('issues tokens through the team API and refuses client tokens and unknown accounts', async () => {
        const { developer } = await seedDeveloper(unique('bob'));
        const manager = await seedToken(developer);
        const created = await api('POST', '/patrol-tokens', manager, { developer: developer.username, name: '測試' });
        expect(created.status).toBe(201);
        const { token } = await created.json<{ token: string }>();
        expect(token).toMatch(/^fdp_[A-Za-z0-9]{48}$/);
        expect((await patrol('GET', '/projects', token)).status).toBe(200);
        expect((await api('POST', '/patrol-tokens', manager, { developer: 'nobody-here' })).status).toBe(404);
        expect((await api('POST', '/patrol-tokens', null, {})).status).toBe(401);
    });

    it('lists every project with its portal URL', async () => {
        const { seeded, plain } = await setup();
        const later = await seedProject();
        const { projects } = await (await patrol('GET', '/projects', plain)).json<{ projects: Array<{ slug: string; url: string }> }>();
        const slugs = projects.map((p) => p.slug);
        expect(slugs.indexOf(seeded.project.slug)).toBeLessThan(slugs.indexOf(later.project.slug));
        expect(projects.find((p) => p.slug === later.project.slug)?.url).toBe(`${BASE}/p/${later.project.slug}`);
    });

    it('lists new, unread and unanswered reports with details, and leaves answered ones out', async () => {
        const { seeded, plain } = await setup();
        const project = seeded.project;
        const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
        const now = new Date().toISOString();

        const { report: fresh } = await seedReport(project, { title: '新單' });
        await seedAttachment(fresh);

        const { report: answered } = await seedReport(project, { title: '已回覆' });
        await addMessage(answered, 'reporter', hourAgo);
        await env.DB.prepare("UPDATE reports SET status = 'needs_input', owner_last_read_at = ?, adjustment_updated_at = ? WHERE id = ?").bind(now, now, answered.id).run();

        const { report: unanswered } = await seedReport(project, { title: '沒回覆' });
        await addMessage(unanswered, 'owner', hourAgo);
        await addMessage(unanswered, 'reporter', now);
        await env.DB.prepare("UPDATE reports SET status = 'needs_input', owner_last_read_at = ? WHERE id = ?").bind(now, unanswered.id).run();

        const { report: unread } = await seedReport(project, { title: '未讀' });
        await addMessage(unread, 'reporter', hourAgo, '還是不行');
        await addMessage(unread, 'owner', now);
        await env.DB.prepare("UPDATE reports SET status = 'completed' WHERE id = ?").bind(unread.id).run();

        const { report: deleted } = await seedReport(project, { title: '客戶刪除' });
        await env.DB.prepare('UPDATE reports SET client_deleted_at = ? WHERE id = ?').bind(now, deleted.id).run();

        const response = await patrol('GET', `/projects/${project.slug}/attention`, plain);
        expect(response.status).toBe(200);
        const data = await response.json<{ total: number; returned: number; reports: Array<{ public_id: string; attention_reasons: string[]; attachments: Array<{ url: string }>; messages: unknown[] }> }>();
        const byId = new Map(data.reports.map((r) => [r.public_id, r]));
        expect(data.total).toBe(3);
        expect(byId.get(fresh.public_id)?.attention_reasons).toEqual(['status_new']);
        expect(byId.get(fresh.public_id)?.attachments[0].url).toContain('/files/');
        expect(byId.get(unanswered.public_id)?.attention_reasons).toEqual(['reporter_message_after_last_reply']);
        expect(byId.get(unread.public_id)?.attention_reasons).toEqual(['unread_messages']);
        expect(byId.has(answered.public_id)).toBe(false);
        expect(byId.has(deleted.public_id)).toBe(false);
        expect((await patrol('GET', '/projects/no-such-project/attention', plain)).status).toBe(404);
    });

    it('leaves out completed reports whose newer client message is only a thank-you', async () => {
        const { seeded, plain } = await setup();
        const project = seeded.project;
        const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
        const twoHoursAgo = new Date(Date.now() - 7_200_000).toISOString();
        const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
        const complete = async (report: Report, status = 'completed') =>
            env.DB.prepare('UPDATE reports SET status = ?, adjustment_updated_at = ? WHERE id = ?').bind(status, dayAgo, report.id).run();

        const { report: thanked } = await seedReport(project, { title: '道謝' });
        await addMessage(thanked, 'reporter', hourAgo, '好的，謝謝！');
        await complete(thanked);

        const { report: questioned } = await seedReport(project, { title: '追問' });
        await addMessage(questioned, 'reporter', twoHoursAgo, '謝謝，不過第三題怎麼還是一樣');
        await addMessage(questioned, 'reporter', hourAgo, '麻煩了');
        await complete(questioned);

        const { report: asked } = await seedReport(project, { title: '問號' });
        await addMessage(asked, 'reporter', hourAgo, '可以再調大一點?');
        await complete(asked);

        const { report: reopened } = await seedReport(project, { title: '重新打開' });
        await addMessage(reopened, 'reporter', hourAgo, '謝謝');
        await complete(reopened, 'new');

        const { report: pending } = await seedReport(project, { title: '待審核道謝' });
        await addMessage(pending, 'reporter', hourAgo, '謝謝');
        await complete(pending, 'needs_input');

        const data = await (await patrol('GET', `/projects/${project.slug}/attention`, plain)).json<{ total: number; reports: Array<{ public_id: string }> }>();
        const ids = data.reports.map((r) => r.public_id).sort();
        expect(ids).toEqual([questioned.public_id, asked.public_id, reopened.public_id, pending.public_id].sort());
        expect(data.total).toBe(4);
    });

    it('reads a report, leaves a message, writes the adjustment note and sets needs_input, logging only summaries', async () => {
        const { seeded, plain, tokenId } = await setup();
        const slug = seeded.project.slug;
        const { report } = await seedReport(seeded.project, { title: '要處理' });

        const shown = await patrol('GET', `/projects/${slug}/reports/${report.public_id}`, plain);
        expect(shown.status).toBe(200);
        expect((await shown.json<{ title: string }>()).title).toBe('要處理');

        expect((await patrol('POST', `/projects/${slug}/reports/${report.public_id}/messages`, plain, { body: '已處理，請確認' })).status).toBe(200);
        const message = await env.DB.prepare('SELECT author_type, author_agent, body FROM messages WHERE report_id = ?').bind(report.id).first<{ author_type: string; author_agent: string; body: string }>();
        expect(message).toMatchObject({ author_type: 'owner', author_agent: 'Claude Code', body: '已處理，請確認' });

        expect((await patrol('PUT', `/projects/${slug}/reports/${report.public_id}/adjustment`, plain, { note: '改了按鈕' })).status).toBe(200);
        expect((await patrol('PUT', `/projects/${slug}/reports/${report.public_id}/adjustment`, plain, { note: '補充', append: true })).status).toBe(200);
        expect((await patrol('PUT', `/projects/${slug}/reports/${report.public_id}/adjustment`, plain, { note: '' })).status).toBe(422);
        const stored = await env.DB.prepare('SELECT adjustment_note, status FROM reports WHERE id = ?').bind(report.id).first<{ adjustment_note: string; status: string }>();
        expect(stored?.adjustment_note).toContain('改了按鈕');
        expect(stored?.adjustment_note).toContain('補充');

        const status = await patrol('POST', `/projects/${slug}/reports/${report.public_id}/needs-input`, plain);
        expect(status.status).toBe(200);
        expect((await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(report.id).first<{ status: string }>())?.status).toBe('needs_input');

        expect((await patrol('POST', `/projects/${slug}/reports/missing-report/messages`, plain, { body: 'x' })).status).toBe(404);

        const { results } = await env.DB.prepare('SELECT action, succeeded, detail FROM patrol_logs WHERE patrol_token_id = ? ORDER BY id').bind(tokenId).all<{ action: string; succeeded: number; detail: string }>();
        expect(results.map((r) => [r.action, r.succeeded])).toEqual([
            ['message', 1],
            ['adjustment', 1],
            ['adjustment', 1],
            ['adjustment', 0],
            ['needs_input', 1],
            ['message', 0],
        ]);
        expect(JSON.parse(results[0].detail)).toEqual({ body_length: 7 });
        expect(JSON.parse(results[4].detail)).toEqual({ previous: 'new' });
        expect(JSON.parse(results[5].detail).error).toBe('report_not_found');
        expect(results.map((r) => r.detail).join('')).not.toContain('改了按鈕');
    });

    it('has no way to complete or delete a report', async () => {
        const { seeded, plain } = await setup();
        const { report } = await seedReport(seeded.project);
        const base = `/projects/${seeded.project.slug}/reports/${report.public_id}`;
        for (const [method, path] of [
            ['POST', `${base}/status`],
            ['POST', `${base}/completed`],
            ['DELETE', base],
        ] as const) {
            expect((await patrol(method, path, plain, { status: 'completed' })).status).toBe(404);
        }
        expect((await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(report.id).first<{ status: string }>())?.status).toBe('new');
    });

    it('limits requests per token', async () => {
        const { plain } = await setup();
        // Fixed one-minute windows: if the run crosses a window edge, the limit is reached in the next one.
        let firstRefused = -1;
        for (let i = 0; i <= PATROL_TOKEN_PER_MINUTE * 2 && firstRefused < 0; i++) {
            const response = await patrol('GET', '/projects', plain, undefined, `10.7.${i}.1`);
            if (response.status === 429) {
                expect(response.headers.get('retry-after')).not.toBeNull();
                firstRefused = i;
            }
        }
        expect(firstRefused).toBeGreaterThanOrEqual(PATROL_TOKEN_PER_MINUTE);
    });
});
