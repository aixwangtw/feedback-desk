import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { pruneStaleUploads } from '../../src/worker/lib/uploads';
import { boardColumnHtml, listHtml } from '../../src/worker/views/rows-client';
import { Browser, JPEG_BYTES, PNG_BYTES, seedAttachment, seedProject, seedReport, WEBP_BYTES, workerEnv } from './helpers';

const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);

describe('uploads', () => {
    it('accepts jpg, png and webp by their bytes and rejects anything else', async () => {
        const seeded = await seedProject();
        const client = await new Browser().asClient(seeded);
        for (const bytes of [PNG_BYTES, JPEG_BYTES, WEBP_BYTES]) {
            expect((await client.upload(seeded.project.slug, 'purpose=report', bytes)).status).toBe(201);
        }
        const gif = await client.upload(seeded.project.slug, 'purpose=report', GIF, 'fake.png');
        expect(gif.status).toBe(415);
        expect(((await gif.json()) as { message: string }).message).toContain('jpg、png 或 webp');
        const text = await client.upload(seeded.project.slug, 'purpose=report', new TextEncoder().encode('<script>alert(1)</script>'), 'x.jpg');
        expect(text.status).toBe(415);
    });

    it('rejects files over 10 MB before reading them and needs Content-Length', async () => {
        const seeded = await seedProject();
        const client = await new Browser().asClient(seeded);
        const tooBig = await client.request('PUT', `/p/${seeded.project.slug}/uploads?purpose=report`, {
            body: PNG_BYTES,
            headers: { 'content-length': String(10 * 1024 * 1024 + 1) },
        });
        expect(tooBig.status).toBe(413);
        const stream = new ReadableStream({ start(controller) { controller.enqueue(PNG_BYTES); controller.close(); } });
        const noLength = await client.request('PUT', `/p/${seeded.project.slug}/uploads?purpose=report`, { body: stream });
        expect([400, 411]).toContain(noLength.status);
    });

    it('only lets people who may write there upload', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const guest = new Browser();
        expect((await guest.upload(seeded.project.slug, 'purpose=report')).status).toBe(403);
        const client = await new Browser().asClient(seeded);
        expect((await client.upload(seeded.project.slug, `purpose=adjustment&report=${report.public_id}`)).status).toBe(403);
        expect((await client.upload(seeded.project.slug, `purpose=message&report=${report.public_id}`)).status).toBe(201);
        expect((await client.upload(seeded.project.slug, 'purpose=public')).status).toBe(404);
        const owner = await new Browser().asOwner(seeded);
        expect((await owner.upload(seeded.project.slug, `purpose=adjustment&report=${report.public_id}`)).status).toBe(201);
    });

    it('creates several reports at once with their own screenshots', async () => {
        const seeded = await seedProject();
        const client = await new Browser().asClient(seeded);
        const a = await client.uploadId(seeded.project.slug, 'purpose=report', PNG_BYTES, '第一張.png');
        const b = await client.uploadId(seeded.project.slug, 'purpose=report', JPEG_BYTES, 'b.jpg');
        const response = await client.post(`/p/${seeded.project.slug}/reports`, {
            'issues[0][title]': '問題一',
            'issues[0][description]': '說明一',
            'issues[0][upload_ids][]': [a, b],
            'issues[1][title]': '問題二',
            'issues[1][description]': '說明二',
        });
        expect(response.status).toBe(302);
        const reports = await env.DB.prepare('SELECT id, title FROM reports WHERE project_id = ? ORDER BY id').bind(seeded.project.id).all<{ id: number; title: string }>();
        expect(reports.results.map((row) => row.title)).toEqual(['問題一', '問題二']);
        const attachments = await env.DB.prepare('SELECT original_name, mime_type FROM attachments WHERE report_id = ? ORDER BY id').bind(reports.results[0].id).all();
        expect(attachments.results).toEqual([
            { original_name: '第一張.png', mime_type: 'image/png' },
            { original_name: 'b.jpg', mime_type: 'image/jpeg' },
        ]);
        expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM uploads WHERE id IN (?, ?)').bind(a, b).first('n')).toBe(0);
        const portal = await (await client.get(`/p/${seeded.project.slug}`)).text();
        expect(portal).toContain('已新增 2 個問題。');
    });

    it('refuses uploads that belong to another project, were already used or are unknown', async () => {
        const mine = await seedProject();
        const other = await seedProject();
        const otherClient = await new Browser().asClient(other);
        const foreign = await otherClient.uploadId(other.project.slug, 'purpose=report');
        const client = await new Browser().asClient(mine);
        const response = await client.post(`/p/${mine.project.slug}/reports`, { 'issues[0][title]': 't', 'issues[0][description]': 'd', 'issues[0][upload_ids][]': foreign });
        expect(response.status).toBe(422);
        expect(await response.text()).toContain('截圖上傳已失效');
        const own = await client.uploadId(mine.project.slug, 'purpose=report');
        expect((await client.post(`/p/${mine.project.slug}/reports`, { 'issues[0][title]': 't', 'issues[0][description]': 'd', 'issues[0][upload_ids][]': own })).status).toBe(302);
        const reuse = await client.post(`/p/${mine.project.slug}/reports`, { 'issues[0][title]': 't2', 'issues[0][description]': 'd', 'issues[0][upload_ids][]': own });
        expect(reuse.status).toBe(422);
    });

    it('limits each report to five screenshots, also when editing', async () => {
        const seeded = await seedProject();
        const client = await new Browser().asClient(seeded);
        const ids: string[] = [];
        for (let i = 0; i < 6; i++) ids.push(await client.uploadId(seeded.project.slug, 'purpose=report'));
        const tooMany = await client.post(`/p/${seeded.project.slug}/reports`, { 'issues[0][title]': 't', 'issues[0][description]': 'd', 'issues[0][upload_ids][]': ids });
        expect(tooMany.status).toBe(422);
        expect(await tooMany.text()).toContain('截圖 最多只能有 5 項。');

        const { report } = await seedReport(seeded.project);
        for (let i = 0; i < 4; i++) await seedAttachment(report);
        const edit = await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/update`, { title: '新標題', description: 'd', 'upload_ids[]': ids.slice(0, 2) });
        expect(edit.status).toBe(422);
        const html = await edit.text();
        expect(html).toContain('截圖總數不可超過 5 張。');
        expect(html).toContain(`id="edit-report-${report.public_id}"`);
        expect(html).toMatch(new RegExp(`id="edit-report-${report.public_id}"[^>]*data-open-on-load`));
    });

    it('edits title, description and screenshots; cannot remove attachments of other reports', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const { report: other } = await seedReport(seeded.project);
        const keep = await seedAttachment(report);
        const remove = await seedAttachment(report);
        const foreign = await seedAttachment(other);
        const client = await new Browser().asClient(seeded);
        const bad = await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/update`, { title: 't', description: 'd', 'remove_attachments[]': String(foreign) });
        expect(bad.status).toBe(422);
        const added = await client.uploadId(seeded.project.slug, 'purpose=report');
        const ok = await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/update`, {
            title: '  新標題  ',
            description: '新說明',
            'remove_attachments[]': String(remove),
            'upload_ids[]': added,
            _back: `/p/${seeded.project.slug}?status=new`,
        });
        expect(ok.status).toBe(302);
        expect(ok.headers.get('location')).toBe(`/p/${seeded.project.slug}?status=new`);
        const row = await env.DB.prepare('SELECT title, description FROM reports WHERE id = ?').bind(report.id).first();
        expect(row).toEqual({ title: '新標題', description: '新說明' });
        const ids = (await env.DB.prepare('SELECT id FROM attachments WHERE report_id = ? ORDER BY id').bind(report.id).all<{ id: number }>()).results.map((r) => r.id);
        expect(ids).toContain(keep);
        expect(ids).not.toContain(remove);
        expect(ids.length).toBe(2);
    });

    it('serves attachments privately with safe headers', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const id = await seedAttachment(report);
        const path = `/p/${seeded.project.slug}/reports/${report.public_id}/attachments/${id}`;
        expect((await new Browser().get(path)).status).toBe(302);
        const client = await new Browser().asClient(seeded);
        const response = await client.get(path);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
    });

    it('cleans up uploads that were never attached', async () => {
        const seeded = await seedProject();
        const client = await new Browser().asClient(seeded);
        const id = await client.uploadId(seeded.project.slug, 'purpose=report');
        const row = await env.DB.prepare('SELECT object_key FROM uploads WHERE id = ?').bind(id).first<{ object_key: string }>();
        await env.DB.prepare("UPDATE uploads SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(id).run();
        expect(await pruneStaleUploads(workerEnv, Date.now())).toBeGreaterThanOrEqual(1);
        expect(await env.DB.prepare('SELECT id FROM uploads WHERE id = ?').bind(id).first()).toBeNull();
        expect(await env.FILES.get(row!.object_key)).toBeNull();
    });
});

describe('reports', () => {
    it('validates in Chinese and reopens the new-issue dialog', async () => {
        const seeded = await seedProject();
        const client = await new Browser().asClient(seeded);
        const response = await client.post(`/p/${seeded.project.slug}/reports`, { 'issues[0][title]': '', 'issues[0][description]': 'x'.repeat(10001) });
        expect(response.status).toBe(422);
        const html = await response.text();
        expect(html).toContain('問題標題 為必填。');
        expect(html).toContain('問題說明 不能超過 10000 個字元。');
        expect(html).toMatch(/id="new-issues"[^>]*data-open-on-load/);
    });

    it('changes status from the list with JSON and returns project counts', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        await seedReport(seeded.project);
        const client = await new Browser().asClient(seeded);
        const response = await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/status`, { status: 'completed' }, { accept: 'application/json' });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ status: 'completed', label: '已完成', counts: { new: 1, needs_input: 0, completed: 1 }, message: '狀態已更新為「已完成」。' });
        const row = await env.DB.prepare('SELECT status, completed_at FROM reports WHERE id = ?').bind(report.id).first<{ status: string; completed_at: string | null }>();
        expect(row?.status).toBe('completed');
        expect(row?.completed_at).toBeTruthy();
        const invalid = await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/status`, { status: 'in_progress' }, { accept: 'application/json' });
        expect(invalid.status).toBe(422);
    });

    it('lists, searches, filters and sorts with stable numbers', async () => {
        const seeded = await seedProject();
        const now = Date.now();
        await seedReport(seeded.project, { title: 'Alpha 按鈕', at: now - 3000 });
        await seedReport(seeded.project, { title: 'Beta 版面', description: '50% 寬度', at: now - 2000 });
        await seedReport(seeded.project, { title: 'Gamma 顏色', creator: 'public', reporterName: '路人', at: now - 1000 });
        const owner = await new Browser().asOwner(seeded);
        const all = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        expect(all).toContain('共 3 題');
        expect(all).toContain('公開回報（路人）');
        const search = await (await owner.get(`/p/${seeded.project.slug}?q=50%25`)).text();
        expect(search).toContain('Beta 版面');
        expect(search).not.toContain('Alpha 按鈕');
        expect(search).toContain('（篩選後 1 題）');
        expect(search).toMatch(/data-report-number="true">2</);
        const sorted = await (await owner.get(`/p/${seeded.project.slug}?sort=title&direction=asc`)).text();
        expect(sorted.indexOf('Alpha 按鈕')).toBeLessThan(sorted.indexOf('Beta 版面'));
        const creator = await (await owner.get(`/p/${seeded.project.slug}?creator=public&view=board`)).text();
        expect(creator).toContain('Gamma 顏色');
        expect(creator).not.toContain('Alpha 按鈕');
        expect(creator).toContain('data-kanban-board');
    });

    it('loads report dialogs on demand with the right actions per role', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project, { title: '對話框' });
        await seedAttachment(report);
        const owner = await new Browser().asOwner(seeded);
        const list = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        expect(list).not.toContain(`id="edit-report-${report.public_id}"`);
        expect(list).toContain(`data-dialogs-src="/p/${seeded.project.slug}/reports/${report.public_id}/dialogs?back=`);
        const ownerDialogs = await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}/dialogs?back=%2Fp%2F${seeded.project.slug}%3Fstatus%3Dnew`)).text();
        expect(ownerDialogs).toContain(`id="detail-report-${report.public_id}"`);
        expect(ownerDialogs).toContain(`id="delete-report-${report.public_id}"`);
        expect(ownerDialogs).toContain(`value="/p/${seeded.project.slug}?status=new"`);
        expect(ownerDialogs).toContain('建立者：客戶');
        const client = await new Browser().asClient(seeded);
        const clientDialogs = await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}/dialogs?back=//evil.example`)).text();
        expect(clientDialogs).toContain(`id="client-delete-report-${report.public_id}"`);
        expect(clientDialogs).not.toContain('建立者');
        expect(clientDialogs).not.toContain('evil.example');
        expect((await new Browser().get(`/p/${seeded.project.slug}/reports/${report.public_id}/dialogs`)).status).toBe(302);
    });

    it('paginates 50 per page; long pages send rows as JSON that the browser builds with the same markup', async () => {
        const seeded = await seedProject();
        const now = Date.now();
        for (let i = 0; i < 52; i++) {
            await seedReport(seeded.project, { title: `單 ${i} <x>`, at: now - i * 1000 });
        }
        const owner = await new Browser().asOwner(seeded);
        const first = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        expect(first).not.toContain('data-report-row=');
        expect(first).toContain('共 <span class="font-medium">52</span> 筆');
        const json = /<script type="application\/json" id="portal-rows-data">(.*?)<\/script>/s.exec(first)![1];
        expect(json).not.toContain('<x>');
        const payload = JSON.parse(json);
        expect(payload.rows).toHaveLength(50);
        const html = listHtml(payload);
        expect(html.match(/data-report-row=/g)?.length).toBe(50);
        expect(html).toContain('單 0 &lt;x&gt;');
        expect(html).toContain('data-dialogs-src=');
        expect(JSON.stringify(payload)).not.toContain('reporter_token_hash');
        const board = await (await owner.get(`/p/${seeded.project.slug}?view=board`)).text();
        const boardPayload = JSON.parse(/id="portal-rows-data">(.*?)<\/script>/s.exec(board)![1]);
        expect(boardColumnHtml(boardPayload, 'new').match(/data-kanban-card=/g)?.length).toBe(50);
        const second = await (await owner.get(`/p/${seeded.project.slug}?page=2`)).text();
        expect(second.match(/data-report-row=/g)?.length).toBe(2);
        expect(second).not.toContain('portal-rows-data');
    });

    it('team writes the adjustment; clients see it read-only and cannot change it', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const client = await new Browser().asClient(seeded);
        const before = await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        expect(before).not.toContain('id="adjustment"');
        expect((await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/adjustment`, { adjustment_note: 'x' })).status).toBe(403);
        expect((await client.upload(seeded.project.slug, `purpose=adjustment&report=${report.public_id}`)).status).toBe(403);

        const owner = await new Browser().asOwner(seeded);
        const image = await owner.uploadId(seeded.project.slug, `purpose=adjustment&report=${report.public_id}`);
        const save = await owner.post(`/p/${seeded.project.slug}/reports/${report.public_id}/adjustment`, { adjustment_note: '已調整按鈕位置', 'upload_ids[]': image });
        expect(save.headers.get('location')).toBe(`/p/${seeded.project.slug}/reports/${report.public_id}#adjustment`);
        const row = await env.DB.prepare('SELECT adjustment_note, status FROM reports WHERE id = ?').bind(report.id).first();
        expect(row).toEqual({ adjustment_note: '已調整按鈕位置', status: 'new' });

        const after = await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        expect(after).toContain('已調整按鈕位置');
        expect(after).toContain('data-adjustment-image');
        expect(after).not.toContain('data-adjustment-editor');
        // An adjustment upload cannot be used as an ordinary screenshot.
        const adjustmentAttachment = await env.DB.prepare("SELECT id FROM attachments WHERE report_id = ? AND kind = 'adjustment'").bind(report.id).first<{ id: number }>();
        const misuse = await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/update`, { title: 't', description: 'd', 'remove_attachments[]': String(adjustmentAttachment!.id) });
        expect(misuse.status).toBe(422);
    });

    it('messages carry the author and their images', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const client = await new Browser().asClient(seeded);
        const image = await client.uploadId(seeded.project.slug, `purpose=message&report=${report.public_id}`);
        const response = await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: '補充步驟', 'upload_ids[]': image });
        expect(response.status).toBe(302);
        const message = await env.DB.prepare('SELECT id, author_type, author_name FROM messages WHERE report_id = ?').bind(report.id).first<{ id: number }>();
        expect(message).toMatchObject({ author_type: 'reporter', author_name: '客戶' });
        expect(await env.DB.prepare('SELECT message_id FROM attachments WHERE report_id = ?').bind(report.id).first('message_id')).toBe(message!.id);
        const activity = await (await client.get(`/p/${seeded.project.slug}/reports/${report.public_id}/activity`)).text();
        expect(activity).toContain('補充步驟');
        // A message upload for another report cannot be attached here.
        const { report: other } = await seedReport(seeded.project);
        const otherImage = await client.uploadId(seeded.project.slug, `purpose=message&report=${other.public_id}`);
        expect((await client.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: 'x', 'upload_ids[]': otherImage })).status).toBe(422);
    });

    it('formats times in Taipei time without Intl', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project, { at: Date.parse('2026-10-14T02:30:00Z') });
        const owner = await new Browser().asOwner(seeded);
        const html = await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        expect(html).toContain('2026/10/14 10:30');
        expect(html).toContain('（台北時間）');
    });
});
