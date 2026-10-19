<?php

namespace App\Actions;

use App\Enums\FeedbackAuthorType;
use App\Models\FeedbackMessage;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * 在回饋單留言（可附圖）；網頁、MCP 共用。記下留言者的帳號與 AI 工具，並把這張單標成留言者那一方讀過。
 */
class PostFeedbackMessageAction
{
    public const MAX_BODY_LENGTH = 10000;

    /**
     * @param  list<UploadedFile>  $screenshots
     */
    public function handle(FeedbackReport $report, FeedbackActor $actor, string $body, array $screenshots = []): FeedbackMessage
    {
        $disk = config('feedback.disk');
        $storedPaths = [];

        try {
            $message = DB::transaction(function () use ($report, $actor, $body, $screenshots, $disk, &$storedPaths): FeedbackMessage {
                $message = $report->feedbackMessages()->create([
                    'author_type' => $actor->isTeam ? FeedbackAuthorType::Owner : FeedbackAuthorType::Reporter,
                    'author_name' => $this->authorName($report, $actor),
                    'author_client_account_id' => $actor->clientAccount?->id,
                    'author_developer_id' => $actor->developer?->id,
                    'author_agent' => $actor->agent,
                    'body' => $body,
                ]);

                foreach ($screenshots as $screenshot) {
                    $path = $screenshot->store("feedback/{$report->feedback_project_id}/{$report->public_id}", $disk);
                    $storedPaths[] = $path;
                    $message->feedbackAttachments()->create([
                        'feedback_report_id' => $report->id,
                        'disk' => $disk,
                        'path' => $path,
                        'original_name' => $screenshot->getClientOriginalName(),
                        'mime_type' => $screenshot->getMimeType() ?? 'application/octet-stream',
                        'size' => $screenshot->getSize(),
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

        // 自己留言時一定看過這張單，不讓自己的留言或前面的留言留成未讀。
        $actor->isTeam ? $report->markReadByOwner() : $report->markReadByClient($actor->clientAccount);

        return $message;
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
