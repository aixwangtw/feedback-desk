<?php

namespace App\Http\Controllers\Feedback;

use App\Actions\CreateFeedbackReportAction;
use App\Actions\DeleteFeedbackReportAction;
use App\Actions\UpdateFeedbackReportAction;
use App\Enums\FeedbackAttachmentKind;
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
        $creator = $access->creatorFor($feedbackProject);

        foreach ($issues as $issue) {
            $created = $createFeedbackReport->handle($feedbackProject, $issue, $creator);
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
        $access->ensureReportVisible($feedbackReport);
        $token = request()->string('access')->toString();

        if ($token !== '' && $access->validateReporterToken($feedbackReport, $token)) {
            $access->grantReporter($feedbackReport);

            return redirect()->route('feedback.reports.show', [$feedbackProject, $feedbackReport]);
        }

        if (! $access->canView($feedbackReport)) {
            $access->deny($feedbackProject);
        }

        $feedbackReport->load([
            'feedbackAttachments' => fn ($query) => $query->ofKind(FeedbackAttachmentKind::Feedback),
            'adjustmentAttachments',
            'feedbackMessages.feedbackAttachments',
            'automationRuns' => fn ($query) => $query->latest(),
        ]);

        return view('feedback.reports.show', [
            'project' => $feedbackProject,
            'report' => $feedbackReport,
            'sequenceNumber' => $feedbackReport->sequenceNumber(clientCreatedOnly: ! $access->isOwner($feedbackProject)),
            'canManage' => $access->canManage($feedbackProject),
            'isOwner' => $access->isOwner($feedbackProject),
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
        $access->ensureReportVisible($feedbackReport);

        $feedbackReport->load('feedbackMessages.feedbackAttachments');

        return view('feedback.reports._activity', [
            'project' => $feedbackProject,
            'report' => $feedbackReport,
        ]);
    }

    /**
     * Teacher deletion only hides the report; the owner can still see and restore it.
     */
    public function clientDestroy(
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAccess $access,
    ): RedirectResponse {
        if (! $access->isClient($feedbackProject)) {
            $access->deny($feedbackProject);
        }
        $this->ensureProjectOwnsReport($feedbackProject, $feedbackReport);
        $access->ensureReportVisible($feedbackReport);
        abort_if($feedbackReport->isDeletedByClient(), 404);

        $feedbackReport->update(['client_deleted_at' => now()]);

        return redirect()
            ->route('feedback.portal', $feedbackProject)
            ->with('success', "已刪除「{$feedbackReport->title}」。");
    }

    public function restore(
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAccess $access,
    ): RedirectResponse {
        if (! $access->isOwner($feedbackProject)) {
            $access->deny($feedbackProject);
        }
        $this->ensureProjectOwnsReport($feedbackProject, $feedbackReport);

        $feedbackReport->update(['client_deleted_at' => null]);

        return back()->with('success', '已還原「'.$feedbackReport->title.'」，'.config('feedback.labels.client').'端會重新看到。');
    }

    private function ensureProjectOwnsReport(FeedbackProject $project, FeedbackReport $report): void
    {
        abort_unless($report->feedback_project_id === $project->id, 404);
    }
}
