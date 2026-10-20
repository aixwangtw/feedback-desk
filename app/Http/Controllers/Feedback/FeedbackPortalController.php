<?php

namespace App\Http\Controllers\Feedback;

use App\Enums\FeedbackAttachmentKind;
use App\Enums\FeedbackCreatorType;
use App\Enums\FeedbackReportStatus;
use App\Http\Controllers\Controller;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use App\Support\PublicReporting;
use Closure;
use Illuminate\Contracts\View\View;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Pagination\Paginator;

class FeedbackPortalController extends Controller
{
    private const PER_PAGE = 50;

    public function index(PublicReporting $publicReporting, FeedbackAccess $access): View
    {
        if ($access->hasGlobalOwner()) {
            $projects = FeedbackProject::query()
                ->withCount([
                    'feedbackReports as total_reports_count',
                    'feedbackReports as unread_reports_count' => fn ($query) => $query->unreadByOwner(),
                ])
                ->orderBy('name')
                ->get();

            return view('feedback.projects-dashboard', [
                'projects' => $projects,
                'developer' => $access->currentDeveloper(),
            ]);
        }

        $project = $publicReporting->project();
        if ($project === null) {
            return view('feedback.home');
        }

        return view('feedback.public-home', [
            'project' => $project,
            'myReports' => $access->rememberedPublicReports($project),
            'turnstileSiteKey' => $publicReporting->turnstileEnabled()
                ? config('feedback.public_reporting.turnstile.site_key')
                : null,
        ]);
    }

    public function show(FeedbackProject $feedbackProject, FeedbackAccess $access): View
    {
        if (! $access->canManage($feedbackProject)) {
            $access->deny($feedbackProject);
        }

        $isOwner = $access->isOwner($feedbackProject);
        $viewer = $access->clientViewer($feedbackProject);
        $sort = request()->string('sort')->toString();
        // 預設 conversation：與右下角對話面板同一套排序；舊網址的 latest_message_at 已併入預設。
        $sort = in_array($sort, ['title', 'status', 'created_at', 'latest_activity_at'], true)
            ? $sort
            : 'conversation';
        $direction = request()->string('direction')->toString() === 'asc' ? 'asc' : 'desc';
        $selectedStatus = FeedbackReportStatus::tryFrom(request()->string('status')->toString());
        $keyword = mb_substr(trim(request()->string('q')->toString()), 0, 100);
        $viewMode = request()->string('view')->toString() === 'board' ? 'board' : 'list';
        $unreadOnly = $isOwner && request()->boolean('unread');
        $deletedFilter = request()->string('deleted')->toString();
        $deletedFilter = $isOwner ? (in_array($deletedFilter, ['only', 'hide'], true) ? $deletedFilter : null) : 'hide';

        $creatorOptions = $isOwner ? $this->creatorOptions($feedbackProject) : [];
        $creator = $isOwner ? request()->string('creator')->toString() : '';
        $creator = array_key_exists($creator, $creatorOptions) ? $creator : '';

        $sequenceNumbers = FeedbackReport::sequenceNumbersForProject($feedbackProject, clientCreatedOnly: ! $isOwner);
        $totalCount = $isOwner
            ? count($sequenceNumbers)
            : $feedbackProject->feedbackReports()->createdByClient()->visibleToClient()->count();

        $statusCounts = FeedbackReport::statusCountsForProject($feedbackProject, includeClientDeleted: $isOwner, clientCreatedOnly: ! $isOwner);

        // 欄位要在留言統計之前指定，否則 select 會蓋掉 withCount／withMax 加上的欄位。
        $filteredReports = fn (array $columns = ['feedback_reports.*']) => $feedbackProject->feedbackReports()
            ->select($columns)
            ->when(! $isOwner, fn ($query) => $query->createdByClient())
            ->when($creator !== '', fn ($query) => $query->createdBy($creator))
            ->when($isOwner, fn ($query) => $query->withOwnerMessageStats(), fn ($query) => $query
                ->withClientNewReplyCount($viewer)
                ->withCount('feedbackMessages')
                ->withMax('feedbackMessages as latest_message_at', 'created_at'))
            ->when($unreadOnly, fn ($query) => $query->unreadByOwner())
            ->when($selectedStatus, fn ($query) => $query->where('status', $selectedStatus))
            ->when($keyword !== '', fn ($query) => $query->where(fn ($query) => $query
                ->whereLike('title', "%{$keyword}%")
                ->orWhereLike('description', "%{$keyword}%")))
            ->when($deletedFilter === 'hide', fn ($query) => $query->whereNull('client_deleted_at'))
            ->when($deletedFilter === 'only', fn ($query) => $query->whereNotNull('client_deleted_at'));
        $withListRelations = fn ($query) => $query
            ->with(['creatorDeveloper', 'creatorClientAccount', 'feedbackProject'])
            ->with([
                'feedbackAttachments' => fn ($query) => $query->whereNull('feedback_message_id')->ofKind(FeedbackAttachmentKind::Feedback),
                'adjustmentAttachments',
            ]);

        $reports = $sort === 'conversation'
            ? $this->paginateInConversationOrder($filteredReports, $withListRelations, $sequenceNumbers, $isOwner)
            : $withListRelations($filteredReports())
                ->orderBy($sort, $direction)
                ->orderBy('id', $direction)
                ->paginate(self::PER_PAGE)
                ->withQueryString();

        return view('feedback.portal', [
            'statusCounts' => $statusCounts,
            'sequenceNumbers' => array_map(fn (int $index): int => $index + 1, $sequenceNumbers),
            'totalCount' => $totalCount,
            'project' => $feedbackProject,
            'reports' => $reports,
            'sort' => $sort,
            'direction' => $direction,
            'selectedStatus' => $selectedStatus,
            'keyword' => $keyword,
            'viewMode' => $viewMode,
            'isOwner' => $isOwner,
            'deletedFilter' => $deletedFilter,
            'creator' => $creator,
            'creatorOptions' => $creatorOptions,
            'unreadOnly' => $unreadOnly,
            'unreadReportCount' => $isOwner ? $feedbackProject->feedbackReports()->unreadByOwner()->count() : 0,
        ]);
    }

    /**
     * 預設排序：先取篩選後每張單的未讀與留言統計，用對話面板的規則排好，再只載入這一頁的完整資料。
     *
     * @param  Closure(array<int, string>=): HasMany<FeedbackReport, FeedbackProject>  $filteredReports  篩選後的單（含留言統計），參數為要取的欄位
     * @param  Closure(HasMany<FeedbackReport, FeedbackProject>): HasMany<FeedbackReport, FeedbackProject>  $withListRelations
     * @param  array<int, int>  $sequenceNumbers  report id => 從 0 起算的編號索引
     * @return LengthAwarePaginator<int, FeedbackReport>
     */
    private function paginateInConversationOrder(Closure $filteredReports, Closure $withListRelations, array $sequenceNumbers, bool $isOwner): LengthAwarePaginator
    {
        $orderedIds = $filteredReports(['feedback_reports.id', 'feedback_reports.created_at', 'feedback_reports.client_last_read_at', 'feedback_reports.adjustment_updated_at'])
            ->get()
            ->sort(fn (FeedbackReport $a, FeedbackReport $b): int => $b->conversationSortKeyFor($isOwner, ($sequenceNumbers[$b->id] ?? 0) + 1)
                <=> $a->conversationSortKeyFor($isOwner, ($sequenceNumbers[$a->id] ?? 0) + 1))
            ->pluck('id')
            ->values();

        $page = Paginator::resolveCurrentPage();
        $pageIds = $orderedIds->forPage($page, self::PER_PAGE)->values();
        $pageReports = $pageIds->isEmpty()
            ? new EloquentCollection
            : $withListRelations($filteredReports())
                ->whereKey($pageIds->all())
                ->get()
                ->sortBy(fn (FeedbackReport $report): int|false => $pageIds->search($report->id))
                ->values();

        return (new LengthAwarePaginator($pageReports, $orderedIds->count(), self::PER_PAGE, $page, [
            'path' => Paginator::resolveCurrentPath(),
        ]))->withQueryString();
    }

    /**
     * 開發者端「建立者」下拉的選項：篩選值 => 顯示名稱。
     *
     * @return array<string, string>
     */
    private function creatorOptions(FeedbackProject $project): array
    {
        $options = ['client' => $project->clientLabel()];

        foreach ($project->clientAccounts()->orderBy('name')->orderBy('id')->get() as $account) {
            $options["client:{$account->id}"] = $project->clientLabel().'：'.$account->name;
        }

        foreach (FeedbackDeveloper::query()->orderBy('name')->orderBy('id')->get() as $developer) {
            $options["developer:{$developer->id}"] = $developer->name;
        }

        if ($project->public_reporting_enabled || $project->feedbackReports()->where('creator_type', FeedbackCreatorType::Public->value)->exists()) {
            $options['public'] = '公開回報';
        }

        return $options + ['shared' => config('feedback.labels.owner').'（共用）'];
    }
}
