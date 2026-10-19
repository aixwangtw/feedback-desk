<?php

namespace App\Console\Commands;

use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Support\FeedbackClientAccountManager;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('feedback:account-recover {username : 團隊個人帳號或客戶帳號} {--project= : 客戶帳號名稱在多個專案重複時，指定專案 slug}')]
#[Description('忘記密碼：由能進主機的管理者救回任何帳號（含本人自設的密碼），產生新的隨機密碼')]
#[Help(<<<'HELP'
本人自己設定的密碼，其他成員不能用 feedback:developer、feedback:client-account 重設。
本人忘記時，由能登入這台主機的管理者執行這個指令：產生新的隨機密碼（只顯示一次），
帳號回到「系統產生」狀態，所有網頁登入與 AI 工具 token 失效。

  php artisan feedback:account-recover alex
  php artisan feedback:account-recover mei --project=website
HELP)]
class RecoverFeedbackAccountCommand extends Command
{
    public function handle(FeedbackClientAccountManager $accounts): int
    {
        $username = (string) $this->argument('username');
        $slug = $this->option('project');

        $account = $slug === null ? FeedbackDeveloper::where('username', $username)->first() : null;
        if ($account === null) {
            $clients = FeedbackClientAccount::query()
                ->where('username', $username)
                ->when($slug !== null, fn ($query) => $query->whereHas('feedbackProject', fn ($query) => $query->where('slug', $slug)))
                ->get();
            if ($clients->count() > 1) {
                $this->components->error('這個客戶帳號名稱在多個專案都有，請加 --project=專案 slug。');

                return self::FAILURE;
            }
            $account = $clients->first();
        }

        if ($account === null) {
            $this->components->error('找不到這個帳號。');

            return self::FAILURE;
        }

        $password = $accounts->recover($account);
        $this->components->info('已救回帳號'.($account instanceof FeedbackClientAccount ? "（{$account->feedbackProject->name} 的客戶帳號）" : '（團隊個人帳號）'));
        $this->line("帳號：{$account->username}");
        $this->line("密碼：{$password}");
        $this->components->warn('明文只會顯示這一次；這個帳號的網頁登入與 AI 工具 token 已全部失效。');

        return self::SUCCESS;
    }
}
