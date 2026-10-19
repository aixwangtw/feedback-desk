<?php

namespace App\Console\Commands;

use App\Models\FeedbackProject;
use App\Support\FeedbackClientAccountManager;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('feedback:client-disable {project : 專案 slug} {username : 客戶帳號} {--enable : 重新啟用}')]
#[Description('停用客戶帳號（登入與 AI 工具 token 立即失效，寫過的單保留），或用 --enable 重新啟用')]
class DisableFeedbackClientAccountCommand extends Command
{
    public function handle(FeedbackClientAccountManager $accounts): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        $account = $project?->clientAccounts()->where('username', (string) $this->argument('username'))->first();
        if ($account === null) {
            $this->components->error('找不到這個專案或客戶帳號。');

            return self::FAILURE;
        }

        $enable = (bool) $this->option('enable');
        $accounts->setDisabled($account, ! $enable);
        $this->components->info($enable ? "已重新啟用 {$account->username}" : "已停用 {$account->username}，登入與 token 立即失效");

        return self::SUCCESS;
    }
}
