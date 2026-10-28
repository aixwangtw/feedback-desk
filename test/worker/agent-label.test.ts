import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { isDeveloperSideAuthor, isDeveloperSideCreator, withAgent } from '../../src/worker/lib/agents';
import { createToken } from '../../src/worker/lib/team';
import { Browser, mcpCall, rpcResult, seedClientAccount, seedDeveloper, seedProject, unique, workerEnv } from './helpers';

type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };

async function tool<T = Record<string, unknown>>(token: string, name: string, args: Record<string, unknown>): Promise<T> {
    const result = await rpcResult<ToolResult>(await mcpCall(token, 'tools/call', { name, arguments: args }));
    return JSON.parse(result.content[0].text ?? '{}') as T;
}

async function agentToken(holder: { developerId: number } | { clientAccountId: number }, agent: string): Promise<string> {
    return (await createToken(workerEnv, holder, `${agent} MCP`, Date.now(), null, agent)).token;
}

describe('agent label on the developer side', () => {
    it('shows only the name for developer-side actors, the tool for client accounts', () => {
        expect(withAgent('王小明', 'Codex')).toBe('王小明（Codex）');
        expect(withAgent('王小明', 'Codex', true)).toBe('王小明');
        expect(withAgent('王小明', null)).toBe('王小明');
        expect(isDeveloperSideCreator('developer')).toBe(true);
        expect(isDeveloperSideCreator('owner_shared')).toBe(true);
        expect(isDeveloperSideCreator('client')).toBe(false);
        expect(isDeveloperSideAuthor({ author_type: 'owner', author_client_account_id: null })).toBe(true);
        expect(isDeveloperSideAuthor({ author_type: 'owner', author_client_account_id: 3 })).toBe(false);
        expect(isDeveloperSideAuthor({ author_type: 'reporter', author_client_account_id: null })).toBe(false);
    });

    it('drops the tool name for a developer account through MCP but keeps it in the database', async () => {
        const seeded = await seedProject();
        const slug = seeded.project.slug;
        const alex = await seedDeveloper(undefined, undefined, '王小明');
        const token = await agentToken({ developerId: alex.developer.id }, 'Claude Code');

        const created = await tool<{ public_id: string }>(token, 'create_report', { project: slug, title: '開發者開的單', description: '說明' });
        const claimed = await tool<{ claimed_by: string }>(token, 'claim_report', { project: slug, report: created.public_id });
        expect(claimed.claimed_by).toBe('王小明');
        await tool(token, 'write_adjustment', { project: slug, report: created.public_id, note: '已調整' });
        await tool(token, 'add_message', { project: slug, report: created.public_id, body: '好了' });
        await tool(token, 'write_handoff', { project: slug, report: created.public_id, note: '交接內容', release: false });

        const read = await tool<{
            creator: string;
            claim: { by: string };
            handoff_notes: Array<{ author: string }>;
            recent_activity: Array<{ by: string }>;
            untrusted_content: { messages: Array<{ author: string }> };
        }>(token, 'get_report', { project: slug, report: created.public_id });
        expect(read.creator).toBe('王小明');
        expect(read.claim.by).toBe('王小明');
        expect(read.handoff_notes.map((n) => n.author)).toEqual(['王小明']);
        expect(read.recent_activity.length).toBeGreaterThan(0);
        expect(read.recent_activity.every((e) => e.by === '王小明')).toBe(true);
        expect(read.untrusted_content.messages.every((m) => m.author === '王小明')).toBe(true);

        const listed = await tool<{ reports: Array<{ creator: string; claimed_by: string | null }> }>(token, 'list_reports', { project: slug });
        expect(listed.reports[0]).toMatchObject({ creator: '王小明', claimed_by: '王小明' });

        const stored = await env.DB.prepare('SELECT creator_agent, claimed_agent FROM reports WHERE public_id = ?').bind(created.public_id).first();
        expect(stored).toEqual({ creator_agent: 'Claude Code', claimed_agent: 'Claude Code' });
        const browser = new Browser();
        await browser.loginAs(slug, alex.developer.username, alex.password);
        const page = await (await browser.get(`/p/${slug}/reports/${created.public_id}`)).text();
        expect(page).toContain('建立者：王小明');
        expect(page).not.toContain('王小明（Claude Code）');
    });

    it('keeps 名字（工具） for a client account, while the team sees the developer without it', async () => {
        const seeded = await seedProject();
        const slug = seeded.project.slug;
        const amy = await seedClientAccount(seeded.project, unique('amy'), 'amy-password-1234567', '林小美');
        const clientToken = await agentToken({ clientAccountId: amy.account.id }, 'Codex');
        const created = await tool<{ public_id: string }>(clientToken, 'create_report', { project: slug, title: '客戶的單', description: '說明' });
        const sent = await tool<{ author: string }>(clientToken, 'add_message', { project: slug, report: created.public_id, body: '請看' });
        expect(sent.author).toBe('林小美（Codex）');

        const bea = await seedDeveloper(undefined, undefined, '陳美華');
        const devToken = await agentToken({ developerId: bea.developer.id }, 'Claude Code');
        const reply = await tool<{ author: string }>(devToken, 'add_message', { project: slug, report: created.public_id, body: '收到' });
        expect(reply.author).toBe('陳美華');

        const read = await tool<{ creator: string; untrusted_content: { messages: Array<{ author: string }> } }>(devToken, 'get_report', { project: slug, report: created.public_id });
        expect(read.creator).toBe('林小美（Codex）');
        expect(read.untrusted_content.messages.map((m) => m.author)).toEqual(['林小美（Codex）', '陳美華']);

        const clientRead = JSON.stringify(await tool(clientToken, 'get_report', { project: slug, report: created.public_id }));
        expect(clientRead).toContain('陳美華');
        expect(clientRead).not.toContain('陳美華（Claude Code）');

        const browser = new Browser();
        await browser.loginAs(slug, bea.developer.username, bea.password);
        const page = await (await browser.get(`/p/${slug}/reports/${created.public_id}`)).text();
        expect(page).toContain('建立者：林小美（Codex）');
        expect(page).not.toContain('陳美華（Claude Code）');
    });
});
