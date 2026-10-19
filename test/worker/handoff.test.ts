import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createToken } from '../../src/worker/lib/team';
import { api, BASE, Browser, mcpCall, PNG_BYTES, rpcResult, seedClientAccount, seedDeveloper, seedProject, seedReport, unique, workerEnv } from './helpers';

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };

async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
    return (await response.json()) as T;
}

async function tool<T = Record<string, unknown>>(token: string, name: string, args: Record<string, unknown>): Promise<{ data: T; isError: boolean }> {
    const result = await rpcResult<ToolResult>(await mcpCall(token, 'tools/call', { name, arguments: args }));
    return { data: JSON.parse(result.content[0].text ?? '{}') as T, isError: result.isError === true };
}

async function agentToken(holder: { developerId: number } | { clientAccountId: number }, agent: string | null): Promise<string> {
    return (await createToken(workerEnv, holder, agent ? `${agent} MCP` : 'cli', Date.now(), null, agent)).token;
}

/** Runs the CLI device flow in a browser and returns the token. */
async function deviceLogin(username: string, password: string): Promise<{ access_token: string; account_type: string; project: string | null }> {
    const code = await json<{ device_code: string; user_code: string }>(await api('POST', '/device/code', null, { client_name: 'test cli' }, '203.0.113.20'));
    const browser = new Browser();
    expect((await browser.post('/device/login', { username, password })).status).toBe(302);
    expect(await (await browser.post('/device/approve', { code: code.user_code, decision: 'approve' })).text()).toContain('已授權');
    return json(await api('POST', '/device/token', null, { device_code: code.device_code }));
}

describe('client accounts on the CLI and MCP', () => {
    it('logs a client in with the device flow and keeps it to its own project', async () => {
        const seeded = await seedProject();
        const other = await seedProject();
        const amy = await seedClientAccount(seeded.project, unique('amy'), 'amy-password-1234567', '林小美');
        const granted = await deviceLogin(amy.account.username, amy.password);
        expect(granted.account_type).toBe('client');
        expect(granted.project).toBe(seeded.project.slug);
        const token = granted.access_token;
        const me = await json<{ account_type: string; project: string }>(await api('GET', '/me', token));
        expect(me).toMatchObject({ account_type: 'client', project: seeded.project.slug });

        const { report: visible } = await seedReport(seeded.project, { title: '客戶看得到' });
        await seedReport(seeded.project, { title: '團隊自己的', creator: 'owner_shared' });
        const listed = await json<{ reports: Array<{ title: string }> }>(await api('GET', `/projects/${seeded.project.slug}/reports`, token));
        expect(listed.reports.map((r) => r.title)).toEqual(['客戶看得到']);
        expect((await api('GET', `/projects/${other.project.slug}/reports`, token)).status).toBe(404);
        const { report: elsewhere } = await seedReport(other.project);
        expect((await api('GET', `/projects/${other.project.slug}/reports/${elsewhere.public_id}`, token)).status).toBe(404);
        expect((await json<{ projects: Array<{ slug: string }> }>(await api('GET', '/projects', token))).projects.map((p) => p.slug)).toEqual([seeded.project.slug]);

        // Team-only operations are refused with a plain reason.
        for (const [method, path, body] of [
            ['POST', `/projects/${seeded.project.slug}/reports/${visible.public_id}/status`, { status: 'completed' }],
            ['POST', `/projects/${seeded.project.slug}/reports/${visible.public_id}/adjustment`, { note: 'x' }],
            ['POST', `/projects/${seeded.project.slug}/reports/${visible.public_id}/claim`, {}],
            ['GET', '/developers', undefined],
            ['GET', `/projects/${seeded.project.slug}/clients`, undefined],
        ] as const) {
            const response = await api(method, path, token, body);
            expect(response.status).toBe(403);
            expect((await json<{ error: string }>(response)).error).toBe('team_only');
        }

        // Open a report with an image, then reply on it.
        const upload = await exports.default.fetch(
            new Request(`${BASE}/api/v1/projects/${seeded.project.slug}/uploads`, {
                method: 'PUT',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png', 'content-length': String(PNG_BYTES.byteLength), 'x-filename': 'shot.png', 'cf-connecting-ip': '10.1.1.1' },
                body: PNG_BYTES,
            }),
        );
        expect(upload.status).toBe(201);
        const uploadId = (await json<{ id: string }>(upload)).id;
        const created = await json<{ public_id: string; images_added: number }>(await api('POST', `/projects/${seeded.project.slug}/reports`, token, { title: 'CLI 開的單', description: '說明', upload_ids: [uploadId] }));
        expect(created.images_added).toBe(1);
        const row = await env.DB.prepare('SELECT creator_type, creator_client_account_id FROM reports WHERE public_id = ?').bind(created.public_id).first();
        expect(row).toEqual({ creator_type: 'client', creator_client_account_id: amy.account.id });
        expect((await api('POST', `/projects/${seeded.project.slug}/reports/${created.public_id}/messages`, token, { body: '補充' })).status).toBe(200);
        const detail = await json<{ creator: string; messages: Array<{ author: string }>; claim?: unknown }>(await api('GET', `/projects/${seeded.project.slug}/reports/${created.public_id}`, token));
        expect(detail.creator).toBe('林小美');
        expect(detail.messages[0].author).toBe('林小美');
        expect(detail.claim).toBeUndefined();

        // A signed upload URL for a client only works on its own project's reports.
        const signed = await json<{ url: string }>(await api('POST', `/projects/${seeded.project.slug}/reports/${created.public_id}/upload-url`, token, { purpose: 'adjustment' }));
        expect(signed.url).toContain('k=message');
        const tampered = signed.url.replace(`r=${created.public_id}`, `r=${elsewhere.public_id}`);
        expect((await exports.default.fetch(new Request(tampered, { method: 'PUT', body: PNG_BYTES, headers: { 'x-filename': 'a.png' } }))).status).toBe(403);
        expect((await exports.default.fetch(new Request(signed.url, { method: 'PUT', body: PNG_BYTES, headers: { 'x-filename': 'a.png', 'content-length': String(PNG_BYTES.byteLength) } }))).status).toBe(201);

        // Tokens end when the team disables the account or the holder changes the password.
        const { developer } = await seedDeveloper();
        const teamToken = await agentToken({ developerId: developer.id }, null);
        expect((await api('POST', `/projects/${seeded.project.slug}/clients/${amy.account.username}/disable`, teamToken)).status).toBe(200);
        expect((await api('GET', '/me', token)).status).toBe(401);
    });

    it('gives a client MCP only its own tools and records the AI tool it used', async () => {
        const seeded = await seedProject();
        const amy = await seedClientAccount(seeded.project, unique('amy'), 'amy-password-1234567', '林小美');
        const token = await agentToken({ clientAccountId: amy.account.id }, 'Codex');
        const tools = await rpcResult<{ tools: Array<{ name: string }> }>(await mcpCall(token, 'tools/list'));
        expect(tools.tools.map((t) => t.name).sort()).toEqual(['add_message', 'create_report', 'get_report', 'list_reports']);
        const created = await tool<{ public_id: string }>(token, 'create_report', {
            project: seeded.project.slug,
            title: '用 Codex 開的單',
            description: '說明',
            images: [{ filename: 'a.png', data_base64: btoa(String.fromCharCode(...PNG_BYTES)) }],
        });
        expect(created.isError).toBe(false);
        const other = await seedProject();
        expect((await tool(token, 'list_reports', { project: other.project.slug })).isError).toBe(true);
        const owner = await new Browser().asOwner(seeded);
        expect(await (await owner.get(`/p/${seeded.project.slug}/reports/${created.data.public_id}`)).text()).toContain('建立者：林小美（Codex）');
    });
});

describe('several people and AI tools on one report', () => {
    it('claims, refuses a silent overwrite, hands over with notes, and records who did what', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project, { title: '要交接的單' });
        const alex = await seedDeveloper(undefined, undefined, '王小明');
        const bea = await seedDeveloper(undefined, undefined, '陳美華');
        const alexClaude = await agentToken({ developerId: alex.developer.id }, 'Claude Code');
        const beaCodex = await agentToken({ developerId: bea.developer.id }, 'Codex');
        const slug = seeded.project.slug;

        expect((await tool(alexClaude, 'claim_report', { project: slug, report: report.public_id })).isError).toBe(false);
        const handoff = await tool(alexClaude, 'write_handoff', { project: slug, report: report.public_id, note: '已找到原因在 Header.tsx；下一步改按鈕位置並補測試。', release: false });
        expect(handoff.isError).toBe(false);

        const blocked = await tool<{ error: string; message: string }>(beaCodex, 'set_status', { project: slug, report: report.public_id, status: 'needs_input' });
        expect(blocked.isError).toBe(true);
        expect(blocked.data.error).toBe('claimed_by_other');
        expect(blocked.data.message).toContain('王小明（Claude Code）');
        expect((await tool(beaCodex, 'write_adjustment', { project: slug, report: report.public_id, note: '偷改' })).data).toMatchObject({ error: 'claimed_by_other' });

        const read = await tool<{ claim: { by: string; yours: boolean }; handoff_notes: Array<{ author: string; note: string }> }>(beaCodex, 'get_report', { project: slug, report: report.public_id });
        expect(read.data.claim).toMatchObject({ by: '王小明（Claude Code）', yours: false });
        expect(read.data.handoff_notes[0]).toMatchObject({ author: '王小明（Claude Code）', note: expect.stringContaining('Header.tsx') });

        const taken = await tool<{ took_over_from: string }>(beaCodex, 'claim_report', { project: slug, report: report.public_id, force: true });
        expect(taken.data.took_over_from).toContain('王小明（Claude Code）');
        expect((await tool(beaCodex, 'write_adjustment', { project: slug, report: report.public_id, note: '按鈕已移到上方。' })).isError).toBe(false);
        expect((await tool(beaCodex, 'set_status', { project: slug, report: report.public_id, status: 'needs_input' })).isError).toBe(false);
        expect((await tool(beaCodex, 'add_message', { project: slug, report: report.public_id, body: '改好了，請確認。' })).isError).toBe(false);
        expect((await tool(alexClaude, 'release_report', { project: slug, report: report.public_id })).data).toMatchObject({ error: 'claimed_by_other' });
        expect((await tool<{ released: boolean }>(beaCodex, 'release_report', { project: slug, report: report.public_id })).data.released).toBe(true);

        const events = (await env.DB.prepare('SELECT kind, agent, actor_name FROM report_events WHERE report_id = ? ORDER BY id').bind(report.id).all()).results;
        expect(events).toEqual([
            { kind: 'claim', agent: 'Claude Code', actor_name: '王小明' },
            { kind: 'handoff', agent: 'Claude Code', actor_name: '王小明' },
            { kind: 'takeover', agent: 'Codex', actor_name: '陳美華' },
            { kind: 'adjustment', agent: 'Codex', actor_name: '陳美華' },
            { kind: 'status', agent: 'Codex', actor_name: '陳美華' },
            { kind: 'message', agent: 'Codex', actor_name: '陳美華' },
            { kind: 'release', agent: 'Codex', actor_name: '陳美華' },
        ]);

        // The web page shows the work panel to the team, and the AI tool next to names.
        const owner = new Browser();
        await owner.loginAs(slug, alex.developer.username, alex.password);
        const page = await (await owner.get(`/p/${slug}/reports/${report.public_id}`)).text();
        expect(page).toContain('data-work-panel');
        expect(page).toContain('Header.tsx');
        expect(page).toContain('陳美華（Codex）');
        expect((await owner.post(`/p/${slug}/reports/${report.public_id}/claim`, { action: 'claim' })).status).toBe(302);
        const claimed = await env.DB.prepare('SELECT claimed_by_developer_id, claimed_agent FROM reports WHERE id = ?').bind(report.id).first();
        expect(claimed).toEqual({ claimed_by_developer_id: alex.developer.id, claimed_agent: null });
        // The client never sees the work panel or the handoff notes.
        const client = await new Browser().asClient(seeded);
        const clientPage = await (await client.get(`/p/${slug}/reports/${report.public_id}`)).text();
        expect(clientPage).not.toContain('data-work-panel');
        expect(clientPage).not.toContain('Header.tsx');
        expect(clientPage).toContain('陳美華（Codex）');
    });

    it('takes the AI tool from the CLI header only for known names', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const { developer } = await seedDeveloper();
        const token = await agentToken({ developerId: developer.id }, null);
        const post = (agent: string) =>
            exports.default.fetch(
                new Request(`${BASE}/api/v1/projects/${seeded.project.slug}/reports/${report.public_id}/messages`, {
                    method: 'POST',
                    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-feedback-desk-agent': agent, 'cf-connecting-ip': '10.2.2.2' },
                    body: JSON.stringify({ body: agent }),
                }),
            );
        expect((await post('codex')).status).toBe(200);
        expect((await post('<script>')).status).toBe(200);
        const agents = (await env.DB.prepare('SELECT author_agent FROM messages WHERE report_id = ? ORDER BY id').bind(report.id).all()).results;
        expect(agents).toEqual([{ author_agent: 'Codex' }, { author_agent: null }]);
    });
});
