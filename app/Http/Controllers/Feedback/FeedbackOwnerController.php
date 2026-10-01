<?php

namespace App\Http\Controllers\Feedback;

use App\Enums\FeedbackReportStatus;
use App\Http\Controllers\Controller;
use App\Models\FeedbackProject;
use App\Support\FeedbackAccess;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;

class FeedbackOwnerController extends Controller
{
    public function authenticate(FeedbackProject $feedbackProject, FeedbackAccess $access): RedirectResponse
    {
        $token = request()->string('token')->toString();
        abort_unless($token !== '' && $access->validateOwnerToken($feedbackProject, $token), 403);

        $access->grantOwner($feedbackProject);

        return redirect()->route('feedback.owner.index', $feedbackProject);
    }

    public function index(FeedbackProject $feedbackProject, FeedbackAccess $access): View
    {
        abort_unless($access->isOwner($feedbackProject), 403);

        $status = FeedbackReportStatus::tryFrom(request()->string('status')->toString());
        $reports = $feedbackProject->feedbackReports()
            ->when($status, fn ($query) => $query->where('status', $status))
            ->latest('latest_activity_at')
            ->paginate(30)
            ->withQueryString();

        return view('feedback.owner.index', [
            'project' => $feedbackProject,
            'reports' => $reports,
            'statuses' => FeedbackReportStatus::cases(),
            'selectedStatus' => $status,
        ]);
    }
}
