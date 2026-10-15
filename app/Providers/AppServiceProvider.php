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
        RateLimiter::for('feedback-login', fn (Request $request): array => [
            Limit::perMinute(5)->by('feedback-login:'.mb_strtolower((string) $request->input('username')).'|'.$request->ip()),
            Limit::perMinute(20)->by('feedback-login-ip:'.$request->ip()),
            Limit::perHour(50)->by('feedback-login-ip-hourly:'.$request->ip()),
        ]);
    }
}
