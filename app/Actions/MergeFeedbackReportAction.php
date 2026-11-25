<?php

namespace App\Actions;

use App\Enums\FeedbackAttachmentKind;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use App\Support\FeedbackServiceException;
use Illuminate\Support\Facades\DB;

/**
 * 把重複的單合併進另一張：重複的單記下合併到哪張並隱藏（沿用客戶已刪除的隱藏邏輯，兩端清單、看板、面板、計數、巡檢都不列），
 * 還沒送出的待審留言搬到目標單（新留言草稿照「同一張單只留一則」接進目標單的新留言草稿，改寫原單留言的草稿改成新留言、各自保留），
 * 開單時附的原始附件搬到目標單（接在目標單原始附件後面編號），原本的留言與留言附件留在原單當紀錄。兩張單各記一筆 merged 事件。
 */
class MergeFeedbackReportAction
{
    /**
     * 同一個客戶帳號在這段時間內重複送出標題、說明都一樣的單會自動合併（CreateFeedbackReportAction）。
     */
    public const AUTO_MERGE_MINUTES = 30;

    /**
     * 清單頁的說明（客戶端與團隊端共用）。
     */
    public const AUTO_MERGE_GUIDE = '同一個帳號 '.self::AUTO_MERGE_MINUTES.' 分鐘內重複送出標題與說明都一樣的單，系統會自動合併成一張（保留先送出的那張，附件一起搬過去；先送出的那張已完成就不合併）。';

    public function __construct(private ManageFeedbackMessageDraftAction $drafts) {}

    public function handle(FeedbackReport $duplicate, FeedbackReport $target, ?FeedbackActor $actor): FeedbackReport
    {
        $actor ??= new FeedbackActor('系統', true);

        return DB::transaction(function () use ($duplicate, $target, $actor): FeedbackReport {
            $duplicate = FeedbackReport::query()->whereKey($duplicate->id)->lockForUpdate()->firstOrFail();
            $target = FeedbackReport::query()->whereKey($target->id)->lockForUpdate()->firstOrFail();

            $this->ensureMergeable($duplicate, $target);

            $duplicateNumber = $duplicate->sequenceNumber();
            $targetNumber = $target->sequenceNumber();

            $duplicate->messageDrafts()->orderBy('id')->get()->each(fn (FeedbackMessageDraft $draft) => $this->moveDraft($draft, $target));

            // 原始附件（開單時附的）搬到保留的單，否則客戶自動合併後看不到自己上傳的圖。
            $movedAttachments = $duplicate->feedbackAttachments()
                ->whereNull('feedback_message_id')
                ->ofKind(FeedbackAttachmentKind::Feedback)
                ->update(['feedback_report_id' => $target->id]);

            $duplicate->update([
                'merged_into_report_id' => $target->id,
                'client_deleted_at' => $duplicate->client_deleted_at ?? now(),
            ]);

            $duplicate->recordEvent('merged', $actor, "合併到編號 {$targetNumber}（{$target->public_id}）");
            $target->recordEvent('merged', $actor, "編號 {$duplicateNumber}（{$duplicate->public_id}）併入這張".($movedAttachments > 0 ? "，搬來 {$movedAttachments} 個原始附件" : ''));

            return $duplicate;
        });
    }

    /**
     * 新留言草稿接進保留單的新留言草稿（附件或字數放不下就各自保留）；改寫原單留言的草稿不能改另一張單的留言，改成新留言各自保留。
     */
    private function moveDraft(FeedbackMessageDraft $draft, FeedbackReport $target): void
    {
        $files = $draft->attachmentList();
        if ($draft->replaces_message_id === null) {
            $join = $this->drafts->draftToJoin($target, null, count($files));
            $body = $join !== null ? $this->drafts->joinedBodyOrNull($join->body, $draft->body) : null;
            if ($join !== null && $body !== null) {
                $join->update(['body' => $body, 'attachments' => [...$join->attachmentList(), ...$files] ?: null]);
                $draft->delete();

                return;
            }
        }

        $draft->update(['feedback_report_id' => $target->id, 'replaces_message_id' => null]);
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

        if ($duplicate->isCreatedByClient() && ! $target->isCreatedByClient()) {
            throw new FeedbackServiceException('target_hidden_from_client', '客戶看得到的單不能併進客戶看不到的單（團隊內部單、沒分享給客戶的單、公開回報單），請改選客戶看得到的單。');
        }
    }
}
