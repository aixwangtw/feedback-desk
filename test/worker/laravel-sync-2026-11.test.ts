import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createToken } from '../../src/worker/lib/team';
import type { Report } from '../../src/worker/lib/models';
import { api, BASE, Browser, mcpCall, PNG_BYTES, rpcResult, seedDeveloper, seedProject, seedReport, seedToken, unique, workerEnv, type SeededProject } from './helpers';

/**
 * 2026-11-24 同步 Laravel 版（laravel 分支 e2f33dc 之前）的功能：
 * - 重複單合併（76c40df）：客戶 30 分鐘內重複送出一樣的單自動合併、團隊手動合併、還原取消合併。
 * - 同一張單只留一則待審留言（e2f33dc）。
 * - 客戶刪除的單團隊端畫面也不列（73b2276、27ba08c）。
 * - 附件名稱一律「圖N／影片N」（fb7bc3c）。
 */
const slugOf = (seeded: SeededProject) => seeded.project.slug;

async function reportsOf(projectId: number): Promise<Report[]> {
    return (await env.DB.prepare('SELECT * FROM reports WHERE project_id = ? ORDER BY id').bind(projectId).all<Report>()).results;
}

async function eventsOf(report: Report): Promise<Array<{ kind: string; detail: string | null }>> {
    return (await env.DB.prepare("SELECT kind, detail FROM report_events WHERE report_id = ? AND kind = 'merge' ORDER BY id").bind(report.id).all<{ kind: string; detail: string | null }>()).results;
}

const issue = (title: string, description: string) => ({ 'issues[0][title]': title, 'issues[0][description]': description });

describe('重複單合併', () => {
    it('merges a client report sent again within 30 minutes into the earlier one, and both sides stop listing it', async () => {
        const username = unique('amy');
        const seeded = await seedProject({ clientUsername: username, clientPassword: 'amy-password-123456' });
        const client = new Browser();
        expect((await client.loginAs(slugOf(seeded), username, 'amy-password-123456')).status).toBe(302);
        expect((await client.post(`/p/${slugOf(seeded)}/reports`, issue('登入按鈕沒反應', '按了沒有跳頁'))).status).toBe(302);
        const again = await client.post(`/p/${slugOf(seeded)}/reports`, issue('  登入按鈕沒反應 ', '按了沒有跳頁\n'));
        expect(again.status).toBe(302);
        const flash = await (await client.get(again.headers.get('location') as string)).text();
        expect(flash).toContain('這次送出的內容和剛才送出的單一樣，已自動合併成一張。');

        const [kept, duplicate] = await reportsOf(seeded.project.id);
        expect(duplicate.merged_into_report_id).toBe(kept.id);
        expect(duplicate.client_deleted_at).not.toBeNull();
        expect(kept.merged_into_report_id).toBeNull();
        expect(await eventsOf(duplicate)).toEqual([{ kind: 'merge', detail: `合併到編號 2（${kept.public_id}）` }]);
        expect(await eventsOf(kept)).toEqual([{ kind: 'merge', detail: `編號 1（${duplicate.public_id}）併入這張` }]);

        const owner = await new Browser().asOwner(seeded);
        for (const browser of [owner, client]) {
            const list = await (await browser.get(`/p/${slugOf(seeded)}?tab=all`)).text();
            expect(list).toContain(`data-report-row="${kept.public_id}"`);
            expect(list).not.toContain(`data-report-row="${duplicate.public_id}"`);
            expect(list).toContain('共 1 題');
        }
        // 團隊端單頁仍可開，顯示「已合併到編號 N」並連到保留的單；最近動態記「合併重複的單」。
        const page = await (await owner.get(`/p/${slugOf(seeded)}/reports/${duplicate.public_id}`)).text();
        expect(page).toContain(`data-merged-into="${kept.public_id}">已合併到編號 2</a>`);
        expect(page).toContain('已刪除・只留紀錄');
        expect(page).toContain('合併重複的單');
        // 還原一併取消合併。
        expect((await owner.post(`/p/${slugOf(seeded)}/reports/${duplicate.public_id}/restore`)).status).toBe(302);
        const restored = (await reportsOf(seeded.project.id))[1];
        expect(restored.merged_into_report_id).toBeNull();
        expect(restored.client_deleted_at).toBeNull();
    });

    it('does not merge different text, other people, older reports, team or public reports', async () => {
        const seeded = await seedProject();
        const client = await new Browser().asClient(seeded);
        await client.post(`/p/${slugOf(seeded)}/reports`, issue('A', '說明'));
        await client.post(`/p/${slugOf(seeded)}/reports`, issue('A', '不同的說明'));
        // 超過 30 分鐘的舊單不算重複。
        await env.DB.prepare('UPDATE reports SET created_at = ? WHERE project_id = ?').bind(new Date(Date.now() - 31 * 60_000).toISOString(), seeded.project.id).run();
        await client.post(`/p/${slugOf(seeded)}/reports`, issue('A', '說明'));
        // 團隊開的單不合併。
        const owner = await new Browser().asOwner(seeded);
        await owner.post(`/p/${slugOf(seeded)}/reports`, issue('團隊的單', '說明'));
        await owner.post(`/p/${slugOf(seeded)}/reports`, issue('團隊的單', '說明'));
        const rows = await reportsOf(seeded.project.id);
        expect(rows).toHaveLength(5);
        expect(rows.every((row) => row.merged_into_report_id === null)).toBe(true);
    });

    it('merges per client account through the client API and answers with the kept report', async () => {
        const seeded = await seedProject({ clientUsername: unique('amy'), clientPassword: 'amy-password-123456' });
        const other = await createToken(workerEnv, { clientAccountId: seeded.clientAccount!.id }, 'client cli', Date.now());
        const send = async () => api('POST', `/projects/${slugOf(seeded)}/reports`, other.token, { title: '同一張', description: '一樣的內容' });
        const first = await (await send()).json<{ public_id: string; merged_duplicate: boolean }>();
        expect(first.merged_duplicate).toBe(false);
        const second = await send();
        expect(second.status).toBe(201);
        expect(await second.json()).toMatchObject({ public_id: first.public_id, merged_duplicate: true });
        // 共用客戶身分（沒有帳號）送一樣的內容不是同一人，不併進帳號的單。
        const shared = await new Browser().asClient(seeded);
        await shared.post(`/p/${slugOf(seeded)}/reports`, issue('同一張', '一樣的內容'));
        const rows = await reportsOf(seeded.project.id);
        expect(rows.map((row) => row.merged_into_report_id)).toEqual([null, rows[0].id, null]);
    });

    it('the team merges by hand through the API (CLI merge) and moves pending drafts; mistakes are refused', async () => {
        const seeded = await seedProject();
        const { report: target } = await seedReport(seeded.project, { title: '保留的單' });
        const { report: duplicate } = await seedReport(seeded.project, { title: '重複的單' });
        const { report: third } = await seedReport(seeded.project, { title: '第三張' });
        const at = new Date().toISOString();
        await env.DB.prepare("INSERT INTO message_drafts (report_id, author_name, body, created_at, updated_at) VALUES (?, '開發團隊', '草稿', ?, ?)").bind(duplicate.id, at, at).run();
        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        const merge = (ref: string, into: string) => api('POST', `/projects/${slugOf(seeded)}/reports/${ref}/merge`, token, { into });

        expect((await merge(duplicate.public_id, duplicate.public_id)).status).toBe(422);
        const merged = await merge(duplicate.public_id, '3');
        expect(merged.status).toBe(200);
        const mergedJson = await merged.json();
        expect(mergedJson).toMatchObject({ duplicate: { public_id: duplicate.public_id, number: 2 }, target: { public_id: target.public_id, number: 3 }, moved_drafts: 1 });
        expect((await env.DB.prepare('SELECT report_id FROM message_drafts').first<{ report_id: number }>())?.report_id).toBe(target.id);
        expect(await (await merge(duplicate.public_id, target.public_id)).json()).toMatchObject({ error: 'already_merged' });
        expect(await (await merge(third.public_id, duplicate.public_id)).json()).toMatchObject({ error: 'target_merged' });
        // 客戶帳號不能合併。
        const clientToken = await createToken(workerEnv, { clientAccountId: (await seedProject({ clientUsername: unique('c'), clientPassword: 'client-password-1234' })).clientAccount!.id }, 'x', Date.now());
        expect((await api('POST', `/projects/${slugOf(seeded)}/reports/${third.public_id}/merge`, clientToken.token, { into: target.public_id })).status).toBe(403);
        // 讀單（CLI report）會寫出合併到哪張。
        const detail = await (await api('GET', `/projects/${slugOf(seeded)}/reports/${duplicate.public_id}`, token)).json<{ merged_into: string | null; deleted_by_client: boolean }>();
        expect(detail).toMatchObject({ merged_into: target.public_id, deleted_by_client: true });
    });
});

describe('同一張單只留一則待審留言', () => {
    it('appends new text and files to the existing draft and skips a resend of the last part', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        const upload = async () =>
            (
                await (
                    await exports.default.fetch(
                        new Request(`${BASE}/api/v1/projects/${slugOf(seeded)}/reports/${report.public_id}/uploads?purpose=message`, {
                            method: 'PUT',
                            headers: { authorization: `Bearer ${token}`, 'content-length': String(PNG_BYTES.byteLength), 'x-filename': 'after.png', 'cf-connecting-ip': '10.9.9.9' },
                            body: PNG_BYTES,
                        }),
                    )
                ).json<{ id: string }>()
            ).id;
        const draft = (body: Record<string, unknown>) => api('POST', `/projects/${slugOf(seeded)}/reports/${report.public_id}/drafts`, token, body);
        expect((await draft({ body: '第一段', upload_ids: [await upload()] })).status).toBe(201);
        expect((await draft({ body: '第二段', upload_ids: [await upload()] })).status).toBe(201);
        // 重送最後接上的那段不重複接（只比完全相同，不用子字串判斷）。
        expect((await draft({ body: '第二段' })).status).toBe(201);
        const { results } = await env.DB.prepare('SELECT body, attachments FROM message_drafts WHERE report_id = ?').bind(report.id).all<{ body: string; attachments: string }>();
        expect(results).toHaveLength(1);
        expect(results[0].body).toBe('第一段\n\n第二段');
        expect(JSON.parse(results[0].attachments)).toHaveLength(2);

        const owner = await new Browser().asOwner(seeded);
        const page = await (await owner.get(`/p/${slugOf(seeded)}/reports/${report.public_id}`)).text();
        expect(page).toContain('同一張單的新留言只留一則，之後新增的內容會接在這一則後面；改寫舊留言的草稿另成一則');
    });
});

describe('客戶刪除的單只留紀錄', () => {
    it('drops out of the team list counts, tabs, unread summary and bell, but the page still opens', async () => {
        const seeded = await seedProject();
        const { report: kept } = await seedReport(seeded.project, { title: '留著的單' });
        const { report: deleted } = await seedReport(seeded.project, { title: '客戶刪掉的單' });
        await env.DB.prepare("INSERT INTO messages (report_id, author_type, body, created_at, updated_at) VALUES (?, 'reporter', '刪前留言', ?, ?)").bind(deleted.id, new Date().toISOString(), new Date().toISOString()).run();
        const client = await new Browser().asClient(seeded);
        expect((await client.post(`/p/${slugOf(seeded)}/reports/${deleted.public_id}/client-delete`)).status).toBe(302);

        const owner = await new Browser().asOwner(seeded);
        for (const query of ['?tab=all', '?tab=all&view=board', '?tab=all&deleted=only']) {
            const html = await (await owner.get(`/p/${slugOf(seeded)}${query}`)).text();
            expect(html).toContain(kept.public_id);
            expect(html).not.toContain(`data-report-row="${deleted.public_id}"`);
            expect(html).not.toContain(`data-report-id="${deleted.public_id}"`);
            expect(html).toContain('共 1 題');
            expect(html).toContain('data-portal-tab="all">全部 1</a>');
            expect(html).toContain('目前沒有未讀留言');
            expect(html).not.toContain('data-client-deleted');
            expect(html).not.toContain(`data-bell-item="${deleted.public_id}"`);
        }
        const page = await (await owner.get(`/p/${slugOf(seeded)}/reports/${deleted.public_id}`)).text();
        expect(page).toContain('已刪除・只留紀錄');
        // 命令列 reports --include-deleted 仍查得到。
        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        const listed = await (await api('GET', `/projects/${slugOf(seeded)}/reports?include_deleted=1`, token)).text();
        expect(listed).toContain(deleted.public_id);
    });
});

describe('附件名稱一律編號', () => {
    it('the album explains the numbering and MCP never inlines a video as an image', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const key = `p/${seeded.project.id}/${crypto.randomUUID()}`;
        const mp4 = new Uint8Array(64);
        mp4.set([0, 0, 0, 0x18, ...[...'ftypisom'].map((char) => char.charCodeAt(0))]);
        await env.FILES.put(key, mp4);
        await env.DB.prepare("INSERT INTO attachments (report_id, message_id, kind, object_key, original_name, mime_type, size, created_at) VALUES (?, NULL, 'feedback', ?, '很長的錄影檔名.mp4', 'video/mp4', 64, ?)").bind(report.id, key, new Date().toISOString()).run();
        const owner = await new Browser().asOwner(seeded);
        const page = await (await owner.get(`/p/${slugOf(seeded)}/reports/${report.public_id}`)).text();
        expect(page).toContain('附件依上傳順序稱「圖1、圖2」（影片稱「影片1」），原始附件與每則留言各自從 1 起算；下載時仍是原始檔名。');
        expect(page).not.toContain('很長的錄影檔名');

        const { developer } = await seedDeveloper();
        const token = await seedToken(developer);
        const result = await rpcResult<{ content: Array<{ type: string }> }>(await mcpCall(token, 'tools/call', { name: 'get_report', arguments: { project: slugOf(seeded), report: report.public_id, include_images: true } }));
        expect(result.content.filter((item) => item.type === 'image')).toHaveLength(0);
    });
});
