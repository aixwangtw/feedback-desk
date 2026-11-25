/**
 * 重複的單合併（2026-11-21，對應 Laravel 版 MergeFeedbackReportAction）：重複的單記下合併到哪張並隱藏
 * （沿用客戶已刪除的隱藏規則，兩端清單、看板、面板、計數、巡檢都不列），還沒送出的待審留言搬到保留的單
 * （新留言草稿照「同一張單只留一則」接進保留單的新留言草稿，附件或字數放不下就各自保留；改寫原單留言的草稿改成新留言、各自保留），
 * 開單時的原始附件搬到保留的單（接在保留單原始附件後面編號）；原本的留言與留言附件留在原單當紀錄。兩張單各記一筆「合併重複的單」動態。
 * 客戶看得到的單不能併進客戶看不到的單（團隊內部單、沒分享的單、公開回報單）。
 *
 * 自動合併：同一個客戶帳號（沒有帳號的共用身分不合併，可能是不同人）在 AUTO_MERGE_MINUTES 分鐘內送出標題與說明都一樣的單，
 * 新單併進較早、還沒完成的那張。公開回報與團隊開的單不合併。手動合併走團隊 API（CLI `merge`）。
 *
 * 整批寫入時第一句是帶防護條件的 UPDATE（merged_into_report_id IS NULL），其餘每句都加 WHERE EXISTS 確認這次的合併真的寫進去了，
 * 同時有兩個合併時後到的那個整批不留下任何變更。
 */
import { MAX_FILES } from '../../shared/attachment-rules';
import { AUTO_MERGE_MINUTES } from '../../shared/report-guides';
import { nowIso } from '../../shared/time';
import type { Env } from '../env';
import type { Author } from './access';
import { joinedDraftBodyOrNull, type MessageDraft } from './drafts';
import { isVisibleToClient, type Report } from './models';
import { parseStoredFiles, sequenceNumber, type StoredFile } from './reports';
import { ServiceError } from './team';

function ensureMergeable(duplicate: Report, target: Report): void {
    if (duplicate.id === target.id) {
        throw new ServiceError('merge_into_self', '不能把單合併到自己。', 422);
    }
    if (duplicate.project_id !== target.project_id) {
        throw new ServiceError('merge_cross_project', '只能合併同一個專案裡的單。', 422);
    }
    if ((duplicate.merged_into_report_id ?? null) !== null) {
        throw new ServiceError('already_merged', '這張單已經合併到別張單了。', 422);
    }
    if ((target.merged_into_report_id ?? null) !== null) {
        throw new ServiceError('target_merged', '目標單已經合併到別張單，請改合併到最後保留的那張。', 422);
    }
    if (target.client_deleted_at !== null) {
        throw new ServiceError('target_deleted', '目標單已被刪除，不能合併進去。', 422);
    }
    if (isVisibleToClient(duplicate) && !isVisibleToClient(target)) {
        throw new ServiceError('target_hidden_from_client', '客戶看得到的單不能併進客戶看不到的單（團隊內部單、沒分享給客戶的單、公開回報單），請改選客戶看得到的單。', 422);
    }
}

/** 這次合併真的寫進去了：重複單記的合併目標是 target、更新時間是這次的時間。 */
const MERGED_GUARD = 'EXISTS (SELECT 1 FROM reports WHERE id = ? AND merged_into_report_id = ? AND updated_at = ?)';

function guardedEvent(db: D1Database, reportId: number, author: Author, at: string, detail: string, guard: unknown[]): D1PreparedStatement {
    return db
        .prepare(`INSERT INTO report_events (report_id, kind, developer_id, client_account_id, actor_name, agent, detail, created_at) SELECT ?, 'merge', ?, ?, ?, ?, ?, ? WHERE ${MERGED_GUARD}`)
        .bind(reportId, author.developerId, author.clientAccountId, author.name ?? '', author.agent ?? null, detail, at, ...guard);
}

/**
 * 搬草稿的寫入句：新留言草稿接進保留單的新留言草稿（對應 Laravel 版 MergeFeedbackReportAction::moveDraft），
 * 放不下或是改寫草稿就整則搬過去、改成新留言。先在記憶體裡算好，接進同一則時後面的草稿看得到前面接上的內容與附件。
 */
async function draftStatements(db: D1Database, duplicate: Report, target: Report, at: string, guard: unknown[]): Promise<D1PreparedStatement[]> {
    const { results: drafts } = await db.prepare('SELECT * FROM message_drafts WHERE report_id = ? ORDER BY id').bind(duplicate.id).all<MessageDraft>();
    const joined = new Map<number, { body: string; files: StoredFile[] }>();
    const statements: D1PreparedStatement[] = [];
    let targetNewDrafts: MessageDraft[] | null = null;
    for (const draft of drafts) {
        const files = parseStoredFiles(draft.attachments);
        if (draft.replaces_message_id === null) {
            targetNewDrafts ??= (await db.prepare('SELECT * FROM message_drafts WHERE report_id = ? AND replaces_message_id IS NULL ORDER BY id').bind(target.id).all<MessageDraft>()).results;
            const join = targetNewDrafts
                .map((candidate) => ({ candidate, state: joined.get(candidate.id) ?? { body: candidate.body, files: parseStoredFiles(candidate.attachments) } }))
                .find(({ state }) => state.files.length + files.length <= MAX_FILES);
            const body = join ? joinedDraftBodyOrNull(join.state.body, draft.body) : null;
            if (join && body !== null) {
                joined.set(join.candidate.id, { body, files: [...join.state.files, ...files] });
                statements.push(db.prepare(`DELETE FROM message_drafts WHERE id = ? AND ${MERGED_GUARD}`).bind(draft.id, ...guard));
                continue;
            }
            targetNewDrafts.push({ ...draft, report_id: target.id });
        }
        // 改寫原單某則留言的草稿搬過去後改成新留言，不能去改另一張單的留言。
        statements.push(db.prepare(`UPDATE message_drafts SET report_id = ?, replaces_message_id = NULL, updated_at = ? WHERE id = ? AND ${MERGED_GUARD}`).bind(target.id, at, draft.id, ...guard));
    }
    for (const [id, state] of joined) {
        statements.push(
            db
                .prepare(`UPDATE message_drafts SET body = ?, attachments = ?, updated_at = ? WHERE id = ? AND ${MERGED_GUARD}`)
                .bind(state.body, state.files.length > 0 ? JSON.stringify(state.files) : null, at, id, ...guard),
        );
    }
    return statements;
}

/** 把 duplicate 併進 target；回傳兩張的團隊端清單編號、搬過去的待審留言數與原始附件數。 */
export async function mergeReport(
    env: Env,
    duplicate: Report,
    target: Report,
    author: Author,
    now = Date.now(),
): Promise<{ duplicateNumber: number; targetNumber: number; movedDrafts: number; movedAttachments: number }> {
    ensureMergeable(duplicate, target);
    const db = env.DB;
    const at = nowIso(now);
    const guard = [duplicate.id, target.id, at];
    // 數量先數好（D1 的 meta.changes 會把觸發器改到的 projects 也算進去）。
    const [duplicateNumber, targetNumber, drafts, attachments] = await Promise.all([
        sequenceNumber(db, duplicate, false),
        sequenceNumber(db, target, false),
        db.prepare('SELECT COUNT(*) AS total FROM message_drafts WHERE report_id = ?').bind(duplicate.id).first<{ total: number }>(),
        db.prepare("SELECT COUNT(*) AS total FROM attachments WHERE report_id = ? AND message_id IS NULL AND kind = 'feedback'").bind(duplicate.id).first<{ total: number }>(),
    ]);
    const movedAttachments = attachments?.total ?? 0;
    const [updated] = await db.batch([
        // 防護條件放第一句：已被別的請求合併掉時這句改不到，後面每句的 EXISTS 也都不成立。
        db
            .prepare('UPDATE reports SET merged_into_report_id = ?, client_deleted_at = COALESCE(client_deleted_at, ?), updated_at = ? WHERE id = ? AND merged_into_report_id IS NULL')
            .bind(target.id, at, at, duplicate.id),
        ...(await draftStatements(db, duplicate, target, at, guard)),
        // 原始附件（開單時附的）搬到保留的單，否則客戶自動合併後看不到自己上傳的圖。
        db.prepare(`UPDATE attachments SET report_id = ? WHERE report_id = ? AND message_id IS NULL AND kind = 'feedback' AND ${MERGED_GUARD}`).bind(target.id, duplicate.id, ...guard),
        guardedEvent(db, duplicate.id, author, at, `合併到編號 ${targetNumber}（${target.public_id}）`, guard),
        guardedEvent(db, target.id, author, at, `編號 ${duplicateNumber}（${duplicate.public_id}）併入這張${movedAttachments > 0 ? `，搬來 ${movedAttachments} 個原始附件` : ''}`, guard),
    ]);
    if ((updated.meta.changes ?? 0) === 0) {
        throw new ServiceError('already_merged', '這張單已經合併到別張單了。', 422);
    }
    return { duplicateNumber, targetNumber, movedDrafts: drafts?.total ?? 0, movedAttachments };
}

/**
 * 同一個客戶短時間內重複送出一樣的單：同專案、同一個客戶帳號（沒有帳號的不合併）、標題與說明去頭尾空白後完全相同、
 * 在合併時限內建立、還沒刪除、合併或完成的較早一張（已完成的不併進去，新單照常保留）。客戶建立的單才找（公開回報與開發團隊的單不合併）。
 */
export async function findDuplicateOf(db: D1Database, report: Report, now = Date.now()): Promise<Report | null> {
    if (report.creator_type !== 'client' || (report.creator_client_account_id ?? null) === null) {
        return null;
    }
    const since = nowIso(now - AUTO_MERGE_MINUTES * 60_000);
    const { results } = await db
        .prepare(
            `SELECT * FROM reports WHERE project_id = ? AND creator_type = 'client' AND creator_client_account_id = ? AND id < ?
             AND client_deleted_at IS NULL AND merged_into_report_id IS NULL AND status != 'completed' AND created_at >= ? ORDER BY id LIMIT 50`,
        )
        .bind(report.project_id, report.creator_client_account_id, report.id, since)
        .all<Report>();
    const title = report.title.trim();
    const description = report.description.trim();
    return results.find((candidate) => candidate.title.trim() === title && candidate.description.trim() === description) ?? null;
}

/** 建立單之後呼叫：是重複的單就併進較早那張，回傳保留的那張；不是就回 null。 */
export async function autoMergeDuplicate(env: Env, report: Report, author: Author, now = Date.now()): Promise<Report | null> {
    const original = await findDuplicateOf(env.DB, report, now);
    if (!original) {
        return null;
    }
    await mergeReport(env, report, original, author, now);
    return original;
}

/** 團隊端顯示「已合併到編號 N」用：保留的那張的 public_id 與團隊端清單編號；不是合併掉的單或找不到時回 null。 */
export async function mergedTarget(db: D1Database, report: Report): Promise<{ publicId: string; number: number } | null> {
    if ((report.merged_into_report_id ?? null) === null) {
        return null;
    }
    const target = await db.prepare('SELECT * FROM reports WHERE id = ?').bind(report.merged_into_report_id).first<Report>();
    return target ? { publicId: target.public_id, number: await sequenceNumber(db, target, false) } : null;
}
