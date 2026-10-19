<?php

namespace App\Console\Commands;

use App\Models\FeedbackDeveloper;
use App\Support\FeedbackAccess;
use App\Support\FeedbackClientAccountManager;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

#[Signature('feedback:developer {username : 登入帳號} {--name= : 顯示名稱；新帳號省略則用帳號} {--password= : 指定密碼；省略則產生隨機密碼}')]
#[Description('建立開發團隊帳號，或重設既有開發團隊帳號系統產生的密碼（明文只顯示這一次；本人自設的密碼不能重設）')]
class CreateFeedbackDeveloperCommand extends Command
{
    public function handle(): int
    {
        $username = trim((string) $this->argument('username'));

        if ($username === '' || mb_strlen($username) > 50) {
            $this->components->error('帳號不可為空白，且不可超過 50 字。');

            return self::FAILURE;
        }

        $reserved = [
            config('feedback.accounts.'.FeedbackAccess::ROLE_OWNER.'.username'),
            config('feedback.accounts.'.FeedbackAccess::ROLE_CLIENT.'.username'),
        ];
        if (in_array($username, $reserved, true)) {
            $this->components->error('這個帳號名稱已被共用帳號使用，請換一個。');

            return self::FAILURE;
        }

        $name = $this->option('name');
        $password = $this->option('password');
        if ($name === '' || $password === '') {
            $this->components->error('--name 與 --password 不可為空白。');

            return self::FAILURE;
        }

        $generated = $password === null;
        $password ??= Str::password(24, symbols: false);

        $developer = FeedbackDeveloper::where('username', $username)->first();
        $created = $developer === null;

        if ($developer !== null && $developer->password_set_by_self) {
            $this->components->error(FeedbackClientAccountManager::SELF_SET_PASSWORD_LOCKED);

            return self::FAILURE;
        }

        if ($created && app(FeedbackClientAccountManager::class)->usernameTaken($username)) {
            $this->components->error('這個帳號名稱已經有人用了（團隊帳號與所有專案的客戶帳號共用，不分大小寫），請換一個。');

            return self::FAILURE;
        }

        $developer ??= new FeedbackDeveloper(['username' => $username, 'name' => $username]);
        if ($name !== null) {
            $developer->name = $name;
        }
        $developer->password_hash = Hash::make($password);
        $developer->save();
        $revokedTokens = $created ? 0 : $developer->apiTokens()->delete();

        $this->components->info(($created ? '已建立' : '已更新').'開發團隊帳號');
        $this->line("顯示名稱：{$developer->name}");
        $this->line("帳號：{$developer->username}");

        if ($generated) {
            $this->line("密碼：{$password}");
            $this->components->warn('明文只會顯示這一次；此帳號先前的長效登入已全部失效。');
        } else {
            $this->components->warn('密碼已依 --password 設定；此帳號先前的長效登入已全部失效。');
        }
        if ($revokedTokens > 0) {
            $this->components->warn("此帳號的 {$revokedTokens} 個 AI 工具（MCP）token 已撤銷。");
        }

        return self::SUCCESS;
    }
}
