<?php

namespace App\Http\Controllers\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Http\Controllers\Controller;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Contracts\View\View;

class FeedbackPortalController extends Controller
{
    public function index(): View
    {
        return view('feedback.home');
    }

    public function show(FeedbackProject $feedbackProject, FeedbackAccess $access): View
    {
        if (! $access->canManage($feedbackProject)) {
            $access->deny($feedbackProject);
        }

        $sort = request()->string('sort')->toString();
        $sort = in_array($sort, ['title', 'status', 'created_at', 'latest_activity_at'], true)
            ? $sort
            : 'created_at';
        $direction = request()->string('direction')->toString() === 'asc' ? 'asc' : 'desc';
        $selectedStatus = FeedbackReportStatus::tryFrom(request()->string('status')->toString());
        $isOwner = $access->isOwner($feedbackProject);
        $deletedFilter = request()->string('deleted')->toString();
        $deletedFilter = $isOwner ? (in_array($deletedFilter, ['only', 'hide'], true) ? $deletedFilter : null) : 'hide';

        $sequenceNumbers = FeedbackReport::sequenceNumbersForProject($feedbackProject);
        $totalCount = $isOwner
            ? count($sequenceNumbers)
            : $feedbackProject->feedbackReports()->visibleToClient()->count();

        $statusCounts = FeedbackReport::statusCountsForProject($feedbackProject, includeClientDeleted: $isOwner);

        return view('feedback.portal', [
            'statusCounts' => $statusCounts,
            'sequenceNumbers' => array_map(fn (int $index): int => $index + 1, $sequenceNumbers),
            'totalCount' => $totalCount,
            'project' => $feedbackProject,
            'reports' => $reports = $feedbackProject->feedbackReports()
                ->with(['feedbackAttachments' => fn ($query) => $query->whereNull('feedback_message_id')])
                ->when($selectedStatus, fn ($query) => $query->where('status', $selectedStatus))
                ->when($deletedFilter === 'hide', fn ($query) => $query->whereNull('client_deleted_at'))
                ->when($deletedFilter === 'only', fn ($query) => $query->whereNotNull('client_deleted_at'))
                ->orderBy($sort, $direction)
                ->orderBy('id', $direction)
                ->paginate(50)
                ->withQueryString(),
            'sort' => $sort,
            'direction' => $direction,
            'selectedStatus' => $selectedStatus,
            'isOwner' => $isOwner,
            'deletedFilter' => $deletedFilter,
        ]);
    }
}
