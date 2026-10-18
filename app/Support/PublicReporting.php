<?php

namespace App\Support;

use App\Models\FeedbackProject;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class PublicReporting
{
    public const MAX_SCREENSHOTS = 3;

    public const MAX_SCREENSHOT_KILOBYTES = 5 * 1024;

    /**
     * 首頁公開回報對應的專案；沒設定代稱或該專案未開啟時為 null。
     */
    public function project(): ?FeedbackProject
    {
        $slug = config('feedback.public_reporting.home_project');
        if (! is_string($slug) || $slug === '') {
            return null;
        }

        return FeedbackProject::query()
            ->where('slug', $slug)
            ->where('public_reporting_enabled', true)
            ->first();
    }

    public function turnstileEnabled(): bool
    {
        $hasSiteKey = filled(config('feedback.public_reporting.turnstile.site_key'));
        $hasSecretKey = filled(config('feedback.public_reporting.turnstile.secret_key'));

        if ($hasSiteKey !== $hasSecretKey && Cache::add('feedback.turnstile-half-configured-warned', true, now()->addDay())) {
            Log::warning('FEEDBACK_TURNSTILE_SITE_KEY 與 FEEDBACK_TURNSTILE_SECRET_KEY 只設了一個，Turnstile 沒有啟用。');
        }

        return $hasSiteKey && $hasSecretKey;
    }
}
