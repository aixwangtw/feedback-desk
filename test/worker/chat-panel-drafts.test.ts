import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { draftAttachmentViews, draftMeta, draftSendParams, nextDraftIndex, shouldFillComposer } from '../../src/shared/chat-drafts';
import { adjustmentReminder } from '../../src/worker/lib/reports';
import type { Report } from '../../src/worker/lib/models';
import { Browser, seedProject, seedReport, workerEnv, type SeededProject } from './helpers';

/**
 * 右下角對話面板裡的待審留言：對應 Laravel 版 FeedbackChatPanelDraftTest 與 chat-drafts.test.js。
 * 團隊打開那張單時草稿帶進輸入框、按送出走與單頁相同的送出端點（可送出改過的文字、取代型改寫原留言）、
 * 清單標「有草稿」、有草稿的單算未回覆。客戶的面板完全拿不到草稿。
 */
const DRAFT_TEXT = '面板草稿：已修正第 3 題排版';
const JSON_HEADERS = { accept: 'application/json' };

interface ThreadJson {
    id: string;
    drafts?: Array<{ id: number; body: string; author: string; replaces_message_id: number | null; replaces_body: string | null; attachments_count: number; attachments: Array<{ url: string; name: string; is_video: boolean }>; send_url: string; page_url: string }>;
}
interface ListJson {
    items: Array<{ id: string; awaiting_reply: boolean; drafts_count?: number }>;
    awaiting_total: number;
    unread_total: number;
    drafts_total?: number;
}

async function setup(): Promise<{ seeded: SeededProject; report: Report }> {
    const seeded = await seedProject();
    const { report } = await seedReport(seeded.project, { title: '有草稿的單' });
    const now = new Date().toISOString();
    await env.DB.prepare('UPDATE reports SET owner_last_read_at = ?, client_last_read_at = ? WHERE id = ?').bind(now, now, report.id).run();
    return { seeded, report };
}

async function message(report: Report, author: 'reporter' | 'owner', body: string, minutesAgo = 10): Promise<number> {
    const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const row = await env.DB.prepare('INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?) RETURNING id')
        .bind(report.id, author, body, at, at)
        .first<{ id: number }>();
    return row?.id ?? 0;
}

async function draft(report: Report, replaces: number | null = null, body = DRAFT_TEXT): Promise<number> {
    const at = new Date().toISOString();
    const row = await env.DB.prepare(
        "INSERT INTO message_drafts (report_id, replaces_message_id, author_name, author_agent, body, created_at, updated_at) VALUES (?, ?, '開發團隊', 'Claude Code', ?, ?, ?) RETURNING id",
    )
        .bind(report.id, replaces, body, at, at)
        .first<{ id: number }>();
    return row?.id ?? 0;
}

async function draftExists(id: number): Promise<boolean> {
    return (await env.DB.prepare('SELECT id FROM message_drafts WHERE id = ?').bind(id).first()) !== null;
}

async function messages(report: Report): Promise<Array<{ id: number; body: string; author_type: string; created_at: string }>> {
    return (await env.DB.prepare('SELECT id, body, author_type, created_at FROM messages WHERE report_id = ? ORDER BY id').bind(report.id).all<{ id: number; body: string; author_type: string; created_at: string }>()).results;
}

const sendUrl = (seeded: SeededProject, report: Report, id: number) => `/p/${seeded.project.slug}/reports/${report.public_id}/drafts/${id}/send`;

async function thread(browser: Browser, seeded: SeededProject, report: Report): Promise<ThreadJson> {
    const response = await browser.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS);
    expect(response.status).toBe(200);
    return response.json();
}

async function list(browser: Browser, seeded: SeededProject, headers: Record<string, string> = {}): Promise<Response> {
    return browser.get(`/p/${seeded.project.slug}/conversations`, { ...JSON_HEADERS, ...headers });
}

describe('對話面板的待審留言', () => {
    it('the team thread carries drafts with their send url, and the list marks them', async () => {
        const { seeded, report } = await setup();
        const originalId = await message(report, 'owner', '原本的說明');
        const draftId = await draft(report, originalId);
        const owner = await new Browser().asOwner(seeded);

        const data = await thread(owner, seeded, report);
        expect(data.drafts).toEqual([
            {
                id: draftId,
                body: DRAFT_TEXT,
                author: '開發團隊',
                replaces_message_id: originalId,
                replaces_body: '原本的說明',
                attachments_count: 0,
                attachments: [],
                send_url: sendUrl(seeded, report, draftId),
                page_url: `/p/${seeded.project.slug}/reports/${report.public_id}#message-drafts`,
            },
        ]);

        const listed = (await (await list(owner, seeded)).json()) as ListJson;
        expect(listed.items.find((item) => item.id === report.public_id)?.drafts_count).toBe(1);
        expect(listed.drafts_total).toBe(1);

        const portal = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        expect(portal).toContain('data-chat-draft');
        expect(portal).toContain('待審留言（還沒發出）');
        expect(portal).toContain('data-chat-draft-resume');
    });

    it('an unsent draft counts as awaiting for the team only', async () => {
        const { seeded, report } = await setup();
        // 團隊最後發言，照理是「已回覆」；但還有沒送出的草稿，團隊端放進未回覆並讓面板彈出。
        await message(report, 'reporter', '問題', 20);
        await message(report, 'owner', '已回覆', 10);
        const { report: plain } = await seedReport(seeded.project, { title: '沒草稿已回覆' });
        await message(plain, 'owner', '回覆', 5);
        await draft(report);

        const owner = await new Browser().asOwner(seeded);
        const team = (await (await list(owner, seeded)).json()) as ListJson;
        expect(team.items.find((item) => item.id === report.public_id)?.awaiting_reply).toBe(true);
        expect(team.items.find((item) => item.id === plain.public_id)?.awaiting_reply).toBe(false);
        expect(team.awaiting_total).toBe(1);
        expect(team.drafts_total).toBe(1);

        const client = await new Browser().asClient(seeded);
        const clientList = (await (await list(client, seeded)).json()) as ListJson;
        expect(clientList).not.toHaveProperty('drafts_total');
        // 客戶端照原規則：團隊最後發言＝等客戶回覆，兩張都是未回覆；草稿完全不影響。
        expect(clientList.awaiting_total).toBe(2);
    });

    it('the team thread lists draft attachments with the draft file route; the client never gets them', async () => {
        const { seeded, report } = await setup();
        const id = await draft(report);
        const files = [
            { object_key: 'drafts/a.mp4', original_name: '教學.mp4', mime_type: 'video/mp4', size: 10 },
            { object_key: 'drafts/b.png', original_name: '截圖.png', mime_type: 'image/png', size: 10 },
        ];
        await env.DB.prepare('UPDATE message_drafts SET attachments = ? WHERE id = ?').bind(JSON.stringify(files), id).run();
        const base = `/p/${seeded.project.slug}/reports/${report.public_id}/drafts/${id}/files`;

        const owner = await new Browser().asOwner(seeded);
        const data = await thread(owner, seeded, report);
        expect(data.drafts?.[0].attachments_count).toBe(2);
        expect(data.drafts?.[0].attachments).toEqual([
            { url: `${base}/0`, name: '教學.mp4', is_video: true },
            { url: `${base}/1`, name: '截圖.png', is_video: false },
        ]);

        const client = await new Browser().asClient(seeded);
        const text = await (await client.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS)).text();
        expect(JSON.parse(text)).not.toHaveProperty('drafts');
        expect(text).not.toContain('drafts/a.mp4');
        expect(text).not.toContain('/files/0');
        expect((await client.get(`${base}/0`)).status).toBe(403);
    });

    it('the client panel never receives drafts', async () => {
        const { seeded, report } = await setup();
        await draft(report);
        const client = await new Browser().asClient(seeded);

        const response = await client.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS);
        const text = await response.text();
        expect(JSON.parse(text)).not.toHaveProperty('drafts');
        expect(text).not.toContain(DRAFT_TEXT);

        const listText = await (await list(client, seeded)).text();
        expect(listText).not.toContain(DRAFT_TEXT);
        for (const item of (JSON.parse(listText) as ListJson).items) {
            expect(item).not.toHaveProperty('drafts_count');
        }

        const portal = await (await client.get(`/p/${seeded.project.slug}?tab=all`)).text();
        expect(portal).not.toContain(DRAFT_TEXT);
        expect(portal).not.toContain('data-chat-draft');
    });

    it('a new or changed draft refreshes the cached team list and thread (ETag), and leaves the client list cached', async () => {
        const { seeded, report } = await setup();
        const owner = await new Browser().asOwner(seeded);
        const client = await new Browser().asClient(seeded);
        // 開單會標成已讀並動到團隊端清單版本，所以先開單、再取清單的 ETag。
        const firstThread = await owner.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS);
        const threadTag = firstThread.headers.get('etag') ?? '';
        const firstList = await list(owner, seeded);
        const listTag = firstList.headers.get('etag') ?? '';
        const clientTag = (await list(client, seeded)).headers.get('etag') ?? '';
        expect((await owner.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, { ...JSON_HEADERS, 'if-none-match': threadTag })).status).toBe(304);
        expect((await list(owner, seeded, { 'if-none-match': listTag })).status).toBe(304);

        const draftId = await draft(report);
        expect((await list(owner, seeded, { 'if-none-match': listTag })).status).toBe(200);
        expect((await list(client, seeded, { 'if-none-match': clientTag })).status).toBe(304);
        const refreshed = await owner.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, { ...JSON_HEADERS, 'if-none-match': threadTag });
        expect(refreshed.status).toBe(200);
        const newTag = refreshed.headers.get('etag') ?? '';
        expect(((await refreshed.json()) as ThreadJson).drafts?.[0]?.body).toBe(DRAFT_TEXT);

        await env.DB.prepare('UPDATE message_drafts SET body = ?, updated_at = ? WHERE id = ?').bind('改過的草稿', new Date(Date.now() + 1000).toISOString(), draftId).run();
        const edited = await owner.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, { ...JSON_HEADERS, 'if-none-match': newTag });
        expect(edited.status).toBe(200);
        expect(((await edited.json()) as ThreadJson).drafts?.[0]?.body).toBe('改過的草稿');
    });

    it('sending from the panel uses the edited text and answers JSON', async () => {
        const { seeded, report } = await setup();
        const draftId = await draft(report);
        const owner = await new Browser().asOwner(seeded);

        const response = await owner.post(sendUrl(seeded, report, draftId), { body: '  面板裡改過的文字  ' }, JSON_HEADERS);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'needs_input', message: `留言已送出。${adjustmentReminder(workerEnv)}` });

        expect(await draftExists(draftId)).toBe(false);
        const sent = await messages(report);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({ body: '面板裡改過的文字', author_type: 'owner' });
    });

    it('sending without a body keeps the draft text', async () => {
        const { seeded, report } = await setup();
        const draftId = await draft(report);
        const owner = await new Browser().asOwner(seeded);

        expect((await owner.post(sendUrl(seeded, report, draftId), {}, JSON_HEADERS)).status).toBe(200);
        expect((await messages(report)).map((row) => row.body)).toEqual([DRAFT_TEXT]);
    });

    it('a replacement draft sent from the panel rewrites the original with the edited text, keeping its time', async () => {
        const { seeded, report } = await setup();
        const originalId = await message(report, 'owner', '原本的說明');
        const before = (await messages(report))[0];
        const draftId = await draft(report, originalId);
        const owner = await new Browser().asOwner(seeded);

        const response = await owner.post(sendUrl(seeded, report, draftId), { body: '面板改過的更正' }, JSON_HEADERS);
        expect(response.status).toBe(200);
        expect(((await response.json()) as { message: string }).message.startsWith('已修改原留言。')).toBe(true);

        const after = await messages(report);
        expect(after).toHaveLength(1);
        expect(after[0]).toMatchObject({ id: originalId, body: '面板改過的更正', created_at: before.created_at });
        expect(await draftExists(draftId)).toBe(false);
    });

    it('a blank edited text is refused with 422 and the draft is kept', async () => {
        const { seeded, report } = await setup();
        const draftId = await draft(report);
        const owner = await new Browser().asOwner(seeded);

        const response = await owner.post(sendUrl(seeded, report, draftId), { body: '   ' }, JSON_HEADERS);
        expect(response.status).toBe(422);
        expect(((await response.json()) as { errors: { body: string[] } }).errors.body[0]).toContain('不能空白');
        expect(await draftExists(draftId)).toBe(true);
        expect(await messages(report)).toHaveLength(0);
    });

    it('the client cannot send drafts', async () => {
        const { seeded, report } = await setup();
        const draftId = await draft(report);
        const client = await new Browser().asClient(seeded);

        expect((await client.post(sendUrl(seeded, report, draftId), { body: '偷送' }, JSON_HEADERS)).status).toBe(403);
        expect(await draftExists(draftId)).toBe(true);
        expect(await messages(report)).toHaveLength(0);
    });

    it('the single-page send button (no body, form post) still redirects with the reminder', async () => {
        const { seeded, report } = await setup();
        const draftId = await draft(report);
        const owner = await new Browser().asOwner(seeded);
        const response = await owner.post(sendUrl(seeded, report, draftId));
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toContain('#conversation');
        expect((await messages(report)).map((row) => row.body)).toEqual([DRAFT_TEXT]);
    });
});

describe('對話面板待審留言的純邏輯', () => {
    it('fills the composer only when it is blank or still the text loaded last time', () => {
        expect(shouldFillComposer('', null)).toBe(true);
        expect(shouldFillComposer('   ', '舊草稿')).toBe(true);
        expect(shouldFillComposer('舊草稿', '舊草稿')).toBe(true);
        expect(shouldFillComposer('我改過了', '舊草稿')).toBe(false);
    });

    it('cycles through several drafts', () => {
        expect(nextDraftIndex(0, 3)).toBe(1);
        expect(nextDraftIndex(2, 3)).toBe(0);
        expect(nextDraftIndex(5, 0)).toBe(0);
    });

    it('describes the draft: author, which one, images', () => {
        expect(draftMeta({ author: 'Alex（Claude Code）', attachments_count: 0 }, 0, 1)).toBe('Alex（Claude Code）寫的');
        expect(draftMeta({ author: 'Alex', attachments_count: 2 }, 1, 3)).toBe('Alex寫的・第 2／3 則・附件 2 個會一起送出');
    });

    it('describes the draft attachments as video or image views', () => {
        expect(draftAttachmentViews({})).toEqual([]);
        expect(draftAttachmentViews({ attachments: [{ url: '/a', name: 'a.mp4', is_video: true }, { url: '/b', name: 'b.png', is_video: false }] })).toEqual([
            { kind: 'video', url: '/a', name: 'a.mp4' },
            { kind: 'image', url: '/b', name: 'b.png' },
        ]);
    });

    it('sends only the composer text, never the panel images', () => {
        expect(draftSendParams('  改過的文字  ').toString()).toBe(new URLSearchParams([['body', '  改過的文字  ']]).toString());
        expect([...draftSendParams('x').keys()]).toEqual(['body']);
    });
});
