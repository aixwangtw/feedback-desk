<?php

namespace App\Console\Commands;

use App\Models\FeedbackClientAccount;
use App\Models\FeedbackProject;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Symfony\Component\Console\Formatter\OutputFormatter;

#[Signature('feedback:clients {project : 專案 slug}')]
#[Description('列出專案的客戶帳號')]
class ListFeedbackClientAccountsCommand extends Command
{
    public function handle(): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if ($project === null) {
            $this->components->error('找不到這個專案。');

            return self::FAILURE;
        }

        $accounts = $project->clientAccounts()->orderBy('name')->orderBy('id')->get();
        if ($accounts->isEmpty()) {
            $this->components->info('這個專案還沒有客戶帳號。用 feedback:client-account 新增。');

            return self::SUCCESS;
        }

        $this->table(['id', '帳號', '顯示名稱', '狀態', '密碼'], $accounts->map(fn (FeedbackClientAccount $account): array => [
            $account->id,
            OutputFormatter::escape($account->username),
            OutputFormatter::escape($account->name),
            $account->isDisabled() ? '已停用' : '啟用中',
            $account->password_set_by_self ? '本人設定' : '系統產生',
        ])->all());

        return self::SUCCESS;
    }
}
