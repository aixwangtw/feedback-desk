<?php

namespace App\Http\Controllers\Feedback;

use App\Actions\CreateFeedbackReportAction;
use App\Actions\DeleteFeedbackReportAction;
use App\Actions\UpdateFeedbackReportAction;
use App\Http\Controllers\Controller;
use App\Http\Requests\Feedback\StoreFeedbackReportRequest;
use App\Http\Requests\Feedback\UpdateFeedbackReportRequest;
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

    public function update(
        UpdateFeedbackReportRequest $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        UpdateFeedbackReportAction $updateFeedbackReport,
    ): RedirectResponse {
        $this->ensureProjectOwnsReport($feedbackProject, $feedbackReport);

        $updateFeedbackReport->handle($feedbackReport, $request->validated());

        return back()->with('success', "已更新「{$feedbackReport->title}」。");
    }

    public function destroy(
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAccess $access,
        DeleteFeedbackReportAction $deleteFeedbackReport,
    ): RedirectResponse {
        if (! $access->isOwner($feedbackProject)) {
            $access->deny($feedbackProject);
        }
        $this->ensureProjectOwnsReport($feedbackProject, $feedbackReport);

        $title = $feedbackReport->title;
        $deleteFeedbackReport->handle($feedbackReport);

        return redirect()
            ->route('feedback.portal', $feedbackProject)
            ->with('success', "已刪除「{$title}」。");
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

        if (! $access->canView($feedbackReport)) {
            $access->deny($feedbackProject);
        }

        $feedbackReport->load([
            'feedbackAttachments',
            'feedbackMessages.feedbackAttachments',
            'automationRuns' => fn ($query) => $query->latest(),
        ]);

        return view('feedback.reports.show', [
            'project' => $feedbackProject,
            'report' => $feedbackReport,
            'sequenceNumber' => $feedbackReport->sequenceNumber(),
            'canManage' => $access->canManage($feedbackProject),
        ]);
    }

    public function activity(
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAccess $access,
    ): View {
        $this->ensureProjectOwnsReport($feedbackProject, $feedbackReport);
        if (! $access->canView($feedbackReport)) {
            $access->deny($feedbackProject);
        }

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
