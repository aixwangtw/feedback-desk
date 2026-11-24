/**
 * 重複的單合併（2026-11-21，對應 Laravel 版 MergeFeedbackReportAction）：重複的單記下合併到哪張並隱藏
 * （沿用客戶已刪除的隱藏規則，兩端清單、看板、面板、計數、巡檢都不列），還沒送出的待審留言搬到保留的單；
 * 原本的留言與附件留在原單當紀錄。兩張單各記一筆「合併重複的單」動態。
 *
 * 自動合併：客戶（含每人一個的客戶帳號，沒帳號也算同一人）在 AUTO_MERGE_MINUTES 分鐘內送出標題與說明都一樣的單，
 * 新單併進較早那張。公開回報與團隊開的單不合併。手動合併走團隊 API（CLI `merge`）。
 */
import { AUTO_MERGE_MINUTES } from '../../shared/report-guides';
import { nowIso } from '../../shared/time';
import type { Env } from '../env';
import type { Author } from './access';
import type { Report } from './models';
import { eventStatement, sequenceNumber } from './reports';
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
}

/** 把 duplicate 併進 target；回傳兩張的團隊端清單編號與搬過去的待審留言數。 */
export async function mergeReport(env: Env, duplicate: Report, target: Report, author: Author, now = Date.now()): Promise<{ duplicateNumber: number; targetNumber: number; movedDrafts: number }> {
    ensureMergeable(duplicate, target);
    const db = env.DB;
    const at = nowIso(now);
    // 搬過去的待審留言數先數好（D1 的 meta.changes 會把觸發器改到的 projects 也算進去）。
    const [duplicateNumber, targetNumber, drafts] = await Promise.all([
        sequenceNumber(db, duplicate, false),
        sequenceNumber(db, target, false),
        db.prepare('SELECT COUNT(*) AS total FROM message_drafts WHERE report_id = ?').bind(duplicate.id).first<{ total: number }>(),
    ]);
    const [, updated] = await db.batch([
        // 改寫原單某則留言的草稿搬過去後改成新留言，不能去改另一張單的留言。
        db.prepare('UPDATE message_drafts SET report_id = ?, replaces_message_id = NULL, updated_at = ? WHERE report_id = ?').bind(target.id, at, duplicate.id),
        db
            .prepare('UPDATE reports SET merged_into_report_id = ?, client_deleted_at = COALESCE(client_deleted_at, ?), updated_at = ? WHERE id = ? AND merged_into_report_id IS NULL')
            .bind(target.id, at, at, duplicate.id),
        eventStatement(db, duplicate, 'merge', author, at, `合併到編號 ${targetNumber}（${target.public_id}）`),
        eventStatement(db, target, 'merge', author, at, `編號 ${duplicateNumber}（${duplicate.public_id}）併入這張`),
    ]);
    if ((updated.meta.changes ?? 0) === 0) {
        throw new ServiceError('already_merged', '這張單已經合併到別張單了。', 422);
    }
    return { duplicateNumber, targetNumber, movedDrafts: drafts?.total ?? 0 };
}

/**
 * 同一個客戶短時間內重複送出一樣的單：同專案、同一個客戶帳號（都沒有帳號也算同一人）、標題與說明去頭尾空白後完全相同、
 * 在合併時限內建立、還沒刪除或合併的較早一張。客戶建立的單才找（公開回報與開發團隊的單不合併）。
 */
export async function findDuplicateOf(db: D1Database, report: Report, now = Date.now()): Promise<Report | null> {
    if (report.creator_type !== 'client') {
        return null;
    }
    const since = nowIso(now - AUTO_MERGE_MINUTES * 60_000);
    const { results } = await db
        .prepare(
            `SELECT * FROM reports WHERE project_id = ? AND creator_type = 'client' AND creator_client_account_id IS ? AND id < ?
             AND client_deleted_at IS NULL AND merged_into_report_id IS NULL AND created_at >= ? ORDER BY id LIMIT 50`,
        )
        .bind(report.project_id, report.creator_client_account_id ?? null, report.id, since)
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
