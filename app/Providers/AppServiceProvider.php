<?php

namespace App\Providers;

use App\Contracts\FeedbackCodingAgent;
use App\Services\CodexFeedbackCodingAgent;
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
        //
    }
}
