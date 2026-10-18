<?php

namespace App\Http\Controllers\Feedback;

use App\Actions\CreateFeedbackReportAction;
use App\Enums\FeedbackCreatorType;
use App\Http\Controllers\Controller;
use App\Http\Requests\Feedback\StorePublicFeedbackReportRequest;
use App\Support\FeedbackAccess;
use App\Support\PublicReporting;
use Illuminate\Http\RedirectResponse;

class FeedbackPublicReportController extends Controller
{
    public function store(
        StorePublicFeedbackReportRequest $request,
        PublicReporting $publicReporting,
        CreateFeedbackReportAction $createFeedbackReport,
        FeedbackAccess $access,
    ): RedirectResponse {
        if ($request->honeypotTripped()) {
            return redirect()->route('feedback.home');
        }

        $project = $publicReporting->project();
        abort_if($project === null, 404);

        $validated = $request->validated();
        $reporterName = trim((string) ($validated['reporter_name'] ?? ''));

        $created = $createFeedbackReport->handle(
            $project,
            [
                'title' => $validated['title'],
                'description' => $validated['description'],
                'reporter_name' => $reporterName !== '' ? $reporterName : null,
                'screenshots' => $validated['screenshots'] ?? [],
            ],
            ['creator_type' => FeedbackCreatorType::Public, 'creator_developer_id' => null],
        );

        $access->grantReporter($created['report']);
        $access->rememberPublicReport($created['report'], $created['reporter_token']);

        return redirect()
            ->route('feedback.reports.show', [$project, $created['report']])
            ->with('private_report_url', route('feedback.reports.show', [$project, $created['report']]).'?access='.$created['reporter_token']);
    }
}
