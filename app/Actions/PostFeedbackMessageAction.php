<?php

namespace App\Actions;

use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use App\Support\FeedbackAttachmentRules;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * 在回饋單留言（可附圖）；網頁、MCP 共用。記下留言者的帳號與 AI 工具，並把這張單標成留言者那一方讀過。
 *
 * 留言自動切狀態（applyStatusRule）：等客戶（needs_input）的單客戶留言 → 等工程師（new，要我方回覆）；
 * 團隊在等工程師的單留言 → 等客戶。已完成的單不因留言改狀態。
 */
class PostFeedbackMessageAction
{
    public const MAX_BODY_LENGTH = 10000;

    /**
     * 團隊留言把單切成等客戶後，給人看的提醒（狀態名稱照站台設定）。
     */
    public static function statusChangeNotice(?FeedbackProject $project = null): string
    {
        return '狀態已改為「'.FeedbackReportStatus::NeedsInput->label($project).'」。';
    }

    public function __construct(private ChangeFeedbackReportStatusAction $changeStatus) {}

    /**
     * @param  list<UploadedFile>  $screenshots
     * @param  list<array{disk: string, path: string, original_name: string, mime_type: string, size: int}>  $storedFiles  已經存好的檔案（待審留言送出時用）
     */
    public function handle(FeedbackReport $report, FeedbackActor $actor, string $body, array $screenshots = [], array $storedFiles = [], bool $applyStatusRule = true, bool $isCompletionRequest = false): FeedbackMessage
    {
        $disk = config('feedback.disk');
        $storedPaths = [];

        try {
            $message = DB::transaction(function () use ($report, $actor, $body, $screenshots, $storedFiles, $disk, $isCompletionRequest, &$storedPaths): FeedbackMessage {
                $message = $report->feedbackMessages()->create([
                    'author_type' => $actor->isTeam ? FeedbackAuthorType::Owner : FeedbackAuthorType::Reporter,
                    'author_name' => $this->authorName($report, $actor),
                    'author_client_account_id' => $actor->clientAccount?->id,
                    'author_developer_id' => $actor->developer?->id,
                    'author_agent' => $actor->agent,
                    'body' => $body,
                    'is_completion_request' => $isCompletionRequest,
                ]);

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

                foreach ($storedFiles as $file) {
                    $message->feedbackAttachments()->create([
                        'feedback_report_id' => $report->id,
                        ...$file,
                        'uploader_client_account_id' => $actor->clientAccount?->id,
                        'uploader_developer_id' => $actor->developer?->id,
                    ]);
                }

                $report->update(['latest_activity_at' => now()]);
                $report->recordEvent('message', $actor);

                return $message;
            });
        } catch (\Throwable $exception) {
            Storage::disk($disk)->delete($storedPaths);

            throw $exception;
        }

        if ($applyStatusRule) {
            $this->applyStatusRule($report, $actor);
        }

        // 自己留言時一定看過這張單，不讓自己的留言或前面的留言留成未讀。
        $actor->isTeam ? $report->markReadByOwner() : $report->markReadByClient($actor->clientAccount);

        return $message;
    }

    /**
     * 回傳是否有改狀態。
     */
    public function applyStatusRule(FeedbackReport $report, FeedbackActor $actor): bool
    {
        $next = match (true) {
            $actor->isTeam && $report->status === FeedbackReportStatus::New => FeedbackReportStatus::NeedsInput,
            ! $actor->isTeam && $report->status === FeedbackReportStatus::NeedsInput => FeedbackReportStatus::New,
            default => null,
        };
        if ($next === null) {
            return false;
        }

        $this->changeStatus->handle($report, $next, $actor);

        return true;
    }

    /**
     * 留言當下存的名字；畫面上有帳號的會改顯示帳號目前的名字。團隊在公開單上一律顯示團隊稱呼。
     */
    private function authorName(FeedbackReport $report, FeedbackActor $actor): string
    {
        return match (true) {
            $actor->isTeam && $report->isPublicReport() => (string) config('feedback.labels.owner'),
            $actor->isTeam => $actor->name,
            $report->isPublicReport() => $report->reporter_name ?: '公開回報者',
            default => $actor->name,
        };
    }
}
