<?php

namespace App\Providers;

use App\Contracts\FeedbackCodingAgent;
use App\Models\FeedbackReport;
use App\Services\CodexFeedbackCodingAgent;
use App\Support\FeedbackAccess;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(FeedbackCodingAgent::class, CodexFeedbackCodingAgent::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('feedback-public-submit', fn (Request $request): array => [
            Limit::perMinute(max(1, (int) config('feedback.public_reporting.throttle.per_minute')))->by('minute|'.$request->ip()),
            Limit::perHour(max(1, (int) config('feedback.public_reporting.throttle.per_hour')))->by('hour|'.$request->ip()),
        ]);

        RateLimiter::for('feedback-public-message', function (Request $request): array|Limit {
            $report = $request->route('feedbackReport');
            if (is_string($report)) {
                $report = FeedbackReport::query()->where('public_id', $report)->first();
            }

            if (! $report instanceof FeedbackReport || ! $report->isPublicReport()
                || app(FeedbackAccess::class)->isOwner($report->feedbackProject)) {
                return Limit::none();
            }

            return [
                Limit::perMinute(max(1, (int) config('feedback.public_reporting.message_throttle.per_minute')))->by('msg-minute|'.$request->ip()),
                Limit::perHour(max(1, (int) config('feedback.public_reporting.message_throttle.per_hour')))->by('msg-hour|'.$request->ip()),
            ];
        });
    }
}
