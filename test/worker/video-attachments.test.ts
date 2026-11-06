import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { detectAttachmentType, fileProblem, isVideoMime, maxBytesFor, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, MESSAGE_ACCEPT, MESSAGE_HINT, storedMime } from '../../src/shared/attachment-rules';
import type { Report } from '../../src/worker/lib/models';
import { api, BASE, Browser, PNG_BYTES, seedDeveloper, seedProject, seedReport, seedToken, unique, type SeededProject } from './helpers';

/**
 * 留言與待審留言可以附 mp4 影片：對應 Laravel 版 FeedbackVideoAttachmentTest。
 * 影片每支 50 MB、圖片每張 10 MB；留言串與待審留言用 <video> 直接播放；附件網址支援 Range（206）。
 * 開單、調整重點、公開回報仍只收圖片。
 */
function mp4Bytes(size = 4096, brand = 'isom'): Uint8Array {
    const bytes = new Uint8Array(size);
    bytes.set([0x00, 0x00, 0x00, 0x18], 0);
    bytes.set([...'ftyp'].map((char) => char.charCodeAt(0)), 4);
    bytes.set([...brand].map((char) => char.charCodeAt(0)), 8);
    for (let i = 12; i < size; i++) bytes[i] = i % 251;
    return bytes;
}

const MP4 = mp4Bytes();
const VIDEO_TAG = '<video controls="" playsinline="" preload="metadata"';

async function setup() {
    const seeded = await seedProject();
    const { report } = await seedReport(seeded.project, { title: '要附教學影片的單' });
    const { developer } = await seedDeveloper(unique('alex'), undefined, 'Alex');
    const token = await seedToken(developer);
    return { seeded, report, token };
}

/** Same request as the CLI's `--attach` upload: one PUT per file to the team API. */
async function apiUpload(token: string, seeded: SeededProject, report: Report, bytes: Uint8Array, name: string, purpose = 'message', declaredType = 'video/mp4'): Promise<Response> {
    return exports.default.fetch(
        new Request(`${BASE}/api/v1/projects/${seeded.project.slug}/reports/${report.public_id}/uploads?purpose=${purpose}`, {
            method: 'PUT',
            headers: { authorization: `Bearer ${token}`, 'content-type': declaredType, 'content-length': String(bytes.byteLength), 'x-filename': encodeURIComponent(name), 'cf-connecting-ip': '10.9.9.9' },
            body: bytes,
        }),
    );
}

async function attachmentsOf(report: Report) {
    return (await env.DB.prepare('SELECT id, message_id, mime_type, size, original_name FROM attachments WHERE report_id = ? ORDER BY id').bind(report.id).all<{ id: number; message_id: number | null; mime_type: string; size: number; original_name: string }>()).results;
}

describe('留言附 mp4 影片', () => {
    it('the team API message with an mp4 is stored as video/mp4 and both sides get a player', async () => {
        const { seeded, report, token } = await setup();
        for (const declared of ['video/mp4', 'application/mp4']) {
            const uploaded = await apiUpload(token, seeded, report, MP4, `操作示範-${declared.split('/')[0]}.mp4`, 'message', declared);
            expect(uploaded.status).toBe(201);
            expect(((await uploaded.json()) as { mime_type: string }).mime_type).toBe('video/mp4');
            const id = ((await (await apiUpload(token, seeded, report, MP4, 'b.mp4')).json()) as { id: string }).id;
            const posted = await api('POST', `/projects/${seeded.project.slug}/reports/${report.public_id}/messages`, token, { body: `看影片 ${declared}`, upload_ids: [id] });
            expect(posted.status).toBe(200);
        }
        const attachments = await attachmentsOf(report);
        expect(attachments.map((row) => row.mime_type)).toEqual(['video/mp4', 'video/mp4']);
        expect(attachments.every((row) => row.message_id !== null)).toBe(true);

        const url = `/p/${seeded.project.slug}/reports/${report.public_id}/attachments/${attachments[0].id}`;
        for (const browser of [await new Browser().asOwner(seeded), await new Browser().asClient(seeded)]) {
            const page = await (await browser.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
            expect(page).toContain(`${VIDEO_TAG} src="${url}"`);
            const thread = (await (await browser.get(`/p/${seeded.project.slug}/conversations/${report.public_id}`, { accept: 'application/json' })).json()) as { html: string };
            expect(thread.html).toContain(VIDEO_TAG);
            const file = await browser.get(url);
            expect(file.status).toBe(200);
            expect(file.headers.get('content-type')).toBe('video/mp4');
            expect(file.headers.get('accept-ranges')).toBe('bytes');
            expect(new Uint8Array(await file.arrayBuffer())).toEqual(MP4);
        }
    });

    it('answers Range requests with 206 so the player can seek', async () => {
        const { seeded, report, token } = await setup();
        const id = ((await (await apiUpload(token, seeded, report, MP4, 'seek.mp4')).json()) as { id: string }).id;
        await api('POST', `/projects/${seeded.project.slug}/reports/${report.public_id}/messages`, token, { body: '拖拉進度', upload_ids: [id] });
        const [attachment] = await attachmentsOf(report);
        const url = `/p/${seeded.project.slug}/reports/${report.public_id}/attachments/${attachment.id}`;
        const client = await new Browser().asClient(seeded);

        const middle = await client.get(url, { range: 'bytes=100-199' });
        expect(middle.status).toBe(206);
        expect(middle.headers.get('content-range')).toBe(`bytes 100-199/${MP4.byteLength}`);
        expect(middle.headers.get('content-length')).toBe('100');
        expect(middle.headers.get('accept-ranges')).toBe('bytes');
        expect(new Uint8Array(await middle.arrayBuffer())).toEqual(MP4.slice(100, 200));

        const open = await client.get(url, { range: 'bytes=4000-' });
        expect(open.status).toBe(206);
        expect(open.headers.get('content-range')).toBe(`bytes 4000-4095/${MP4.byteLength}`);
        expect(new Uint8Array(await open.arrayBuffer())).toEqual(MP4.slice(4000));

        const suffix = await client.get(url, { range: 'bytes=-10' });
        expect(suffix.status).toBe(206);
        expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(MP4.slice(-10));

        const beyond = await client.get(url, { range: 'bytes=999999-' });
        expect(beyond.status).toBe(416);
        expect(beyond.headers.get('content-range')).toBe(`bytes */${MP4.byteLength}`);

        // Multiple ranges or junk: the whole file, as without Range.
        const junk = await client.get(url, { range: 'bytes=0-1,5-6' });
        expect(junk.status).toBe(200);
        expect((await junk.arrayBuffer()).byteLength).toBe(MP4.byteLength);
    });

    it('a draft with an mp4 shows a player to the team and sending carries the video into the message', async () => {
        const { seeded, report, token } = await setup();
        const id = ((await (await apiUpload(token, seeded, report, MP4, 'draft.mp4')).json()) as { id: string }).id;
        const created = await api('POST', `/projects/${seeded.project.slug}/reports/${report.public_id}/drafts`, token, { body: '草稿附影片', upload_ids: [id] });
        expect(created.status).toBe(201);
        const draft = await env.DB.prepare('SELECT id, attachments FROM message_drafts WHERE report_id = ?').bind(report.id).first<{ id: number; attachments: string }>();
        expect(JSON.parse(draft!.attachments)[0].mime_type).toBe('video/mp4');

        const owner = await new Browser().asOwner(seeded);
        const page = await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
        const fileUrl = `/p/${seeded.project.slug}/reports/${report.public_id}/drafts/${draft!.id}/files/0`;
        expect(page).toContain(`${VIDEO_TAG} src="${fileUrl}"`);
        const draftFile = await owner.get(fileUrl, { range: 'bytes=0-11' });
        expect(draftFile.status).toBe(206);

        expect((await owner.post(`/p/${seeded.project.slug}/reports/${report.public_id}/drafts/${draft!.id}/send`, {}, { accept: 'application/json' })).status).toBe(200);
        const [attachment] = await attachmentsOf(report);
        expect(attachment).toMatchObject({ mime_type: 'video/mp4', size: MP4.byteLength });
        expect(attachment.message_id).not.toBeNull();
    });

    it('web message and chat panel uploads take mp4 for both sides; the forms say so', async () => {
        const { seeded, report } = await setup();
        for (const browser of [await new Browser().asOwner(seeded), await new Browser().asClient(seeded)]) {
            const id = await browser.uploadId(seeded.project.slug, `purpose=message&report=${report.public_id}`, MP4, '錄影.mp4');
            const posted = await browser.post(`/p/${seeded.project.slug}/reports/${report.public_id}/messages`, { body: '附影片', 'upload_ids[]': id }, { accept: 'application/json' });
            expect(posted.status).toBe(201);
            const page = await (await browser.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text();
            expect(page).toContain(`id="message-screenshots" type="file" accept="${MESSAGE_ACCEPT}"`);
            expect(page).toContain(`id="chat-screenshots" type="file" accept="${MESSAGE_ACCEPT}"`);
            // 可附影片的地方：按鈕寫「附件」、提示寫圖片或影片的上限（數字來自共用常數）。
            expect(page).toMatch(/>附件<input id="message-screenshots"/);
            expect(page).toMatch(/>附件<input id="chat-screenshots"/);
            expect(page.split(MESSAGE_HINT).length - 1).toBeGreaterThanOrEqual(2);
            expect(page).not.toContain('最多 5 張，每張 10 MB');
            // 清單／看板的詳情視窗（開啟時才載入）。
            const dialogs = await (await browser.get(`/p/${seeded.project.slug}/reports/${report.public_id}/dialogs`)).text();
            expect(dialogs).toContain(`accept="${MESSAGE_ACCEPT}"`);
            expect(dialogs).toMatch(/>附件<input id="dialog-screenshots-/);
            expect(dialogs).toContain(MESSAGE_HINT);
        }
        expect((await attachmentsOf(report)).map((row) => row.mime_type)).toEqual(['video/mp4', 'video/mp4']);
    });

    it('limits: video 50 MB, image 10 MB; other video formats and HEIC are refused', async () => {
        const { seeded, report, token } = await setup();
        const owner = await new Browser().asOwner(seeded);
        const tooBigVideo = await owner.request('PUT', `/p/${seeded.project.slug}/uploads?purpose=message&report=${report.public_id}`, {
            body: MP4,
            headers: { 'content-length': String(MAX_VIDEO_BYTES + 1), accept: 'application/json' },
        });
        expect(tooBigVideo.status).toBe(413);

        const bigImage = new Uint8Array(MAX_IMAGE_BYTES + 1);
        bigImage.set(PNG_BYTES.slice(0, 8));
        const tooBigImage = await apiUpload(token, seeded, report, bigImage, 'big.png', 'message', 'image/png');
        expect(tooBigImage.status).toBe(413);
        expect(((await tooBigImage.json()) as { message: string }).message).toContain('10 MB');

        for (const [bytes, name] of [[mp4Bytes(64, 'qt  '), 'clip.mov'], [mp4Bytes(64, 'heic'), 'photo.heic'], [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]), 'clip.webm']] as const) {
            expect((await apiUpload(token, seeded, report, bytes, name)).status).toBe(415);
        }
        expect(await attachmentsOf(report)).toHaveLength(0);
    });

    it('new reports, adjustments and public reporting still take images only', async () => {
        const { seeded, report, token } = await setup();
        expect((await apiUpload(token, seeded, report, MP4, 'a.mp4', 'adjustment')).status).toBe(415);
        const owner = await new Browser().asOwner(seeded);
        expect((await owner.upload(seeded.project.slug, 'purpose=report', MP4, 'a.mp4')).status).toBe(415);
        expect((await owner.upload(seeded.project.slug, `purpose=adjustment&report=${report.public_id}`, MP4, 'a.mp4')).status).toBe(415);

        const open = await seedProject({ client: false, publicReporting: true });
        const stranger = new Browser(undefined, { FEEDBACK_HOME_PUBLIC_PROJECT: open.project.slug });
        expect((await stranger.post('/public-reports', { title: '首頁按鈕太小', description: '手機上不好按' })).status).toBe(302);
        const publicReport = (await env.DB.prepare("SELECT * FROM reports WHERE project_id = ? AND creator_type = 'public' ORDER BY id DESC LIMIT 1").bind(open.project.id).first<Report>()) as Report;
        // 公開回報者能附圖（確認身分沒問題），但不收影片。
        expect((await stranger.upload(open.project.slug, `purpose=message&report=${publicReport.public_id}`)).status).toBe(201);
        expect((await stranger.upload(open.project.slug, `purpose=message&report=${publicReport.public_id}`, MP4, 'a.mp4')).status).toBe(415);
        expect((await stranger.upload(open.project.slug, 'purpose=public', MP4, 'a.mp4')).status).toBe(415);

        const portal = await (await owner.get(`/p/${seeded.project.slug}`)).text();
        expect(portal).toMatch(/id="issue-screenshots-0" type="file" accept="image\/jpeg,image\/png,image\/webp"/);
        // 只收圖片的地方維持原本的字。
        expect(portal).toContain('＋ 上傳截圖');
        expect(portal).toContain('最多 5 張，每張 10 MB');
    });
});

describe('附件規則的純邏輯', () => {
    it('detects mp4 by its ftyp brand only where video is allowed', () => {
        expect(detectAttachmentType(MP4, true)).toBe('video/mp4');
        expect(detectAttachmentType(MP4, false)).toBeNull();
        expect(detectAttachmentType(mp4Bytes(32, 'mp42'), true)).toBe('video/mp4');
        expect(detectAttachmentType(mp4Bytes(32, 'heic'), true)).toBeNull();
        expect(detectAttachmentType(mp4Bytes(32, 'qt  '), true)).toBeNull();
        expect(detectAttachmentType(PNG_BYTES, true)).toBe('image/png');
    });

    it('treats video/mp4 and application/mp4 alike and stores video/mp4', () => {
        expect(isVideoMime('application/mp4')).toBe(true);
        expect(isVideoMime('video/webm')).toBe(false);
        expect(storedMime('application/mp4')).toBe('video/mp4');
        expect(storedMime('image/png')).toBe('image/png');
        expect(maxBytesFor('video/mp4')).toBe(50 * 1024 * 1024);
        expect(maxBytesFor('image/jpeg')).toBe(10 * 1024 * 1024);
    });

    it('checks files in the browser the same way: count, type, 50 MB per video, 10 MB per image', () => {
        const message = { maxFiles: 5, maxImageBytes: MAX_IMAGE_BYTES, allowVideo: true };
        const video = (size: number, type = 'video/mp4') => ({ name: 'v.mp4', type, size });
        const image = (size: number) => ({ name: 'a.png', type: 'image/png', size });
        expect(fileProblem([video(MAX_VIDEO_BYTES), image(MAX_IMAGE_BYTES)], message)).toBeNull();
        expect(fileProblem([video(1, 'application/mp4')], message)).toBeNull();
        expect(fileProblem([video(MAX_VIDEO_BYTES + 1)], message)).toBe('「v.mp4」太大：每支影片不可超過 50 MB。');
        expect(fileProblem([image(MAX_IMAGE_BYTES + 1)], message)).toBe('「a.png」太大：每張圖片不可超過 10 MB。');
        expect(fileProblem([video(1, 'video/webm')], message)).toBe('附件只接受 JPG、PNG、WebP 圖片或 MP4 影片。');
        expect(fileProblem(Array.from({ length: 6 }, () => image(1)), message)).toBe('一次最多附 5 個檔案。');
        expect(MESSAGE_HINT).toBe('圖片或影片，最多 5 個；圖片每個 10 MB、影片每個 50 MB');
        expect(fileProblem([video(1)], { ...message, allowVideo: false })).toBe('附圖只接受 JPG、PNG、WebP。');
    });
});

describe('附件縮圖支援影片', () => {
    async function withReportVideo() {
        const { seeded, report } = await setup();
        const key = `p/${seeded.project.id}/${crypto.randomUUID()}`;
        await env.FILES.put(key, MP4, { httpMetadata: { contentType: 'video/mp4' } });
        const row = await env.DB.prepare("INSERT INTO attachments (report_id, message_id, kind, object_key, original_name, mime_type, size, created_at) VALUES (?, NULL, 'feedback', ?, '開單錄影.mp4', 'video/mp4', ?, ?) RETURNING id")
            .bind(report.id, key, MP4.byteLength, new Date().toISOString())
            .first<{ id: number }>();
        return { seeded, report, url: `/p/${seeded.project.slug}/reports/${report.public_id}/attachments/${row!.id}` };
    }

    it('list, board, detail dialog and report page show the first frame with a play mark instead of an <img>', async () => {
        const { seeded, report, url } = await withReportVideo();
        const owner = await new Browser().asOwner(seeded);
        const thumb = `<video muted="" playsinline="" preload="metadata" src="${url}#t=0.1"`;
        const pages = {
            list: await (await owner.get(`/p/${seeded.project.slug}?tab=all`)).text(),
            board: await (await owner.get(`/p/${seeded.project.slug}?tab=all&view=board`)).text(),
            dialogs: await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}/dialogs`)).text(),
            page: await (await owner.get(`/p/${seeded.project.slug}/reports/${report.public_id}`)).text(),
        };
        for (const [name, html] of Object.entries(pages)) {
            expect(html, name).toContain(thumb);
            expect(html, name).toContain('data-attachment-video');
            expect(html, name).toContain('影片：開單錄影.mp4');
            expect(html, name).not.toContain(`<img src="${url}"`);
        }
        expect(pages.list).toContain('>附件</th>');
        expect(pages.list).not.toContain('>圖片</th>');
        expect(pages.list).toContain('影片點了會開新分頁播放');
        expect(pages.board).toContain('影片點了會開新分頁播放');
    });
});

