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
use Illuminate\Contracts\View\View;

class FeedbackPortalController extends Controller
{
    public function index(PublicReporting $publicReporting, FeedbackAccess $access): View
    {
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
        $sort = request()->string('sort')->toString();
        $sort = in_array($sort, ['title', 'status', 'created_at', 'latest_activity_at', 'latest_message_at'], true)
            ? $sort
            : 'created_at';
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

        return view('feedback.portal', [
            'statusCounts' => $statusCounts,
            'sequenceNumbers' => array_map(fn (int $index): int => $index + 1, $sequenceNumbers),
            'totalCount' => $totalCount,
            'project' => $feedbackProject,
            'reports' => $reports = $feedbackProject->feedbackReports()
                ->when(! $isOwner, fn ($query) => $query->createdByClient())
                ->when($creator !== '', fn ($query) => $query->createdBy($creator))
                ->with($isOwner ? ['creatorDeveloper', 'feedbackProject'] : [])
                ->when($isOwner, fn ($query) => $query->withOwnerMessageStats(), fn ($query) => $query
                    ->withClientNewReplyCount()
                    ->withCount('feedbackMessages')
                    ->withMax('feedbackMessages as latest_message_at', 'created_at'))
                ->when($unreadOnly, fn ($query) => $query->unreadByOwner())
                ->with([
                    'feedbackAttachments' => fn ($query) => $query->whereNull('feedback_message_id')->ofKind(FeedbackAttachmentKind::Feedback),
                    'adjustmentAttachments',
                ])
                ->when($selectedStatus, fn ($query) => $query->where('status', $selectedStatus))
                ->when($keyword !== '', fn ($query) => $query->where(fn ($query) => $query
                    ->whereLike('title', "%{$keyword}%")
                    ->orWhereLike('description', "%{$keyword}%")))
                ->when($deletedFilter === 'hide', fn ($query) => $query->whereNull('client_deleted_at'))
                ->when($deletedFilter === 'only', fn ($query) => $query->whereNotNull('client_deleted_at'))
                ->orderBy($sort, $direction)
                ->orderBy('id', $direction)
                ->paginate(50)
                ->withQueryString(),
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
     * 開發者端「建立者」下拉的選項：篩選值 => 顯示名稱。
     *
     * @return array<string, string>
     */
    private function creatorOptions(FeedbackProject $project): array
    {
        $options = ['client' => $project->clientLabel()];

        foreach (FeedbackDeveloper::query()->orderBy('name')->orderBy('id')->get() as $developer) {
            $options["developer:{$developer->id}"] = $developer->name;
        }

        if ($project->public_reporting_enabled || $project->feedbackReports()->where('creator_type', FeedbackCreatorType::Public->value)->exists()) {
            $options['public'] = '公開回報';
        }

        return $options + ['shared' => config('feedback.labels.owner').'（共用）'];
    }
}
