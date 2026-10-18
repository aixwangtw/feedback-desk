<?php

namespace App\Console\Commands;

use App\Models\FeedbackProject;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('feedback:public-reporting {project : 專案 slug} {mode : on 開啟，off 關閉} {--force : 即使專案已有客戶入口或帳號仍強制開啟}')]
#[Description('開關專案的首頁公開回報；實際顯示還需要 FEEDBACK_HOME_PUBLIC_PROJECT 指向這個專案')]
class SetFeedbackPublicReportingCommand extends Command
{
    public function handle(): int
    {
        $mode = strtolower((string) $this->argument('mode'));
        if (! in_array($mode, ['on', 'off'], true)) {
            $this->components->error('mode 只能是 on 或 off。');

            return self::FAILURE;
        }

        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if ($project === null) {
            $this->components->error('找不到這個專案。');

            return self::FAILURE;
        }

        if ($mode === 'on' && ! $this->option('force') && $this->clientAccessSettings($project) !== []) {
            $this->components->error('這個專案已有客戶入口或帳號：'.implode('、', $this->clientAccessSettings($project)).'。公開回報請開在專用專案；確定要開請加 --force。');

            return self::FAILURE;
        }

        $project->update(['public_reporting_enabled' => $mode === 'on']);

        if ($mode === 'off') {
            $this->components->info("已關閉 {$project->name} 的公開回報。");

            return self::SUCCESS;
        }

        $this->components->info("已開啟 {$project->name} 的公開回報。");
        if (config('feedback.public_reporting.home_project') !== $project->slug) {
            $this->components->warn("首頁尚未顯示：請在 .env 設定 FEEDBACK_HOME_PUBLIC_PROJECT={$project->slug}。");
        }

        return self::SUCCESS;
    }

    /**
     * @return list<string>
     */
    private function clientAccessSettings(FeedbackProject $project): array
    {
        return array_keys(array_filter([
            'client_username' => filled($project->client_username),
            'client_token_hash' => filled($project->client_token_hash),
            'login_prefill_username' => filled($project->login_prefill_username),
            'login_prefill_password' => filled($project->login_prefill_password),
        ]));
    }
}
