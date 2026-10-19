<?php

namespace App\Console\Commands;

use App\Models\FeedbackProject;
use App\Support\FeedbackClientAccountManager;
use App\Support\FeedbackServiceException;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('feedback:client-delete {project : 專案 slug} {username : 客戶帳號} {--force : 不再確認}')]
#[Description('刪除客戶帳號（寫過的單與留言保留）；本人自設密碼的帳號不能刪，請改用停用')]
class DeleteFeedbackClientAccountCommand extends Command
{
    public function handle(FeedbackClientAccountManager $accounts): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        $account = $project?->clientAccounts()->where('username', (string) $this->argument('username'))->first();
        if ($account === null) {
            $this->components->error('找不到這個專案或客戶帳號。');

            return self::FAILURE;
        }

        if (! $this->option('force') && ! $this->confirm("確定要刪除 {$account->username}？寫過的單與留言會保留。")) {
            return self::FAILURE;
        }

        try {
            $accounts->delete($account);
        } catch (FeedbackServiceException $exception) {
            $this->components->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->components->info("已刪除 {$account->username}");

        return self::SUCCESS;
    }
}
