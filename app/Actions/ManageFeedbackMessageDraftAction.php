<?php

namespace App\Actions;

use App\Enums\FeedbackAuthorType;
use App\Models\FeedbackMessage;
use App\Models\FeedbackMessageDraft;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use App\Support\FeedbackAttachmentRules;
use App\Support\FeedbackServiceException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * 待審留言（草稿）的新增、修改、送出、捨棄；artisan 指令、排程 API、網頁共用。
 * 草稿只存在 feedback_message_drafts，送出前不會建立任何留言或附件紀錄，客戶端讀不到、也不算未讀。
 * 同一張單的新留言草稿只留一則：再建立時併進原本那一則；改寫某則留言的草稿與新留言分開，同一則留言只留一則改寫草稿（見 draftToJoin）。
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
                    'mime_type' => FeedbackAttachmentRules::storedMime($image->getMimeType()),
                    'size' => (int) $image->getSize(),
                ];
            }

            return DB::transaction(function () use ($report, $actor, $body, $replacesMessageId, $stored): FeedbackMessageDraft {
                $existing = $this->draftToJoin($report, $replacesMessageId, count($stored));
                if ($existing !== null) {
                    $existing->update([
                        'body' => $this->joinedBody($existing->body, $body, $replacesMessageId !== null),
                        'attachments' => [...$existing->attachmentList(), ...$stored] ?: null,
                    ]);
                    $report->recordEvent('draft', $actor);

                    return $existing->refresh();
                }

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

    /**
     * 新建的草稿要接進哪一則既有草稿（2026-11-21 使用者：「留言草稿也不用分2則」）：
     * 新留言（replaces_message_id 為 null）只接進新留言草稿，附件接上後超過每則上限就另存一則；
     * 改寫某則留言的草稿只接進改寫同一則留言的草稿，附件超過上限直接回錯誤（同一則留言不能有兩則改寫草稿）。
     */
    public function draftToJoin(FeedbackReport $report, ?int $replacesMessageId, int $incomingAttachments): ?FeedbackMessageDraft
    {
        $candidates = FeedbackMessageDraft::query()
            ->where('feedback_report_id', $report->id)
            ->when(
                $replacesMessageId === null,
                fn ($query) => $query->whereNull('replaces_message_id'),
                fn ($query) => $query->where('replaces_message_id', $replacesMessageId),
            )
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        $roomy = $candidates->first(
            fn (FeedbackMessageDraft $draft): bool => count($draft->attachmentList()) + $incomingAttachments <= FeedbackAttachmentRules::MAX_FILES,
        );
        if ($roomy === null && $replacesMessageId !== null && $candidates->isNotEmpty()) {
            throw new FeedbackServiceException('too_many_attachments', '這則留言的待審改寫已有附件，合起來會超過每則 '.FeedbackAttachmentRules::MAX_FILES.' 個上限，請先送出或捨棄原本那則。');
        }

        return $roomy;
    }

    /**
     * 新留言草稿：新內容接在後面；和整則內容或最後接上的那段完全相同時不重複接（重送同一段）。
     * 改寫草稿：內容是改寫後的整則留言，後來的取代先前的。
     */
    public function joinedBody(string $existingBody, string $incomingBody, bool $isRewrite): string
    {
        if ($isRewrite) {
            return $incomingBody;
        }
        if ($existingBody === $incomingBody || str_ends_with($existingBody, "\n\n".$incomingBody)) {
            return $existingBody;
        }

        return $this->validatedBody($existingBody."\n\n".$incomingBody);
    }

    /**
     * 合併單時搬草稿用：接起來超過留言字數上限就回 null，讓呼叫端各自保留，不讓整個合併失敗。
     */
    public function joinedBodyOrNull(string $existingBody, string $incomingBody): ?string
    {
        try {
            return $this->joinedBody($existingBody, $incomingBody, false);
        } catch (FeedbackServiceException) {
            return null;
        }
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
