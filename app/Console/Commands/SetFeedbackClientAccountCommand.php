<?php

namespace App\Console\Commands;

use App\Models\FeedbackProject;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

#[Signature('feedback:client-account {project : 專案 slug} {username : 客戶帳號} {--password= : 指定密碼；省略則產生隨機密碼} {--prefill : 登入頁預填這組帳號密碼}')]
#[Description('設定單一專案的客戶登入帳號；帳密只對該專案有效')]
class SetFeedbackClientAccountCommand extends Command
{
    public function handle(): int
    {
        $project = FeedbackProject::where('slug', (string) $this->argument('project'))->first();
        if ($project === null) {
            $this->components->error('找不到這個專案。');

            return self::FAILURE;
        }

        $username = trim((string) $this->argument('username'));
        if ($username === '' || mb_strlen($username) > 50) {
            $this->components->error('帳號不可為空白，且不可超過 50 字。');

            return self::FAILURE;
        }

        $givenPassword = $this->option('password');
        if ($givenPassword === '') {
            $this->components->error('--password 不可為空白。');

            return self::FAILURE;
        }

        $password = $givenPassword ?? Str::password(24, symbols: false);
        $prefill = (bool) $this->option('prefill');

        $project->update([
            'client_username' => $username,
            'client_password_hash' => Hash::make($password),
            'login_prefill_username' => $prefill ? $username : null,
            'login_prefill_password' => $prefill ? $password : null,
        ]);

        $this->components->info("已設定 {$project->name} 的客戶帳號");
        $this->line("帳號：{$username}");
        if ($givenPassword === null) {
            $this->line("密碼：{$password}");
            $this->components->warn('明文只會顯示這一次；舊的長效登入已全部失效。');
        }
        $this->line($prefill ? '登入頁會預填這組帳號密碼。' : '登入頁不預填。');

        return self::SUCCESS;
    }
}
