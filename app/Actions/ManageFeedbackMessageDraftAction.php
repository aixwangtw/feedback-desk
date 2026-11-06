<?php

namespace App\Actions;

use App\Enums\FeedbackAuthorType;
use App\Models\FeedbackMessage;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use App\Support\FeedbackServiceException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * 待審留言（草稿）的新增、修改、送出、捨棄；artisan 指令、排程 API、網頁共用。
 * 草稿只存在 feedback_message_drafts，送出前不會建立任何留言或附件紀錄，客戶端讀不到、也不算未讀。
 */
class ManageFeedbackMessageDraftAction
{
    public function __construct(private PostFeedbackMessageAction $postMessage) {}

    /**
     * @param  list<UploadedFile>  $images
     */
    public function create(FeedbackReport $report, FeedbackActor $actor, string $body, ?int $replacesMessageId = null, array $images = []): FeedbackMessageDraft
    {
        $body = $this->validatedBody($body);
        if ($replacesMessageId !== null) {
            $this->replaceableMessage($report, $replacesMessageId);
        }

        $disk = (string) config('feedback.disk');
        $stored = [];

        try {
            foreach ($images as $image) {
                $path = $image->store("feedback/{$report->feedback_project_id}/{$report->public_id}/drafts", $disk);
                $stored[] = [
                    'disk' => $disk,
                    'path' => $path,
                    'original_name' => $image->getClientOriginalName(),
                    'mime_type' => $image->getMimeType() ?? 'application/octet-stream',
                    'size' => (int) $image->getSize(),
                ];
            }

            return DB::transaction(function () use ($report, $actor, $body, $replacesMessageId, $stored): FeedbackMessageDraft {
                $draft = FeedbackMessageDraft::create([
                    'feedback_report_id' => $report->id,
                    'replaces_message_id' => $replacesMessageId,
                    'author_developer_id' => $actor->developer?->id,
                    'author_name' => mb_substr($actor->name, 0, 100),
                    'author_agent' => $actor->agent,
                    'body' => $body,
                    'attachments' => $stored === [] ? null : $stored,
                ]);
                $report->recordEvent('draft', $actor);

                return $draft;
            });
        } catch (\Throwable $exception) {
            $this->deleteFiles($stored);

            throw $exception;
        }
    }

    public function update(FeedbackMessageDraft $draft, string $body): void
    {
        $draft->update(['body' => $this->validatedBody($body)]);
    }

    /**
     * 送出：一般草稿照現行留言流程新增一則（作者＝按送出的人、時間＝現在，客戶端出現未讀）；
     * 修改原留言型的草稿改寫原留言內容，不新增一則，原留言時間不變。
     * $editedBody：送出前在畫面上改過的文字（例如右下角對話面板），有給就以它為準。
     */
    public function send(FeedbackMessageDraft $draft, FeedbackActor $sender, ?string $editedBody = null): FeedbackMessage
    {
        if ($editedBody !== null) {
            $draft->body = $this->validatedBody($editedBody);
        }

        $report = $draft->feedbackReport;
        $actor = new FeedbackActor($sender->name, true, $sender->developer, null, $draft->author_agent);
        $files = $draft->attachmentList();

        if ($draft->replaces_message_id === null) {
            return DB::transaction(function () use ($draft, $report, $actor, $files): FeedbackMessage {
                $message = $this->postMessage->handle($report, $actor, $draft->body, storedFiles: $files);
                $draft->delete();

                return $message;
            });
        }

        return DB::transaction(function () use ($draft, $report, $actor, $files): FeedbackMessage {
            $message = $this->replaceableMessage($report, (int) $draft->replaces_message_id);
            $message->update(['body' => $draft->body]);
            foreach ($files as $file) {
                $message->feedbackAttachments()->create([
                    'feedback_report_id' => $report->id,
                    ...$file,
                    'uploader_developer_id' => $actor->developer?->id,
                ]);
            }
            $report->update(['latest_activity_at' => now()]);
            $report->recordEvent('message_edit', $actor);
            $this->postMessage->applyStatusRule($report, $actor);
            $draft->delete();

            return $message;
        });
    }

    public function discard(FeedbackMessageDraft $draft): void
    {
        $files = $draft->attachmentList();
        $draft->delete();
        $this->deleteFiles($files);
    }

    /**
     * 只能改這張單上的團隊留言（含 AI 代寫的），不能改客戶留言。
     */
    public function replaceableMessage(FeedbackReport $report, int $messageId): FeedbackMessage
    {
        $message = $report->feedbackMessages()->whereKey($messageId)->first();
        if ($message === null || $message->author_type === FeedbackAuthorType::Reporter) {
            throw new FeedbackServiceException('message_not_replaceable', '要修改的留言必須是這張單上的團隊留言。');
        }

        return $message;
    }

    private function validatedBody(string $body): string
    {
        $body = trim($body);
        if ($body === '') {
            throw new FeedbackServiceException('empty_body', '待審留言內容不能空白。');
        }
        if (mb_strlen($body) > PostFeedbackMessageAction::MAX_BODY_LENGTH) {
            throw new FeedbackServiceException('body_too_long', '留言內容不能超過 '.PostFeedbackMessageAction::MAX_BODY_LENGTH.' 字。');
        }

        return $body;
    }

    /**
     * @param  list<array{disk: string, path: string}>  $files
     */
    private function deleteFiles(array $files): void
    {
        foreach ($files as $file) {
            Storage::disk($file['disk'])->delete($file['path']);
        }
    }
}
