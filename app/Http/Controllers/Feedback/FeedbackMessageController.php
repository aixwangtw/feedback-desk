<?php

namespace App\Http\Controllers\Feedback;

use App\Enums\FeedbackAuthorType;
use App\Http\Controllers\Controller;
use App\Http\Requests\Feedback\StoreFeedbackMessageRequest;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;

class FeedbackMessageController extends Controller
{
    public function store(
        StoreFeedbackMessageRequest $request,
        FeedbackProject $feedbackProject,
        FeedbackReport $feedbackReport,
        FeedbackAccess $access,
    ): RedirectResponse {
        abort_unless($feedbackReport->feedback_project_id === $feedbackProject->id, 404);
        $validated = $request->validated();

        DB::transaction(function () use ($validated, $feedbackReport, $access, $feedbackProject): void {
            $isOwner = $access->isOwner($feedbackProject);
            $developer = $access->currentDeveloper($feedbackProject);
            $message = $feedbackReport->feedbackMessages()->create([
                'author_type' => $isOwner ? FeedbackAuthorType::Owner : FeedbackAuthorType::Reporter,
                'author_name' => match (true) {
                    $isOwner && $feedbackReport->isPublicReport() => config('feedback.labels.owner'),
                    $isOwner => $developer?->name ?? config('feedback.labels.owner'),
                    $feedbackReport->isPublicReport() => $feedbackReport->reporter_name ?: '公開回報者',
                    default => config('feedback.labels.client'),
                },
                'body' => $validated['body'],
            ]);

            foreach ($validated['screenshots'] ?? [] as $screenshot) {
                $path = $screenshot->store("feedback/{$feedbackProject->id}/{$feedbackReport->public_id}", config('feedback.disk'));
                $message->feedbackAttachments()->create([
                    'feedback_report_id' => $feedbackReport->id,
                    'disk' => config('feedback.disk'),
                    'path' => $path,
                    'original_name' => $screenshot->getClientOriginalName(),
                    'mime_type' => $screenshot->getMimeType() ?? 'application/octet-stream',
                    'size' => $screenshot->getSize(),
                ]);
            }

            $feedbackReport->update(['latest_activity_at' => now()]);
        });

        return back()->with('success', '訊息已送出。');
    }
}
