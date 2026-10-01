<?php

namespace App\Http\Controllers\Feedback;

use App\Actions\CreateFeedbackReportAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Feedback\StoreFeedbackReportRequest;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;

class FeedbackReportController extends Controller
{
    public function store(
        StoreFeedbackReportRequest $request,
        FeedbackProject $feedbackProject,
        CreateFeedbackReportAction $createFeedbackReport,
        FeedbackAccess $access,
    ): RedirectResponse {
        $issues = $request->validated('issues');

        foreach ($issues as $issue) {
            $created = $createFeedbackReport->handle($feedbackProject, $issue);
            $access->grantReporter($created['report']);
        }

        return redirect()
            ->route('feedback.portal', $feedbackProject)
            ->with('success', '已新增 '.count($issues).' 個問題。');
    }

    public function show(
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAccess $access,
    ): View|RedirectResponse {
        $this->ensureProjectOwnsReport($feedbackProject, $feedbackReport);
        $token = request()->string('access')->toString();

        if ($token !== '' && $access->validateReporterToken($feedbackReport, $token)) {
            $access->grantReporter($feedbackReport);

            return redirect()->route('feedback.reports.show', [$feedbackProject, $feedbackReport]);
        }

        abort_unless($access->canView($feedbackReport), 403);

        $feedbackReport->load([
            'feedbackAttachments',
            'feedbackMessages.feedbackAttachments',
            'automationRuns' => fn ($query) => $query->latest(),
        ]);

        return view('feedback.reports.show', [
            'project' => $feedbackProject,
            'report' => $feedbackReport,
            'isOwner' => $access->isOwner($feedbackProject),
        ]);
    }

    public function activity(
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAccess $access,
    ): View {
        $this->ensureProjectOwnsReport($feedbackProject, $feedbackReport);
        abort_unless($access->canView($feedbackReport), 403);

        $feedbackReport->load('feedbackMessages.feedbackAttachments');

        return view('feedback.reports._activity', [
            'project' => $feedbackProject,
            'report' => $feedbackReport,
        ]);
    }

    private function ensureProjectOwnsReport(FeedbackProject $project, FeedbackReport $report): void
    {
        abort_unless($report->feedback_project_id === $project->id, 404);
    }
}
