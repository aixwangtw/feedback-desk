<?php

namespace App\Console\Commands;

use App\Support\FeedbackAccess;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

#[Signature('feedback:account-password {account : 角色（目前只有 owner；老師帳密請用 feedback:client-account）} {--password= : 指定密碼；省略則產生隨機密碼}')]
#[Description('重設登入帳號密碼，雜湊寫入 .env，明文只顯示這一次')]
class ResetFeedbackAccountPasswordCommand extends Command
{
    public function handle(): int
    {
        $account = (string) $this->argument('account');

        if (! in_array($account, [FeedbackAccess::ROLE_OWNER], true)) {
            $this->components->error('角色只能是 owner；老師帳密請用 feedback:client-account。');

            return self::FAILURE;
        }

        $envPath = $this->laravel->environmentFilePath();
        if (! is_file($envPath) || ! is_writable($envPath)) {
            $this->components->error("無法寫入 {$envPath}。");

            return self::FAILURE;
        }

        $password = $this->option('password');
        if ($password === '') {
            $this->components->error('--password 不可為空白。');

            return self::FAILURE;
        }
        $password ??= Str::password(24, symbols: false);
        $key = 'FEEDBACK_'.strtoupper($account).'_PASSWORD_HASH';
        $this->writeEnvironmentValue($envPath, $key, Hash::make($password));

        $this->components->info("已重設 {$account} 的密碼");
        $this->line('帳號：'.config("feedback.accounts.{$account}.username"));
        $this->line("密碼：{$password}");
        $this->components->warn('明文只會顯示這一次；以此帳號登入的長效登入已全部失效。');

        if ($this->laravel->configurationIsCached()) {
            $this->components->warn('設定已快取，請執行 php artisan config:cache 讓新密碼生效。');
        }

        return self::SUCCESS;
    }

    private function writeEnvironmentValue(string $envPath, string $key, string $value): void
    {
        $line = "{$key}='{$value}'";
        $contents = (string) file_get_contents($envPath);
        $pattern = '/^'.preg_quote($key, '/').'=.*$/m';

        $contents = preg_match($pattern, $contents)
            ? preg_replace_callback($pattern, fn (): string => $line, $contents)
            : rtrim($contents, "\n")."\n{$line}\n";

        file_put_contents($envPath, $contents, LOCK_EX);
    }
}
