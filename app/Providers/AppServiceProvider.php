<?php

namespace App\Providers;

use App\Contracts\FeedbackCodingAgent;
use App\Services\CodexFeedbackCodingAgent;
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
    }
}
