<?php

namespace App\Console\Commands;

use App\Models\FeedbackProject;
use App\Support\FeedbackClientAccountManager;
use App\Support\FeedbackServiceException;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('feedback:client-account {project : 專案 slug} {username : 客戶帳號} {--name= : 顯示名稱；新帳號省略則用帳號} {--password= : 指定密碼；省略則產生隨機密碼} {--prefill : 登入頁預填這組帳號密碼}')]
#[Description('新增專案的客戶帳號（每位客戶一個），或重設既有客戶帳號系統產生的密碼')]
class SetFeedbackClientAccountCommand extends Command
{
    public function handle(FeedbackClientAccountManager $accounts): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if ($project === null) {
            $this->components->error('找不到這個專案。');

            return self::FAILURE;
        }

        $username = trim((string) $this->argument('username'));
        $givenPassword = $this->option('password');
        if ($givenPassword === '' || $this->option('name') === '') {
            $this->components->error('--password 與 --name 不可為空白。');

            return self::FAILURE;
        }
        $prefill = (bool) $this->option('prefill');

        $existing = $project->clientAccounts()->where('username', $username)->first();

        try {
            if ($existing === null) {
                $created = $accounts->create($project, $username, $this->option('name'), $givenPassword, $prefill);
                $account = $created['account'];
                $password = $created['password'];
                $this->components->info("已新增 {$project->name} 的客戶帳號");
            } else {
                $password = $accounts->reset($existing, $givenPassword, $prefill);
                $account = $existing;
                if ($this->option('name') !== null) {
                    $account->forceFill(['name' => trim((string) $this->option('name'))])->save();
                }
                $this->components->info("已重設 {$project->name} 的客戶帳號密碼");
            }
        } catch (FeedbackServiceException $exception) {
            $this->components->error($exception->getMessage());

            return self::FAILURE;
        }

        $this->line("帳號：{$account->username}");
        $this->line("顯示名稱：{$account->name}");
        if ($givenPassword === null) {
            $this->line("密碼：{$password}");
            $this->components->warn('明文只會顯示這一次；請私下交給本人。本人登入後可在「我的帳號」改名字與密碼。');
        }
        if ($existing !== null) {
            $this->components->warn('這個帳號先前的登入與 AI 工具 token 已全部失效。');
        }
        $this->line($prefill ? '登入頁會預填這組帳號密碼。' : '登入頁不預填。');
        $this->line('登入頁：'.route('feedback.login', $project));

        return self::SUCCESS;
    }
}
