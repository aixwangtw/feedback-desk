<?php

namespace App\Providers;

use App\Contracts\FeedbackCodingAgent;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Services\ClaudeCodeFeedbackCodingAgent;
use App\Services\CodexFeedbackCodingAgent;
use App\Support\FeedbackAccess;
use Google\Auth\Credentials\GCECredentials;
use Google\Auth\Credentials\ImpersonatedServiceAccountCredentials;
use Google\Cloud\Storage\StorageClient;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\ServiceProvider;
use InvalidArgumentException;
use League\Flysystem\Filesystem as Flysystem;
use Spatie\GoogleCloudStorage\GoogleCloudStorageAdapter;
use Spatie\GoogleCloudStorage\GoogleCloudStorageServiceProvider;

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
        // gcs 磁碟：沿用 spatie 套件的轉接器，只換掉建立 client 的方式（組織政策禁止服務帳戶金鑰，改用模擬）。
        Storage::extend('gcs-impersonated', function ($app, array $config) {
            $provider = new GoogleCloudStorageServiceProvider($app);
            $config = $provider->prepareConfig($config);

            $options = [];
            if (is_string($config['projectId'] ?? null) && $config['projectId'] !== '') {
                $options['projectId'] = $config['projectId'];
            }
            if (is_string($config['impersonateServiceAccount'] ?? null) && $config['impersonateServiceAccount'] !== '') {
                $options['credentialsFetcher'] = new ImpersonatedServiceAccountCredentials(
                    ['https://www.googleapis.com/auth/devstorage.read_write'],
                    [
                        'service_account_impersonation_url' => 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'.$config['impersonateServiceAccount'].':generateAccessToken',
                        'source_credentials' => new GCECredentials,
                    ],
                );
            }
            $client = new StorageClient($options);
            $adapter = $provider->createAdapter($client, $config);

            return new GoogleCloudStorageAdapter(new Flysystem($adapter, $config), $adapter, $config, $client);
        });

        // 排程 API：每個 token 每分鐘 60 次，同一 IP 每分鐘 120 次（含錯誤 token）。
        RateLimiter::for('feedback-patrol', fn (Request $request): array => [
            Limit::perMinute(60)->by('patrol-token|'.hash('sha256', (string) $request->bearerToken())),
            Limit::perMinute(120)->by('patrol-ip|'.$request->ip()),
        ]);

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
