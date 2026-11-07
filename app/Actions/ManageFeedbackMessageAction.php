<?php

namespace App\Actions;

use App\Models\FeedbackAttachment;
use App\Models\FeedbackMessage;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use App\Support\FeedbackAttachmentRules;
use App\Support\FeedbackServiceException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * 編輯、收回自己發的留言（網頁、CLI、MCP、巡檢 API 共用）。完全不留痕跡：
 * 編輯不記「已編輯」；收回用軟刪除，畫面、API、未讀數、通知、相簿都當它不存在，附件網址也失效。
 * 兩個動作都不改單的狀態；收回「請確認完成」的留言，「通過」鈕跟著消失（見 _activity）。
 */
class ManageFeedbackMessageAction
{
    /**
     * @param  list<UploadedFile>  $screenshots  要新增的附件
     * @param  list<int>  $removeAttachmentIds  要移除的附件 id（必須是這則留言的）
     */
    public function edit(FeedbackReport $report, FeedbackMessage $message, FeedbackActor $actor, string $body, array $screenshots = [], array $removeAttachmentIds = []): FeedbackMessage
    {
        $this->authorize($report, $message, $actor);
        $body = trim($body);
        if ($body === '') {
            throw new FeedbackServiceException('body_required', '留言內容為必填。');
        }
        if (mb_strlen($body) > PostFeedbackMessageAction::MAX_BODY_LENGTH) {
            throw new FeedbackServiceException('body_too_long', '留言內容不能超過 '.PostFeedbackMessageAction::MAX_BODY_LENGTH.' 字。');
        }

        $disk = config('feedback.disk');
        $storedPaths = [];

        try {
            DB::transaction(function () use ($report, $message, $actor, $body, $screenshots, $removeAttachmentIds, $disk, &$storedPaths): void {
                $message->feedbackAttachments()->whereIn('id', $removeAttachmentIds)->get()->each(fn (FeedbackAttachment $attachment) => $attachment->delete());

                foreach ($screenshots as $screenshot) {
                    $path = $screenshot->store("feedback/{$report->feedback_project_id}/{$report->public_id}", $disk);
                    $storedPaths[] = $path;
                    $message->feedbackAttachments()->create([
                        'feedback_report_id' => $report->id,
                        'disk' => $disk,
                        'path' => $path,
                        'original_name' => $screenshot->getClientOriginalName(),
                        'mime_type' => FeedbackAttachmentRules::storedMime($screenshot->getMimeType()),
                        'size' => $screenshot->getSize(),
                        'uploader_client_account_id' => $actor->clientAccount?->id,
                        'uploader_developer_id' => $actor->developer?->id,
                    ]);
                }

                $message->forceFill(['body' => $body])->save();
            });
        } catch (\Throwable $exception) {
            Storage::disk($disk)->delete($storedPaths);

            throw $exception;
        }

        return $message->refresh();
    }

    public function withdraw(FeedbackReport $report, FeedbackMessage $message, FeedbackActor $actor): void
    {
        $this->authorize($report, $message, $actor);
        $message->delete();
    }

    /**
     * 留言要屬於這張單，而且是這個人自己的；不是自己的一律回「找不到」，不透露那則留言存在。
     */
    public function authorize(FeedbackReport $report, FeedbackMessage $message, FeedbackActor $actor): void
    {
        if ($message->feedback_report_id !== $report->id || ! $message->isManageableBy($actor->isTeam, $actor->clientAccount)) {
            throw new FeedbackServiceException('message_not_found', '找不到這則留言，或這不是你發的留言。', 404);
        }
    }
}
