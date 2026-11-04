import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { api, BASE, Browser, PNG_BYTES, seedDeveloper, seedProject, seedToken, workerEnv, type SeededProject } from './helpers';
import { createToken, DEFAULT_CLIENT_NOTICE } from '../../src/worker/lib/team';
import { paths } from '../../src/worker/routes/paths';

async function json<T = Record<string, unknown>>(response: Response): Promise<T> {
    return (await response.json()) as T;
}

async function teamSetup() {
    const { developer } = await seedDeveloper(undefined, undefined, '王小明');
    const token = await seedToken(developer);
    const seeded = await seedProject({ clientUsername: 'mei', clientPassword: 'client-password-1234567', clientName: '林小美' });
    return { token, seeded, slug: seeded.project.slug };
}

async function uploadImage(slug: string, token: string): Promise<string> {
    const response = await exports.default.fetch(
        new Request(`${BASE}/api/v1/projects/${slug}/uploads`, {
            method: 'PUT',
            headers: { authorization: `Bearer ${token}`, 'content-length': String(PNG_BYTES.byteLength), 'x-filename': 'a.png', 'content-type': 'image/png' },
            body: PNG_BYTES,
        }),
    );
    expect(response.status).toBe(201);
    return (await json<{ id: string }>(response)).id;
}

async function clientApiToken(seeded: SeededProject): Promise<string> {
    return (await createToken(workerEnv, { clientAccountId: seeded.clientAccount!.id }, 'client cli', Date.now())).token;
}

async function clientBrowser(seeded: SeededProject): Promise<Browser> {
    const browser = new Browser();
    expect((await browser.loginAs(seeded.project.slug, 'mei', 'client-password-1234567')).status).toBe(302);
    return browser;
}

describe('team report shared with the client (--for-client)', () => {
    it('shows the report to the client with attachments, a team notice and an unread count', async () => {
        const { token, seeded, slug } = await teamSetup();
        const uploadId = await uploadImage(slug, token);
        const created = await json<{ public_id: string; shared_with_client: boolean; images_added: number }>(
            await api('POST', `/projects/${slug}/reports`, token, { title: '給客戶的單', description: '請看', upload_ids: [uploadId], for_client: true }),
        );
        expect(created).toMatchObject({ shared_with_client: true, images_added: 1 });

        const clientToken = await clientApiToken(seeded);
        const list = await json<{ reports: Array<{ public_id: string; number: number; unread_messages_count: number; attachments_count: number; messages_count: number }> }>(await api('GET', `/projects/${slug}/reports`, clientToken));
        expect(list.reports).toHaveLength(1);
        expect(list.reports[0]).toMatchObject({ public_id: created.public_id, number: 1, unread_messages_count: 1, attachments_count: 1, messages_count: 1 });

        const detail = await json<{ number: number; attachments: Array<{ url: string }>; messages: Array<{ author_type: string; body: string }> }>(await api('GET', `/projects/${slug}/reports/${created.public_id}`, clientToken));
        expect(detail.number).toBe(1);
        expect(detail.attachments).toHaveLength(1);
        expect(detail.messages).toMatchObject([{ author_type: 'owner', body: DEFAULT_CLIENT_NOTICE }]);

        const browser = await clientBrowser(seeded);
        const board = await json<{ items: Array<{ id: string; unread: number }> }>(await browser.get(`/p/${slug}/conversations`, { accept: 'application/json' }));
        expect(board.items.find((item) => item.id === created.public_id)?.unread).toBe(1);
        expect((await browser.get(paths.report(slug, created.public_id))).status).toBe(200);
        const attachmentId = (await env.DB.prepare('SELECT a.id FROM attachments a JOIN reports r ON r.id = a.report_id WHERE r.public_id = ?').bind(created.public_id).first<{ id: number }>())!.id;
        expect((await browser.get(paths.attachment(slug, created.public_id, attachmentId))).status).toBe(200);
    });

    it('uses a custom notice and rejects --notice without --for-client', async () => {
        const { token, slug } = await teamSetup();
        const created = await json<{ public_id: string }>(await api('POST', `/projects/${slug}/reports`, token, { title: '單', description: 'd', for_client: true, notice: '請先看第二段' }));
        const message = await env.DB.prepare('SELECT m.body, m.author_type FROM messages m JOIN reports r ON r.id = m.report_id WHERE r.public_id = ?').bind(created.public_id).first();
        expect(message).toEqual({ body: '請先看第二段', author_type: 'owner' });
        const refused = await api('POST', `/projects/${slug}/reports`, token, { title: '單二', description: 'd', notice: '不該出現' });
        expect(refused.status).toBe(422);
        expect((await json<{ error: string }>(refused)).error).toBe('notice_needs_for_client');
        expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM reports WHERE title = '單二'").first('n')).toBe(0);
    });

    it('keeps team reports without the flag invisible to the client', async () => {
        const { token, seeded, slug } = await teamSetup();
        const created = await json<{ public_id: string; shared_with_client: boolean }>(await api('POST', `/projects/${slug}/reports`, token, { title: '內部單', description: 'd' }));
        expect(created.shared_with_client).toBe(false);
        expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM messages m JOIN reports r ON r.id = m.report_id WHERE r.public_id = ?').bind(created.public_id).first('n')).toBe(0);
        const clientToken = await clientApiToken(seeded);
        expect((await json<{ reports: unknown[] }>(await api('GET', `/projects/${slug}/reports`, clientToken))).reports).toHaveLength(0);
        expect((await api('GET', `/projects/${slug}/reports/${created.public_id}`, clientToken)).status).toBe(404);
        const browser = await clientBrowser(seeded);
        expect((await json<{ items: unknown[] }>(await browser.get(`/p/${slug}/conversations`, { accept: 'application/json' }))).items).toHaveLength(0);
        expect((await browser.get(paths.report(slug, created.public_id))).status).not.toBe(200);
    });

    it('counts shared reports in the client numbering and lets the client reply', async () => {
        const { token, seeded, slug } = await teamSetup();
        const clientToken = await clientApiToken(seeded);
        const own = await json<{ public_id: string }>(await api('POST', `/projects/${slug}/reports`, clientToken, { title: '客戶自己的', description: 'd' }));
        await new Promise((resolve) => setTimeout(resolve, 5));
        const shared = await json<{ public_id: string }>(await api('POST', `/projects/${slug}/reports`, token, { title: '分享的', description: 'd', for_client: true }));
        const clientList = await json<{ reports: Array<{ public_id: string; number: number }> }>(await api('GET', `/projects/${slug}/reports`, clientToken));
        expect(clientList.reports.map((r) => [r.public_id, r.number])).toEqual([[shared.public_id, 1], [own.public_id, 2]]);
        const teamList = await json<{ reports: Array<{ public_id: string; client_number: number | null }> }>(await api('GET', `/projects/${slug}/reports`, token));
        expect(teamList.reports.find((r) => r.public_id === shared.public_id)?.client_number).toBe(1);
        expect((await api('POST', `/projects/${slug}/reports/${shared.public_id}/messages`, clientToken, { body: '收到' })).status).toBe(200);
    });

    it('lets the client upload message images on a shared report and does not touch other team reports', async () => {
        const { token, seeded, slug } = await teamSetup();
        const shared = await json<{ public_id: string }>(await api('POST', `/projects/${slug}/reports`, token, { title: '分享', description: 'd', for_client: true }));
        const hidden = await json<{ public_id: string }>(await api('POST', `/projects/${slug}/reports`, token, { title: '內部', description: 'd' }));
        const clientToken = await clientApiToken(seeded);
        const put = (id: string) => exports.default.fetch(new Request(`${BASE}/api/v1/projects/${slug}/reports/${id}/uploads`, { method: 'PUT', headers: { authorization: `Bearer ${clientToken}`, 'content-length': String(PNG_BYTES.byteLength), 'x-filename': 'r.png' }, body: PNG_BYTES }));
        expect((await put(shared.public_id)).status).toBe(201);
        expect((await put(hidden.public_id)).status).toBe(404);
    });
});
