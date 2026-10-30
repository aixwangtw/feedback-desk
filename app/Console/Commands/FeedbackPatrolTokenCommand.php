<?php

namespace App\Console\Commands;

use App\Models\FeedbackDeveloper;
use App\Models\FeedbackPatrolToken;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('feedback:patrol-token
    {action : issue（建立）、list（列出）或 revoke（撤銷）}
    {--developer= : issue 用：token 代表的團隊個人帳號（帳號名稱）}
    {--name= : issue 用：用途說明，例如「Claude 雲端排程」}
    {--id= : revoke 用：token 編號（list 看得到）}')]
#[Description('管理排程專用 API token（建立、列出、撤銷）')]
#[Help(<<<'HELP'
排程 API（/api/patrol/...）只能列專案、讀待處理單、留言、寫調整重點、改成待審核，
不能改成已完成、不能刪除。token 只存雜湊，明文只在建立時顯示一次。

  php artisan feedback:patrol-token issue --developer=alex --name="Claude 雲端排程"
  php artisan feedback:patrol-token list
  php artisan feedback:patrol-token revoke --id=1
HELP)]
class FeedbackPatrolTokenCommand extends Command
{
    public function handle(): int
    {
        return match ((string) $this->argument('action')) {
            'issue' => $this->issue(),
            'list' => $this->listTokens(),
            'revoke' => $this->revoke(),
            default => $this->fail('不認得的動作，可用 issue、list、revoke。'),
        };
    }

    private function issue(): int
    {
        $developer = FeedbackDeveloper::query()->where('username', (string) $this->option('developer'))->first();
        if ($developer === null) {
            $this->components->error('找不到這個團隊個人帳號（--developer）。');

            return self::FAILURE;
        }

        $name = trim((string) $this->option('name'));
        $issued = FeedbackPatrolToken::issue($developer, $name !== '' ? $name : '排程');
        $this->components->info("已建立排程 token #{$issued['token']->id}（{$developer->username}）。明文只顯示這一次：");
        $this->line($issued['plain']);

        return self::SUCCESS;
    }

    private function listTokens(): int
    {
        $this->table(['編號', '帳號', '用途', '最後使用', '撤銷時間'], FeedbackPatrolToken::query()->with('feedbackDeveloper')->orderBy('id')->get()
            ->map(fn (FeedbackPatrolToken $token): array => [
                $token->id,
                (string) $token->feedbackDeveloper?->username,
                $token->name,
                (string) $token->last_used_at?->toIso8601String(),
                (string) $token->revoked_at?->toIso8601String(),
            ])->all());

        return self::SUCCESS;
    }

    private function revoke(): int
    {
        $token = FeedbackPatrolToken::query()->find((int) $this->option('id'));
        if ($token === null) {
            $this->components->error('找不到這個 token（--id）。');

            return self::FAILURE;
        }

        if (! $token->isRevoked()) {
            $token->forceFill(['revoked_at' => now()])->save();
        }
        $this->components->info("已撤銷排程 token #{$token->id}。");

        return self::SUCCESS;
    }
}
