import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { Author } from '../../src/worker/lib/access';
import { createDraft, sendDraft, type MessageDraft } from '../../src/worker/lib/drafts';
import { autoMergeDuplicate, mergeReport } from '../../src/worker/lib/merge';
import type { Report, Upload } from '../../src/worker/lib/models';
import { createReport } from '../../src/worker/lib/reports';
import { ServiceError } from '../../src/worker/lib/team';
import { Browser, seedAttachment, seedProject, seedReport, unique, workerEnv, type SeededProject } from './helpers';

/**
 * 2026-11-25 程式審查修正（對應 Laravel 版同一批）：
 * - 新留言草稿與改寫草稿分開，送出時不會覆蓋舊留言（情境 A、B、C）；重複判斷改成完全相同；附件超過每則上限另存或回錯誤。
 * - 合併時原始附件搬到保留的單；已完成的單不自動合併；沒有帳號的不自動合併；客戶的單不能併進客戶看不到的單。
 * - 手動合併搬草稿照同一套規則；合併整批第一句是防護條件，失敗時不留下半套變更。
 */
const team: Author = { developerId: null, clientAccountId: null, name: 'Alex', agent: 'Claude Code' };
const sender = { author: team, developerName: null };

async function teamMessage(report: Report, body: string): Promise<number> {
    const at = new Date().toISOString();
    const row = await env.DB.prepare("INSERT INTO messages (report_id, author_type, author_name, body, created_at, updated_at) VALUES (?, 'owner', 'Alex', ?, ?, ?) RETURNING id")
        .bind(report.id, body, at, at)
        .first<{ id: number }>();
    return row?.id ?? 0;
}

async function messageBody(id: number): Promise<string | null> {
    return (await env.DB.prepare('SELECT body FROM messages WHERE id = ?').bind(id).first<{ body: string }>())?.body ?? null;
}

async function draftsOf(report: Report): Promise<MessageDraft[]> {
    return (await env.DB.prepare('SELECT * FROM message_drafts WHERE report_id = ? ORDER BY id').bind(report.id).all<MessageDraft>()).results;
}

async function reloadReport(report: Report): Promise<Report> {
    return (await env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(report.id).first<Report>()) as Report;
}

function fakeUploads(seeded: SeededProject, count: number): Upload[] {
    return Array.from({ length: count }, (_, index) => ({
        id: crypto.randomUUID(),
        project_id: seeded.project.id,
        report_id: null,
        purpose: 'message' as const,
        object_key: `p/${seeded.project.id}/${crypto.randomUUID()}`,
        original_name: `shot${index + 1}.png`,
        mime_type: 'image/png',
        size: 1,
        created_at: new Date().toISOString(),
    }));
}

function storedFiles(count: number): string {
    return JSON.stringify(Array.from({ length: count }, (_, index) => ({ object_key: `k${index}`, original_name: `f${index}.png`, mime_type: 'image/png', size: 1 })));
}

const draft = (report: Report, body: string, replacesMessageId: number | null = null, uploads: Upload[] = []) => createDraft(workerEnv, report, { body, replacesMessageId, uploads, author: team });

describe('新留言草稿與改寫草稿分開', () => {
    it('情境 A：先有改寫草稿再建新留言草稿，送出新留言不覆蓋舊留言', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const old = await teamMessage(report, '舊留言原文');

        const rewrite = await draft(report, '舊留言改寫後', old);
        const fresh = await draft(report, '新的回覆');

        expect(fresh.id).not.toBe(rewrite.id);
        expect(fresh.replaces_message_id).toBeNull();
        expect(fresh.body).toBe('新的回覆');
        const sent = await sendDraft(workerEnv, await reloadReport(report), fresh, sender);
        expect(sent.replaced).toBe(false);
        expect(await messageBody(old)).toBe('舊留言原文');
        await sendDraft(workerEnv, await reloadReport(report), (await draftsOf(report))[0], sender);
        expect(await messageBody(old)).toBe('舊留言改寫後');
        const bodies = (await env.DB.prepare('SELECT body FROM messages WHERE report_id = ? ORDER BY id').bind(report.id).all<{ body: string }>()).results.map((row) => row.body);
        expect(bodies).toEqual(['舊留言改寫後', '新的回覆']);
    });

    it('情境 B：先有新留言草稿再建改寫草稿，新留言草稿內容不變、送出仍是新的一則', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const old = await teamMessage(report, '舊留言原文');

        const fresh = await draft(report, '新的回覆');
        const rewrite = await draft(report, '舊留言改寫後', old);

        expect(rewrite.id).not.toBe(fresh.id);
        expect(rewrite.replaces_message_id).toBe(old);
        const [first] = await draftsOf(report);
        expect(first).toMatchObject({ id: fresh.id, body: '新的回覆', replaces_message_id: null });
        await sendDraft(workerEnv, await reloadReport(report), first, sender);
        expect(await messageBody(old)).toBe('舊留言原文');
        expect((await env.DB.prepare("SELECT COUNT(*) AS total FROM messages WHERE report_id = ? AND body = '新的回覆'").bind(report.id).first<{ total: number }>())?.total).toBe(1);
    });

    it('情境 C：同一則留言改寫兩次只留一則改寫草稿（後來的取代），改寫另一則各自一則', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const first = await teamMessage(report, '第一則');
        const second = await teamMessage(report, '第二則');

        const v1 = await draft(report, '第一則改寫 v1', first);
        const v2 = await draft(report, '第一則改寫 v2', first);
        const other = await draft(report, '第二則改寫', second);

        expect(v2.id).toBe(v1.id);
        expect(v2.body).toBe('第一則改寫 v2');
        expect(other.id).not.toBe(v1.id);
        expect(await draftsOf(report)).toHaveLength(2);
        for (const pending of await draftsOf(report)) {
            await sendDraft(workerEnv, await reloadReport(report), pending, sender);
        }
        expect(await messageBody(first)).toBe('第一則改寫 v2');
        expect(await messageBody(second)).toBe('第二則改寫');
    });

    it('只是出現在草稿裡的子字串仍會接上；重送最後一段才略過', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        await draft(report, '好的，第三題已修正');
        expect((await draft(report, '好的')).body).toBe('好的，第三題已修正\n\n好的');
        expect((await draft(report, '好的')).body).toBe('好的，第三題已修正\n\n好的');
    });

    it('新留言草稿附件合起來超過 5 個就另存一則，放得下的再接回原本那則', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const first = await draft(report, '第一段', null, fakeUploads(seeded, 3));
        const second = await draft(report, '第二段', null, fakeUploads(seeded, 3));
        const third = await draft(report, '第三段', null, fakeUploads(seeded, 2));

        expect(second.id).not.toBe(first.id);
        expect(third.id).toBe(first.id);
        expect(third.body).toBe('第一段\n\n第三段');
        expect(JSON.parse(third.attachments ?? '[]')).toHaveLength(5);
        expect(JSON.parse(second.attachments ?? '[]')).toHaveLength(3);
    });

    it('改寫草稿附件合起來超過 5 個回 422，原本那則不變', async () => {
        const seeded = await seedProject();
        const { report } = await seedReport(seeded.project);
        const old = await teamMessage(report, '舊留言');
        await draft(report, '改寫 v1', old, fakeUploads(seeded, 3));

        await expect(draft(report, '改寫 v2', old, fakeUploads(seeded, 3))).rejects.toMatchObject({ code: 'too_many_attachments', status: 422 });
        const drafts = await draftsOf(report);
        expect(drafts).toHaveLength(1);
        expect(drafts[0].body).toBe('改寫 v1');
        expect(JSON.parse(drafts[0].attachments ?? '[]')).toHaveLength(3);
    });
});

describe('合併的修正', () => {
    async function clientReport(seeded: SeededProject, title: string, description: string, now = Date.now()): Promise<Report> {
        return (
            await createReport(workerEnv, seeded.project, { title, description, uploads: [] }, { creator_type: 'client', creator_developer_id: null, creator_client_account_id: seeded.clientAccount?.id ?? null }, now)
        ).report;
    }

    const clientAuthor = (seeded: SeededProject): Author => ({ developerId: null, clientAccountId: seeded.clientAccount?.id ?? null, name: 'Amy' });

    it('自動合併把原始附件搬到保留的單，相簿接著編號、客戶打得開，保留單記下搬來幾個', async () => {
        const password = 'amy-password-123456';
        const username = unique('amy');
        const seeded = await seedProject({ clientUsername: username, clientPassword: password });
        const kept = await clientReport(seeded, '儲存失敗', '按了沒反應');
        await seedAttachment(kept, { name: 'a.png' });
        const duplicate = await clientReport(seeded, '儲存失敗', '按了沒反應');
        await seedAttachment(duplicate, { name: 'b.png' });
        await seedAttachment(duplicate, { name: 'c.png' });

        const result = await autoMergeDuplicate(workerEnv, duplicate, clientAuthor(seeded));

        expect(result?.id).toBe(kept.id);
        const ids = (await env.DB.prepare('SELECT id, report_id FROM attachments WHERE report_id IN (?, ?) ORDER BY id').bind(kept.id, duplicate.id).all<{ id: number; report_id: number }>()).results;
        expect(ids.map((row) => row.report_id)).toEqual([kept.id, kept.id, kept.id]);
        const event = await env.DB.prepare("SELECT detail FROM report_events WHERE report_id = ? AND kind = 'merge'").bind(kept.id).first<{ detail: string }>();
        expect(event?.detail).toMatch(/，搬來 2 個原始附件$/);

        const client = new Browser();
        expect((await client.loginAs(seeded.project.slug, username, password)).status).toBe(302);
        const page = await (await client.get(`/p/${seeded.project.slug}/reports/${kept.public_id}`)).text();
        for (const name of ['圖1', '圖2', '圖3']) {
            expect(page).toContain(name);
        }
        for (const row of ids) {
            expect((await client.get(`/p/${seeded.project.slug}/reports/${kept.public_id}/attachments/${row.id}`)).status).toBe(200);
        }
    });

    it('先送出的那張已完成就不自動合併，新單照常保留', async () => {
        const seeded = await seedProject({ clientUsername: unique('amy'), clientPassword: 'amy-password-123456' });
        const first = await clientReport(seeded, '標題', '說明');
        await env.DB.prepare("UPDATE reports SET status = 'completed' WHERE id = ?").bind(first.id).run();
        const second = await clientReport(seeded, '標題', '說明');

        expect(await autoMergeDuplicate(workerEnv, second, clientAuthor(seeded))).toBeNull();
        expect((await reloadReport(second)).merged_into_report_id).toBeNull();
    });

    it('沒有帳號的客戶身分不自動合併', async () => {
        const seeded = await seedProject();
        const first = await clientReport(seeded, '標題', '說明');
        const second = await clientReport(seeded, '標題', '說明');

        expect(first.creator_client_account_id ?? null).toBeNull();
        expect(await autoMergeDuplicate(workerEnv, second, clientAuthor(seeded))).toBeNull();
    });

    it('客戶的單不能併進團隊內部單或公開回報單，可以併進分享給客戶的團隊單', async () => {
        const seeded = await seedProject();
        const { report: clientOwned } = await seedReport(seeded.project);
        const { report: internal } = await seedReport(seeded.project, { creator: 'developer' });
        const { report: publicReport } = await seedReport(seeded.project, { creator: 'public' });

        for (const target of [internal, publicReport]) {
            await expect(mergeReport(workerEnv, clientOwned, target, team)).rejects.toMatchObject({ code: 'target_hidden_from_client' });
        }
        expect((await reloadReport(clientOwned)).merged_into_report_id).toBeNull();

        const { report: shared } = await seedReport(seeded.project, { creator: 'developer' });
        await env.DB.prepare('UPDATE reports SET shared_with_client = 1 WHERE id = ?').bind(shared.id).run();
        await mergeReport(workerEnv, clientOwned, await reloadReport(shared), team);
        expect((await reloadReport(clientOwned)).merged_into_report_id).toBe(shared.id);
        // 團隊內部單併進客戶看得到的單不受限。
        await mergeReport(workerEnv, internal, await reloadReport(shared), team);
        expect((await reloadReport(internal)).merged_into_report_id).toBe(shared.id);
    });

    it('手動合併：新留言草稿接進保留單原本那則，改寫草稿改成新留言各自保留，附件放不下的另存一則', async () => {
        const seeded = await seedProject();
        const { report: target } = await seedReport(seeded.project);
        const { report: duplicate } = await seedReport(seeded.project);
        const message = await teamMessage(duplicate, '原單留言');
        const at = new Date().toISOString();
        const insert = (report: Report, body: string, replaces: number | null, files: string | null) =>
            env.DB.prepare("INSERT INTO message_drafts (report_id, replaces_message_id, author_name, body, attachments, created_at, updated_at) VALUES (?, ?, 'Alex', ?, ?, ?, ?) RETURNING id")
                .bind(report.id, replaces, body, files, at, at)
                .first<{ id: number }>();
        const kept = await insert(target, '保留單的草稿', null, storedFiles(2));
        await insert(duplicate, '重複單的草稿', null, storedFiles(1));
        const rewrite = await insert(duplicate, '改寫原單留言', message, null);
        const big = await insert(duplicate, '附件很多的草稿', null, storedFiles(3));

        const result = await mergeReport(workerEnv, duplicate, target, team);

        expect(result.movedDrafts).toBe(3);
        const drafts = await draftsOf(target);
        expect(drafts.map((row) => [row.id, row.body, row.replaces_message_id, JSON.parse(row.attachments ?? '[]').length])).toEqual([
            [kept?.id, '保留單的草稿\n\n重複單的草稿', null, 3],
            [rewrite?.id, '改寫原單留言', null, 0],
            [big?.id, '附件很多的草稿', null, 3],
        ]);
        expect(await draftsOf(duplicate)).toEqual([]);
        expect(await messageBody(message)).toBe('原單留言');
    });

    it('已被別的請求合併掉時整批不留下任何變更（防護條件在第一句）', async () => {
        const seeded = await seedProject();
        const { report: target } = await seedReport(seeded.project);
        const { report: other } = await seedReport(seeded.project);
        const { report: duplicate } = await seedReport(seeded.project);
        await seedAttachment(duplicate);
        const at = new Date().toISOString();
        await env.DB.prepare("INSERT INTO message_drafts (report_id, author_name, body, created_at, updated_at) VALUES (?, 'Alex', '草稿', ?, ?)").bind(duplicate.id, at, at).run();
        // 模擬另一個請求在這次讀取之後、寫入之前已經把重複單併到別張。
        const stale = duplicate;
        await mergeReport(workerEnv, duplicate, other, team);
        // 讀取時重複單上還有草稿與原始附件：沒有防護的話會被搬到 target。
        await env.DB.prepare("INSERT INTO message_drafts (report_id, author_name, body, created_at, updated_at) VALUES (?, 'Alex', '晚到的草稿', ?, ?)").bind(duplicate.id, at, at).run();
        await seedAttachment(duplicate);
        const before = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM report_events) AS events, (SELECT COUNT(*) FROM message_drafts WHERE report_id = ?) AS drafts, (SELECT COUNT(*) FROM attachments WHERE report_id = ?) AS files').bind(target.id, target.id).first();

        await expect(mergeReport(workerEnv, stale, target, team, Date.now() + 1000)).rejects.toBeInstanceOf(ServiceError);

        const after = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM report_events) AS events, (SELECT COUNT(*) FROM message_drafts WHERE report_id = ?) AS drafts, (SELECT COUNT(*) FROM attachments WHERE report_id = ?) AS files').bind(target.id, target.id).first();
        expect(after).toEqual(before);
        expect((await reloadReport(duplicate)).merged_into_report_id).toBe(other.id);
    });
});
