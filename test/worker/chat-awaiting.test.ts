import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { CHAT_DISMISSED_KEY, chatTabCounts, filterByTab, isAwaitingReply, rememberDismissed, shouldAutoOpen, type StorageLike } from '../../src/shared/chat-tabs';
import type { Report } from '../../src/worker/lib/models';
import { Browser, seedProject, seedReport, type SeededProject } from './helpers';

/**
 * 右下角對話面板「未回覆／已回覆」：對應 Laravel 版 FeedbackChatAwaitingReplyTest 與 chat-tabs.test.js。
 * 未回覆＝單未完成且對方最後發言；沒有留言時以開單的一方當最後發言者；草稿不算回覆。
 */
const JSON_HEADERS = { accept: 'application/json' };
type Item = { id: string; awaiting_reply: boolean };

async function message(report: Report, author: 'reporter' | 'owner' | 'agent', minutesAgo: number, body = '留言'): Promise<void> {
    const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    await env.DB.prepare('INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)').bind(report.id, author, body, at, at).run();
}

async function list(browser: Browser, seeded: SeededProject): Promise<{ items: Item[]; awaiting_total: number }> {
    const response = await browser.get(`/p/${seeded.project.slug}/conversations`, JSON_HEADERS);
    expect(response.status).toBe(200);
    return response.json();
}

const awaitingOf = (data: { items: Item[] }, report: Report) => data.items.find((item) => item.id === report.public_id)?.awaiting_reply;

describe('對話面板的未回覆判定', () => {
    it('each side sees awaiting from its own angle; completed reports never await; no messages falls back to who opened it', async () => {
        const seeded = await seedProject();
        const { report: clientLast } = await seedReport(seeded.project, { title: '客戶最後發言' });
        await message(clientLast, 'owner', 20);
        await message(clientLast, 'reporter', 10);
        const { report: teamLast } = await seedReport(seeded.project, { title: '團隊最後發言' });
        await message(teamLast, 'reporter', 20);
        await message(teamLast, 'agent', 10);
        const { report: done } = await seedReport(seeded.project, { title: '已完成' });
        await message(done, 'reporter', 5);
        await env.DB.prepare("UPDATE reports SET status = 'completed' WHERE id = ?").bind(done.id).run();
        const { report: clientOpened } = await seedReport(seeded.project, { title: '客戶開的沒留言' });
        const { report: teamOpened } = await seedReport(seeded.project, { title: '團隊開的沒留言', creator: 'developer' });
        await env.DB.prepare('UPDATE reports SET shared_with_client = 1 WHERE id = ?').bind(teamOpened.id).run();

        const team = await list(await new Browser().asOwner(seeded), seeded);
        expect(awaitingOf(team, clientLast)).toBe(true);
        expect(awaitingOf(team, teamLast)).toBe(false);
        expect(awaitingOf(team, done)).toBe(false);
        expect(awaitingOf(team, clientOpened)).toBe(true);
        expect(awaitingOf(team, teamOpened)).toBe(false);
        expect(team.awaiting_total).toBe(2);

        const client = await list(await new Browser().asClient(seeded), seeded);
        expect(awaitingOf(client, clientLast)).toBe(false);
        expect(awaitingOf(client, teamLast)).toBe(true);
        expect(awaitingOf(client, done)).toBe(false);
        expect(awaitingOf(client, clientOpened)).toBe(false);
        expect(awaitingOf(client, teamOpened)).toBe(true);
        expect(client.awaiting_total).toBe(2);
    });

    it('a draft is not a reply and never reaches the client', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        await message(report, 'reporter', 10);
        const at = new Date().toISOString();
        await env.DB.prepare("INSERT INTO message_drafts (report_id, author_name, body, created_at, updated_at) VALUES (?, '開發團隊', '草稿不外流', ?, ?)").bind(report.id, at, at).run();

        const owner = new Browser();
        await owner.asOwner(seeded);
        expect(awaitingOf(await list(owner, seeded), report)).toBe(true);
        const client = await new Browser().asClient(seeded);
        const response = await client.get(`/p/${seeded.project.slug}/conversations`, JSON_HEADERS);
        const text = await response.text();
        expect(text).not.toContain('草稿不外流');
        expect(awaitingOf(JSON.parse(text), report)).toBe(false);
    });

    it('the panel has the 未回覆／已回覆 tabs, 未回覆 selected first', async () => {
        const seeded = await seedProject();
        const html = await (await (await new Browser().asOwner(seeded)).get(`/p/${seeded.project.slug}`)).text();
        expect(html).toContain('role="tablist" aria-label="對話分類" data-chat-tabs');
        expect(html).toMatch(/aria-selected="true"[^>]*data-chat-tab="awaiting">未回覆 <span data-chat-tab-count="awaiting">/);
        expect(html).toMatch(/aria-selected="false"[^>]*data-chat-tab="replied">已回覆 <span data-chat-tab-count="replied">/);
    });
});

describe('對話面板頁籤的純邏輯', () => {
    const items = [{ id: 'a', awaiting_reply: true }, { id: 'b', awaiting_reply: false }, { id: 'c', awaiting_reply: true }, { id: 'd' }];

    it('filters and counts by tab', () => {
        expect(filterByTab(items, 'awaiting').map((item) => item.id)).toEqual(['a', 'c']);
        expect(filterByTab(items, 'replied').map((item) => item.id)).toEqual(['b', 'd']);
        expect(chatTabCounts(items)).toEqual({ awaiting: 2, replied: 2 });
        expect(chatTabCounts([])).toEqual({ awaiting: 0, replied: 0 });
    });

    it('decides awaiting from the last speaker, falling back to the creator', () => {
        expect(isAwaitingReply('new', 'reporter', 'developer', true)).toBe(true);
        expect(isAwaitingReply('needs_input', 'agent', 'client', false)).toBe(true);
        expect(isAwaitingReply('new', null, 'public', true)).toBe(true);
        expect(isAwaitingReply('new', null, 'owner_shared', false)).toBe(true);
        expect(isAwaitingReply('completed', 'reporter', 'client', true)).toBe(false);
    });

    it('opens automatically only with awaiting items and until dismissed in this session', () => {
        const store = new Map<string, string>();
        const storage: StorageLike = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => void store.set(key, value) };
        expect(shouldAutoOpen(0, storage)).toBe(false);
        expect(shouldAutoOpen(2, storage)).toBe(true);
        rememberDismissed(storage);
        expect(store.get(CHAT_DISMISSED_KEY)).toBe('1');
        expect(shouldAutoOpen(2, storage)).toBe(false);
        expect(shouldAutoOpen(2, null)).toBe(true);
    });

    it('still opens when sessionStorage throws, and dismissing does not throw', () => {
        const broken: StorageLike = {
            getItem: () => {
                throw new Error('SecurityError');
            },
            setItem: () => {
                throw new Error('QuotaExceededError');
            },
        };
        expect(shouldAutoOpen(1, broken)).toBe(true);
        expect(() => rememberDismissed(broken)).not.toThrow();
    });
});
