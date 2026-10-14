<?php

namespace App\Http\Controllers\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Http\Controllers\Controller;
use App\Models\FeedbackProject;
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
        abort_unless($access->canManage($feedbackProject), 403);

        $sort = request()->string('sort')->toString();
        $sort = in_array($sort, ['title', 'status', 'created_at', 'latest_activity_at'], true)
            ? $sort
            : 'latest_activity_at';
        $direction = request()->string('direction')->toString() === 'asc' ? 'asc' : 'desc';
        $selectedStatus = FeedbackReportStatus::tryFrom(request()->string('status')->toString());

        return view('feedback.portal', [
            'project' => $feedbackProject,
            'reports' => $feedbackProject->feedbackReports()
                ->with(['feedbackAttachments' => fn ($query) => $query->whereNull('feedback_message_id')])
                ->when($selectedStatus, fn ($query) => $query->where('status', $selectedStatus))
                ->orderBy($sort, $direction)
                ->paginate(50)
                ->withQueryString(),
            'sort' => $sort,
            'direction' => $direction,
            'selectedStatus' => $selectedStatus,
            'isOwner' => $access->isOwner($feedbackProject),
        ]);
    }
}
