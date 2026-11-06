import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { issuePatrolToken } from '../../src/worker/lib/patrol';
import { deleteReport } from '../../src/worker/lib/reports';
import type { Report } from '../../src/worker/lib/models';
import { api, BASE, Browser, PNG_BYTES, seedDeveloper, seedProject, seedReport, seedToken, unique, workerEnv, type SeededProject } from './helpers';

/**
 * 待審留言（草稿）：對應 Laravel 版 FeedbackMessageDraftTest。
 * 草稿存在獨立的表，客戶端任何頁面、API 都讀不到、不算未讀；團隊在單頁送出、編輯或捨棄。
 */
const DRAFT_TEXT = '待審內容：已修正排版，請再看一次';
const JSON_HEADERS = { accept: 'application/json' };

async function setup() {
    const seeded = await seedProject();
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { report } = await seedReport(seeded.project, { title: '題目排版跑掉' });
    await env.DB.prepare('UPDATE reports SET owner_last_read_at = ?, client_last_read_at = ? WHERE id = ?').bind(hourAgo, hourAgo, report.id).run();
    const { developer, password } = await seedDeveloper(unique('alex'), undefined, 'Alex');
    const token = await seedToken(developer);
    return { seeded, report, developer, password, token };
}

/** Same request as `feedback-desk draft` (the CLI calls this team API endpoint from inside an AI tool). */
async function createDraftAs(token: string, seeded: SeededProject, report: Report, body: Record<string, unknown>, agent = 'Claude Code'): Promise<Response> {
    const request = new Request(`${BASE}/api/v1/projects/${seeded.project.slug}/reports/${report.public_id}/drafts`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json', 'x-feedback-desk-agent': agent, 'cf-connecting-ip': '10.9.9.9' },
        body: JSON.stringify(body),
    });
    return exports.default.fetch(request);
}

async function uploadForMessage(token: string, seeded: SeededProject, report: Report): Promise<string> {
    const response = await exports.default.fetch(
        new Request(`${BASE}/api/v1/projects/${seeded.project.slug}/reports/${report.public_id}/uploads?purpose=message`, {
            method: 'PUT',
            headers: { authorization: `Bearer ${token}`, 'content-length': String(PNG_BYTES.byteLength), 'x-filename': 'after.png', 'cf-connecting-ip': '10.9.9.9' },
            body: PNG_BYTES,
        }),
    );
    expect(response.status).toBe(201);
    return (await response.json<{ id: string }>()).id;
}

async function soleDraft(report: Report) {
    const { results } = await env.DB.prepare('SELECT * FROM message_drafts WHERE report_id = ?').bind(report.id).all<{ id: number; body: string; author_agent: string | null; author_developer_id: number | null; replaces_message_id: number | null; attachments: string | null }>();
    expect(results).toHaveLength(1);
    return results[0];
}

async function messageCount(report: Report): Promise<number> {
    return (await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE report_id = ?').bind(report.id).first<{ n: number }>())?.n ?? 0;
}

/** Team messages the shared client side has not read (the number on the client's chat button). */
async function clientUnread(report: Report): Promise<number> {
    const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM messages m JOIN reports r ON r.id = m.report_id WHERE r.id = ? AND m.author_type IN ('owner', 'agent') AND (r.client_last_read_at IS NULL OR m.created_at > r.client_last_read_at)",
    )
        .bind(report.id)
        .first<{ n: number }>();
    return row?.n ?? 0;
}

async function teamMessage(report: Report, body: string): Promise<number> {
    const at = new Date(Date.now() - 600_000).toISOString();
    const row = await env.DB.prepare("INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, 'owner', '開發團隊', ?, ?, ?) RETURNING id, created_at")
        .bind(report.id, body, at, at)
        .first<{ id: number }>();
    return row?.id ?? 0;
}

function draftUrl(seeded: SeededProject, report: Report, id: number, action = ''): string {
    return `/p/${seeded.project.slug}/reports/${report.public_id}/drafts/${id}${action}`;
}

describe('待審留言（草稿）', () => {
    it('creates a draft through the team API that the client cannot see anywhere and that is not unread', async () => {
        const { seeded, report, token } = await setup();
        const response = await createDraftAs(token, seeded, report, { body: `  ${DRAFT_TEXT}  ` });
        expect(response.status).toBe(201);
        const created = await response.json<{ draft: { id: number; body: string; replaces_message_id: number | null; report_url: string } }>();
        expect(created.draft).toMatchObject({ body: DRAFT_TEXT, replaces_message_id: null, report_url: `${BASE}/p/${seeded.project.slug}/reports/${report.public_id}` });

        const draft = await soleDraft(report);
        expect(draft.body).toBe(DRAFT_TEXT);
        expect(draft.author_agent).toBe('Claude Code');
        expect(await messageCount(report)).toBe(0);
        expect(await clientUnread(report)).toBe(0);

        const client = await new Browser().asClient(seeded);
        const page = await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        expect(page).not.toContain(DRAFT_TEXT);
        expect(page).not.toContain('data-message-draft');
        expect(page).not.toContain('待審留言');
        expect(await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}/activity`)).text()).not.toContain(DRAFT_TEXT);
        expect(await (await client.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, JSON_HEADERS)).text()).not.toContain(DRAFT_TEXT);
        const portal = await (await client.get(`/p/${seeded.project.slug}`)).text();
        expect(portal).not.toContain('待審留言');
        expect(portal).not.toContain('data-unread-badge');
        expect(await clientUnread(report)).toBe(0);
    });

    it('shows the team the draft with send, edit and discard buttons (and no draft tag on the list or board)', async () => {
        const { seeded, report, token } = await setup();
        await createDraftAs(token, seeded, report, { body: DRAFT_TEXT });
        const draft = await soleDraft(report);
        const owner = await new Browser().asOwner(seeded);

        const page = await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        expect(page).toContain(`data-message-draft="${draft.id}"`);
        expect(page).toContain(DRAFT_TEXT);
        for (const label of ['送出', '捨棄', '編輯', 'border-dashed']) {
            expect(page).toContain(label);
        }
        // The list and the board carry no draft tag any more (it shows in the detail, the page and the panel only).
        for (const query of ['', '?view=board', '?sort=created_at']) {
            // The header bell still lists drafts; look at the list itself.
            const portal = (await (await owner.get(`/p/${seeded.project.slug}${query}`)).text()).replace(/<details[^>]*data-notification-bell[\s\S]*?<\/details>/, '');
            expect(portal).not.toContain('待審留言');
            expect(portal).not.toContain('data-draft-badge');
        }
    });

    it('sending turns the draft into a message by the sender, now, that the client sees as unread', async () => {
        const { seeded, report, token, developer, password } = await setup();
        await createDraftAs(token, seeded, report, { body: DRAFT_TEXT });
        const draft = await soleDraft(report);
        const before = Date.now();
        const alex = new Browser();
        expect((await alex.loginAs(seeded.project.slug, developer.username, password)).status).toBe(302);

        const response = await alex.post(draftUrl(seeded, report, draft.id, '/send'));
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toContain('#conversation');

        expect(await env.DB.prepare('SELECT id FROM message_drafts WHERE id = ?').bind(draft.id).first()).toBeNull();
        const message = await env.DB.prepare('SELECT * FROM messages WHERE report_id = ?').bind(report.id).first<{ body: string; author_type: string; author_developer_id: number; author_agent: string; created_at: string }>();
        expect(message).toMatchObject({ body: DRAFT_TEXT, author_type: 'owner', author_developer_id: developer.id, author_agent: 'Claude Code' });
        expect(Date.parse(message!.created_at)).toBeGreaterThanOrEqual(before - 1000);
        expect(await clientUnread(report)).toBe(1);

        const client = await new Browser().asClient(seeded);
        expect(await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text()).toContain(DRAFT_TEXT);
    });

    it('lets the team edit a draft before sending, and refuses an empty body', async () => {
        const { seeded, report, token } = await setup();
        await createDraftAs(token, seeded, report, { body: DRAFT_TEXT });
        const draft = await soleDraft(report);
        const owner = await new Browser().asOwner(seeded);

        expect((await owner.post(draftUrl(seeded, report, draft.id, '/update'), { body: '  改過的內容  ' })).status).toBe(302);
        expect((await soleDraft(report)).body).toBe('改過的內容');
        expect(await messageCount(report)).toBe(0);

        const empty = await owner.post(draftUrl(seeded, report, draft.id, '/update'), { body: ' ' });
        expect(empty.status).toBe(422);
        expect(await empty.text()).toContain('待審留言內容不能空白');
        expect((await soleDraft(report)).body).toBe('改過的內容');
    });

    it('a replacement draft rewrites the original team message instead of adding one, keeping its time', async () => {
        const { seeded, report, token } = await setup();
        const originalId = await teamMessage(report, '原本的說明（有錯字）');
        const original = await env.DB.prepare('SELECT created_at FROM messages WHERE id = ?').bind(originalId).first<{ created_at: string }>();
        expect((await createDraftAs(token, seeded, report, { body: '修正後的說明', replace_message_id: originalId })).status).toBe(201);
        const draft = await soleDraft(report);
        expect(draft.replaces_message_id).toBe(originalId);

        const client = await new Browser().asClient(seeded);
        const clientPage = await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        expect(clientPage).toContain('原本的說明（有錯字）');
        expect(clientPage).not.toContain('修正後的說明');

        const owner = await new Browser().asOwner(seeded);
        expect(await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text()).toContain('修改原留言');
        expect((await owner.post(draftUrl(seeded, report, draft.id, '/send'))).status).toBe(302);

        expect(await messageCount(report)).toBe(1);
        const after = await env.DB.prepare('SELECT body, created_at FROM messages WHERE id = ?').bind(originalId).first<{ body: string; created_at: string }>();
        expect(after).toEqual({ body: '修正後的說明', created_at: original?.created_at });
        expect(await env.DB.prepare('SELECT id FROM message_drafts WHERE id = ?').bind(draft.id).first()).toBeNull();
    });

    it('a replacement must point to a team message on the same report', async () => {
        const { seeded, report, token } = await setup();
        const clientMessage = await env.DB.prepare("INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, 'reporter', '客戶', '客戶的話', ?, ?) RETURNING id")
            .bind(report.id, new Date().toISOString(), new Date().toISOString())
            .first<{ id: number }>();
        const { report: other } = await seedReport(seeded.project);
        const otherTeamMessage = await teamMessage(other, '別張單');

        for (const id of [clientMessage!.id, otherTeamMessage, 999999, 'abc']) {
            const response = await createDraftAs(token, seeded, report, { body: 'x', replace_message_id: id });
            expect(response.status).toBe(422);
            expect((await response.json<{ error: string }>()).error).toBe('message_not_replaceable');
        }
        expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM message_drafts WHERE report_id = ?').bind(report.id).first<{ n: number }>())?.n).toBe(0);
    });

    it('discarding deletes the draft and its stored image', async () => {
        const { seeded, report, token } = await setup();
        const uploadId = await uploadForMessage(token, seeded, report);
        const created = await createDraftAs(token, seeded, report, { body: DRAFT_TEXT, upload_ids: [uploadId] });
        expect(created.status).toBe(201);
        expect((await created.json<{ images_added: number }>()).images_added).toBe(1);
        const draft = await soleDraft(report);
        const [file] = JSON.parse(draft.attachments ?? '[]') as Array<{ object_key: string }>;
        expect(await env.FILES.head(file.object_key)).not.toBeNull();
        // The image left the pending uploads, so the cleanup job does not delete it.
        expect(await env.DB.prepare('SELECT id FROM uploads WHERE id = ?').bind(uploadId).first()).toBeNull();

        const owner = await new Browser().asOwner(seeded);
        expect((await owner.post(draftUrl(seeded, report, draft.id, '/discard'))).status).toBe(302);
        expect(await env.DB.prepare('SELECT id FROM message_drafts WHERE id = ?').bind(draft.id).first()).toBeNull();
        expect(await env.FILES.head(file.object_key)).toBeNull();
        expect(await messageCount(report)).toBe(0);
    });

    it('draft images are shown only to the team and become message attachments when sent', async () => {
        const { seeded, report, token } = await setup();
        const uploadId = await uploadForMessage(token, seeded, report);
        await createDraftAs(token, seeded, report, { body: DRAFT_TEXT, upload_ids: [uploadId] });
        const draft = await soleDraft(report);
        expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM attachments WHERE report_id = ?').bind(report.id).first<{ n: number }>())?.n).toBe(0);

        const client = await new Browser().asClient(seeded);
        expect((await client.get(draftUrl(seeded, report, draft.id, '/files/0'))).status).toBe(403);

        const owner = await new Browser().asOwner(seeded);
        const image = await owner.get(draftUrl(seeded, report, draft.id, '/files/0'));
        expect(image.status).toBe(200);
        expect(image.headers.get('content-type')).toBe('image/png');
        expect((await owner.get(draftUrl(seeded, report, draft.id, '/files/5'))).status).toBe(404);
        expect((await owner.post(draftUrl(seeded, report, draft.id, '/send'))).status).toBe(302);

        const message = await env.DB.prepare('SELECT id FROM messages WHERE report_id = ?').bind(report.id).first<{ id: number }>();
        const attachment = await env.DB.prepare('SELECT message_id, object_key FROM attachments WHERE report_id = ?').bind(report.id).first<{ message_id: number; object_key: string }>();
        expect(attachment?.message_id).toBe(message?.id);
        expect(await env.FILES.head(attachment!.object_key)).not.toBeNull();
    });

    it('refuses an empty body, a bare number as the report and a client token', async () => {
        const { seeded, report, token } = await setup();
        expect((await createDraftAs(token, seeded, report, { body: ' ' })).status).toBe(422);
        const numbered = await api('POST', `/projects/${seeded.project.slug}/reports/1/drafts`, token, { body: 'x' });
        expect(numbered.status).toBe(422);
        expect((await numbered.json<{ error: string }>()).error).toBe('number_not_allowed');
        expect((await createDraftAs(token, seeded, report, { body: 'x', upload_ids: ['not-a-real-upload-id-0000'] })).status).toBe(422);
        expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM message_drafts WHERE report_id = ?').bind(report.id).first<{ n: number }>())?.n).toBe(0);
    });

    it('the client cannot send, edit or discard drafts', async () => {
        const { seeded, report, token } = await setup();
        await createDraftAs(token, seeded, report, { body: DRAFT_TEXT });
        const draft = await soleDraft(report);
        const client = await new Browser().asClient(seeded);

        expect((await client.post(draftUrl(seeded, report, draft.id, '/send'))).status).toBe(403);
        expect((await client.post(draftUrl(seeded, report, draft.id, '/update'), { body: '偷改' })).status).toBe(403);
        expect((await client.post(draftUrl(seeded, report, draft.id, '/discard'))).status).toBe(403);
        expect((await new Browser().post(draftUrl(seeded, report, draft.id, '/send'))).status).toBe(403);

        expect((await soleDraft(report)).body).toBe(DRAFT_TEXT);
        expect(await messageCount(report)).toBe(0);
    });

    it('a draft of another report is not found', async () => {
        const { seeded, report, token } = await setup();
        await createDraftAs(token, seeded, report, { body: DRAFT_TEXT });
        const draft = await soleDraft(report);
        const { report: other } = await seedReport(seeded.project);
        const owner = await new Browser().asOwner(seeded);

        expect((await owner.post(draftUrl(seeded, other, draft.id, '/send'))).status).toBe(404);
        expect((await soleDraft(report)).id).toBe(draft.id);
    });

    it('the patrol API creates drafts and logs each write', async () => {
        const { seeded, report, developer } = await setup();
        const issued = await issuePatrolToken(workerEnv, developer, '雲端排程', Date.now());
        const originalId = await teamMessage(report, '原留言');
        const url = `/api/patrol/projects/${seeded.project.slug}/reports/${report.public_id}/drafts`;
        const patrol = (body: unknown, token: string | null = issued.token, path = url) =>
            exports.default.fetch(
                new Request(`${BASE}${path}`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', accept: 'application/json', 'cf-connecting-ip': '10.7.7.7', ...(token ? { authorization: `Bearer ${token}` } : {}) },
                    body: JSON.stringify(body),
                }),
            );

        expect((await patrol({ body: DRAFT_TEXT }, null)).status).toBe(401);
        const first = await patrol({ body: DRAFT_TEXT });
        expect(first.status).toBe(201);
        expect((await first.json<{ draft: { body: string; replaces_message_id: number | null } }>()).draft).toMatchObject({ body: DRAFT_TEXT, replaces_message_id: null });
        const second = await patrol({ body: '改原留言', replace_message_id: originalId });
        expect(second.status).toBe(201);
        expect((await second.json<{ draft: { replaces_message_id: number } }>()).draft.replaces_message_id).toBe(originalId);
        expect((await patrol({ body: ' ' })).status).toBe(422);
        expect((await patrol({ body: 'x', replace_message_id: 999999 })).status).toBe(422);
        expect((await patrol({ body: 'x' }, issued.token, `/api/patrol/projects/${seeded.project.slug}/reports/${crypto.randomUUID()}/drafts`)).status).toBe(404);

        const { results: drafts } = await env.DB.prepare('SELECT author_developer_id, author_agent FROM message_drafts WHERE report_id = ? ORDER BY id').bind(report.id).all<{ author_developer_id: number; author_agent: string }>();
        expect(drafts).toHaveLength(2);
        expect(drafts[0]).toEqual({ author_developer_id: developer.id, author_agent: 'Claude Code' });
        // 只有原本那則團隊留言算未讀；兩則草稿都不算。草稿不改狀態。
        expect(await messageCount(report)).toBe(1);
        expect(await clientUnread(report)).toBe(1);
        expect((await env.DB.prepare('SELECT status FROM reports WHERE id = ?').bind(report.id).first<{ status: string }>())?.status).toBe('new');
        const logs = await env.DB.prepare("SELECT succeeded, detail FROM patrol_logs WHERE patrol_token_id = ? AND action = 'draft' ORDER BY id").bind(issued.id).all<{ succeeded: number; detail: string }>();
        expect(logs.results.map((log) => log.succeeded)).toEqual([1, 1, 0, 0, 0]);
        expect(logs.results.map((log) => log.detail).join('')).not.toContain(DRAFT_TEXT);
    });

    it('deleting the report removes its drafts and their images', async () => {
        const { seeded, report, token } = await setup();
        const uploadId = await uploadForMessage(token, seeded, report);
        await createDraftAs(token, seeded, report, { body: DRAFT_TEXT, upload_ids: [uploadId] });
        const draft = await soleDraft(report);
        const [file] = JSON.parse(draft.attachments ?? '[]') as Array<{ object_key: string }>;

        await deleteReport(workerEnv, report);

        expect(await env.DB.prepare('SELECT id FROM message_drafts WHERE id = ?').bind(draft.id).first()).toBeNull();
        expect(await env.FILES.head(file.object_key)).toBeNull();
    });
});
