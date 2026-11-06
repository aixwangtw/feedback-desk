<?php

namespace App\Support;

use App\Enums\FeedbackAuthorType;
use App\Models\FeedbackMessage;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * 頁首通知鈴鐺：只列「對方」發的、自己還沒讀的留言。
 * 開發團隊：客戶（回報者）的新留言，範圍是登入可看的專案（全域登入＝全部專案）；另列待審留言（草稿）。
 * 客戶：開發團隊（含 AI）在她看得到的單上的新留言；草稿永遠不列。
 */
class FeedbackNotifications
{
    public const MAX_ITEMS = 20;

    private const EXCERPT_WIDTH = 80;

    public function __construct(private FeedbackAccess $access) {}

    /**
     * 沒有登入身分（公開頁、登入頁）時回 null，不顯示鈴鐺。
     *
     * @return array{total: int, items: list<array{project: string, title: string, excerpt: string, at: CarbonInterface, url: string, unread: int, public_id: string}>, drafts: list<array{project: string, title: string, count: int, url: string, public_id: string}>, is_owner: bool}|null
     */
    public function forCurrentViewer(?FeedbackProject $project): ?array
    {
        if ($this->access->hasGlobalOwner()) {
            return $this->forTeam(FeedbackProject::query()->pluck('id')->all());
        }
        if ($project === null || ! $this->access->canManage($project)) {
            return null;
        }
        if ($this->access->isOwner($project)) {
            return $this->forTeam([$project->id]);
        }

        return $this->forClient($project);
    }

    /**
     * @param  list<int>  $projectIds
     */
    private function forTeam(array $projectIds): array
    {
        $reports = FeedbackReport::query()
            ->whereIn('feedback_project_id', $projectIds)
            ->unreadByOwner()
            ->withOwnerMessageStats()
            ->with('feedbackProject')
            ->get();

        $items = $this->items($reports, true, fn (FeedbackReport $report): int => $report->unreadCountFor(true));

        $drafts = FeedbackReport::query()
            ->whereIn('feedback_project_id', $projectIds)
            ->whereHas('messageDrafts')
            ->withCount('messageDrafts')
            ->with('feedbackProject')
            ->latest('latest_activity_at')
            ->limit(self::MAX_ITEMS)
            ->get()
            ->map(fn (FeedbackReport $report): array => [
                'project' => $report->feedbackProject->name,
                'title' => $report->title,
                'count' => (int) $report->message_drafts_count,
                'url' => route('feedback.reports.show', [$report->feedbackProject, $report], false).'#message-drafts',
                'public_id' => $report->public_id,
            ])->all();

        return ['total' => $items['total'], 'items' => $items['list'], 'drafts' => $drafts, 'is_owner' => true];
    }

    private function forClient(FeedbackProject $project): array
    {
        $reports = $project->feedbackReports()
            ->createdByClient()
            ->visibleToClient()
            ->withClientNewReplyCount($this->access->clientViewer($project))
            ->with('feedbackProject')
            ->get()
            ->filter(fn (FeedbackReport $report): bool => $report->unreadCountFor(false) > 0);

        $items = $this->items($reports, false, fn (FeedbackReport $report): int => $report->unreadCountFor(false));

        return ['total' => $items['total'], 'items' => $items['list'], 'drafts' => [], 'is_owner' => false];
    }

    /**
     * 每張單取對方最新一則留言當摘要，依時間新到舊。
     *
     * @param  Collection<int, FeedbackReport>  $reports
     * @param  callable(FeedbackReport): int  $unread
     * @return array{total: int, list: list<array<string, mixed>>}
     */
    private function items(Collection $reports, bool $forOwner, callable $unread): array
    {
        $total = 0;
        $list = [];
        foreach ($reports as $report) {
            $count = $unread($report);
            $total += $count;
            $latest = FeedbackMessage::query()
                ->where('feedback_report_id', $report->id)
                ->when(
                    $forOwner,
                    fn (Builder $query) => $query->where('author_type', FeedbackAuthorType::Reporter->value),
                    fn (Builder $query) => $query->where('author_type', '!=', FeedbackAuthorType::Reporter->value),
                )
                ->latest('created_at')
                ->latest('id')
                ->first();
            if ($latest === null) {
                continue;
            }
            $list[] = [
                'project' => $report->feedbackProject->name,
                'title' => $report->title,
                'excerpt' => mb_strimwidth(preg_replace('/\s+/u', ' ', $latest->body) ?? '', 0, self::EXCERPT_WIDTH, '…'),
                'at' => $latest->created_at,
                'url' => route('feedback.reports.show', [$report->feedbackProject, $report], false).'#conversation',
                'unread' => $count,
                'public_id' => $report->public_id,
            ];
        }

        usort($list, fn (array $a, array $b): int => $b['at'] <=> $a['at']);

        return ['total' => $total, 'list' => array_slice($list, 0, self::MAX_ITEMS)];
    }
}
