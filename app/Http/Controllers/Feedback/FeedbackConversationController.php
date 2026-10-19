<?php

namespace App\Http\Controllers\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Http\Controllers\Controller;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * 右下角留言對話面板：列出可看的回饋單對話、開啟單一張的留言。
 * 只給已登入專案的開發者與客戶；私密網址回報者與公開回報者沒有這個面板。
 */
class FeedbackConversationController extends Controller
{
    private const PREVIEW_LENGTH = 60;

    public function index(FeedbackProject $feedbackProject, FeedbackAccess $access): JsonResponse
    {
        $this->ensureCanManage($feedbackProject, $access);
        $isOwner = $access->isOwner($feedbackProject);

        $latestMessage = fn (string $column) => FeedbackMessage::query()
            ->select($column)
            ->whereColumn('feedback_messages.feedback_report_id', 'feedback_reports.id')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(1);

        // 一次查詢取回整個專案的單與留言統計；編號依建立時間排，所以先取全部（客戶端含已刪除）再過濾。
        $reports = $feedbackProject->feedbackReports()
            ->select([
                'id', 'feedback_project_id', 'public_id', 'title', 'status', 'creator_type', 'created_at',
                'client_deleted_at', 'owner_last_read_at', 'client_last_read_at', 'adjustment_updated_at',
            ])
            ->when(! $isOwner, fn ($query) => $query->createdByClient())
            ->when(
                $isOwner,
                fn ($query) => $query->withOwnerMessageStats(),
                fn ($query) => $query->withClientNewReplyCount()
                    ->withCount('feedbackMessages')
                    ->withMax('feedbackMessages as latest_message_at', 'created_at'),
            )
            ->addSelect([
                'latest_message_body' => $latestMessage('body'),
                'latest_message_author' => $latestMessage('author_type'),
            ])
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();

        $items = $reports
            ->values()
            ->map(fn (FeedbackReport $report, int $index): array => $this->listItem($feedbackProject, $report, $index + 1, $isOwner))
            ->when(! $isOwner, fn ($items) => $items->reject(fn (array $item): bool => $item['deleted']))
            ->sort(fn (array $a, array $b): int => [$b['has_update'], $b['sort_at']] <=> [$a['has_update'], $a['sort_at']])
            ->values();

        return response()->json([
            'items' => $items->map(fn (array $item): array => collect($item)->except('sort_at')->all())->all(),
            'unread_total' => $items->sum('unread') + $items->where('adjustment_updated', true)->count(),
        ]);
    }

    public function show(FeedbackProject $feedbackProject, FeedbackReport $feedbackReport, FeedbackAccess $access): JsonResponse
    {
        $this->ensureCanManage($feedbackProject, $access);
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);
        $access->ensureReportVisible($feedbackReport);

        $isOwner = $access->isOwner($feedbackProject);
        $adjustmentWasNew = ! $isOwner && $feedbackReport->adjustment_updated_at !== null
            && ($feedbackReport->client_last_read_at === null || $feedbackReport->adjustment_updated_at->greaterThan($feedbackReport->client_last_read_at));

        // 開啟對話（與面板開著時的定時刷新）就算讀過，與回饋單頁的留言刷新一致。
        $isOwner ? $feedbackReport->markReadByOwner() : $feedbackReport->markReadByClient();

        $feedbackReport->load(['feedbackMessages.feedbackAttachments', 'adjustmentAttachments']);

        return response()->json([
            'id' => $feedbackReport->public_id,
            'number' => $feedbackReport->sequenceNumber(clientCreatedOnly: ! $isOwner),
            'title' => $feedbackReport->title,
            'status' => $feedbackReport->status->label(),
            'deleted' => $feedbackReport->isDeletedByClient(),
            'page_url' => route('feedback.reports.show', [$feedbackProject, $feedbackReport]),
            'post_url' => route('feedback.messages.store', [$feedbackProject, $feedbackReport]),
            'html' => view('feedback.reports._conversation', [
                'project' => $feedbackProject,
                'report' => $feedbackReport,
                'viewerIsOwner' => $isOwner,
                'adjustmentWasNew' => $adjustmentWasNew,
            ])->render(),
        ]);
    }

    /**
     * @return array{id: string, number: int, title: string, status: string, deleted: bool, preview: string|null, preview_is_mine: bool, latest_at: string|null, latest_label: string|null, unread: int, adjustment_updated: bool, has_update: bool, messages_count: int, thread_url: string, page_url: string, sort_at: int}
     */
    private function listItem(FeedbackProject $project, FeedbackReport $report, int $number, bool $isOwner): array
    {
        $unread = (int) ($isOwner ? $report->unread_messages_count : $report->client_new_replies_count);
        $adjustmentUpdated = ! $isOwner && $report->adjustment_updated_at !== null
            && ($report->client_last_read_at === null || $report->adjustment_updated_at->greaterThan($report->client_last_read_at));
        $latestAt = $report->latest_message_at;
        $latestAuthor = FeedbackAuthorType::tryFrom((string) $report->latest_message_author);

        return [
            'id' => $report->public_id,
            'number' => $number,
            'title' => $report->title,
            'status' => $report->status->label(),
            'deleted' => $report->isDeletedByClient(),
            'preview' => $report->latest_message_body !== null
                ? Str::limit(Str::squish((string) $report->latest_message_body), self::PREVIEW_LENGTH)
                : null,
            'preview_is_mine' => $latestAuthor !== null && ($latestAuthor !== FeedbackAuthorType::Reporter) === $isOwner,
            'latest_at' => $latestAt?->toIso8601String(),
            'latest_label' => $latestAt !== null ? $this->shortTime($latestAt) : null,
            'unread' => $unread,
            'adjustment_updated' => $adjustmentUpdated,
            'has_update' => $unread > 0 || $adjustmentUpdated,
            'messages_count' => (int) $report->feedback_messages_count,
            'thread_url' => route('feedback.conversations.show', [$project, $report]),
            'page_url' => route('feedback.reports.show', [$project, $report]),
            'sort_at' => ($latestAt ?? $report->created_at)->getTimestamp(),
        ];
    }

    /**
     * 清單右側的時間：今天顯示時分，今年顯示月日，更早顯示年月日（台北時間）。
     */
    private function shortTime(Carbon $at): string
    {
        $local = $at->copy()->timezone('Asia/Taipei');
        $today = now()->timezone('Asia/Taipei');

        return match (true) {
            $local->isSameDay($today) => $local->format('H:i'),
            $local->isSameYear($today) => $local->format('n/j'),
            default => $local->format('Y/n/j'),
        };
    }

    private function ensureCanManage(FeedbackProject $project, FeedbackAccess $access): void
    {
        if (! $access->canManage($project)) {
            $access->deny($project);
        }
    }
}
