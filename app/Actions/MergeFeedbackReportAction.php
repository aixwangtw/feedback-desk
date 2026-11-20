<?php

namespace App\Actions;

use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use App\Support\FeedbackServiceException;
use Illuminate\Support\Facades\DB;

/**
 * 把重複的單合併進另一張：重複的單記下合併到哪張並隱藏（沿用客戶已刪除的隱藏邏輯，兩端清單、看板、面板、計數、巡檢都不列），
 * 還沒送出的待審留言搬到目標單；原本的留言與附件留在原單當紀錄。兩張單各記一筆 merged 事件。
 */
class MergeFeedbackReportAction
{
    /**
     * 同一個人在這段時間內重複送出標題、說明都一樣的單會自動合併（CreateFeedbackReportAction）。
     */
    public const AUTO_MERGE_MINUTES = 30;

    /**
     * 清單頁的說明（客戶端與團隊端共用）。
     */
    public const AUTO_MERGE_GUIDE = '同一個人 '.self::AUTO_MERGE_MINUTES.' 分鐘內重複送出標題與說明都一樣的單，系統會自動合併成一張（保留先送出的那張）。';

    public function handle(FeedbackReport $duplicate, FeedbackReport $target, ?FeedbackActor $actor): FeedbackReport
    {
        $actor ??= new FeedbackActor('系統', true);

        return DB::transaction(function () use ($duplicate, $target, $actor): FeedbackReport {
            $duplicate = FeedbackReport::query()->whereKey($duplicate->id)->lockForUpdate()->firstOrFail();
            $target = FeedbackReport::query()->whereKey($target->id)->lockForUpdate()->firstOrFail();

            $this->ensureMergeable($duplicate, $target);

            $duplicateNumber = $duplicate->sequenceNumber();
            $targetNumber = $target->sequenceNumber();

            $duplicate->messageDrafts()->each(function (FeedbackMessageDraft $draft) use ($target): void {
                // 改寫原單某則留言的草稿搬過去後改成新留言，不能去改另一張單的留言。
                $draft->update(['feedback_report_id' => $target->id, 'replaces_message_id' => null]);
            });

            $duplicate->update([
                'merged_into_report_id' => $target->id,
                'client_deleted_at' => $duplicate->client_deleted_at ?? now(),
            ]);

            $duplicate->recordEvent('merged', $actor, "合併到編號 {$targetNumber}（{$target->public_id}）");
            $target->recordEvent('merged', $actor, "編號 {$duplicateNumber}（{$duplicate->public_id}）併入這張");

            return $duplicate;
        });
    }

    private function ensureMergeable(FeedbackReport $duplicate, FeedbackReport $target): void
    {
        if ($duplicate->is($target)) {
            throw new FeedbackServiceException('merge_into_self', '不能把單合併到自己。');
        }

        if ((int) $duplicate->feedback_project_id !== (int) $target->feedback_project_id) {
            throw new FeedbackServiceException('merge_cross_project', '只能合併同一個專案裡的單。');
        }

        if ($duplicate->isMerged()) {
            throw new FeedbackServiceException('already_merged', '這張單已經合併到別張單了。');
        }

        if ($target->isMerged()) {
            throw new FeedbackServiceException('target_merged', '目標單已經合併到別張單，請改合併到最後保留的那張。');
        }

        if ($target->isDeletedByClient()) {
            throw new FeedbackServiceException('target_deleted', '目標單已被刪除，不能合併進去。');
        }
    }
}
