<?php

namespace App\Providers;

use App\Contracts\FeedbackCodingAgent;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Services\ClaudeCodeFeedbackCodingAgent;
use App\Services\CodexFeedbackCodingAgent;
use App\Support\FeedbackAccess;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use InvalidArgumentException;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->bind(FeedbackCodingAgent::class, fn (): FeedbackCodingAgent => match ($driver = config('feedback.automation.driver')) {
            'codex' => $this->app->make(CodexFeedbackCodingAgent::class),
            'claude' => $this->app->make(ClaudeCodeFeedbackCodingAgent::class),
            default => throw new InvalidArgumentException('不支援的自動處理驅動：'.(is_scalar($driver) ? $driver : gettype($driver)).'（可用值：codex、claude）。'),
        });
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

        RateLimiter::for('feedback-guest-submit', function (Request $request): array|Limit {
            if (! self::isGuestRequest($request)) {
                return Limit::none();
            }

            return [
                Limit::perMinute(max(1, (int) config('feedback.public_reporting.throttle.per_minute')))->by('guest-minute|'.$request->ip()),
                Limit::perHour(max(1, (int) config('feedback.public_reporting.throttle.per_hour')))->by('guest-hour|'.$request->ip()),
            ];
        });

        RateLimiter::for('feedback-guest-message', function (Request $request): array|Limit {
            if (! self::isGuestRequest($request)) {
                return Limit::none();
            }

            return [
                Limit::perMinute(max(1, (int) config('feedback.public_reporting.message_throttle.per_minute')))->by('guest-msg-minute|'.$request->ip()),
                Limit::perHour(max(1, (int) config('feedback.public_reporting.message_throttle.per_hour')))->by('guest-msg-hour|'.$request->ip()),
            ];
        });

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

    /**
     * 這個請求是不是透過免登入入口（沒登入、以指定客戶帳號身分）送出。
     */
    private static function isGuestRequest(Request $request): bool
    {
        $project = $request->route('feedbackProject');
        if (is_string($project)) {
            $project = FeedbackProject::query()->where('slug', $project)->first();
        }

        return $project instanceof FeedbackProject && app(FeedbackAccess::class)->isGuest($project);
    }
}
