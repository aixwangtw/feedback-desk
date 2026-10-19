<?php

namespace App\Console\Commands\Concerns;

use App\Models\FeedbackDeveloper;
use App\Support\FeedbackActor;
use App\Support\FeedbackAgentName;

/**
 * artisan 指令以誰的身分做事：--as（或環境變數 FEEDBACK_DESK_AS）指定團隊個人帳號，
 * 沒指定時是共用的團隊身分；--agent（或 FEEDBACK_DESK_AGENT，在 Claude Code、Codex 裡自動判斷）標示 AI 工具。
 */
trait ResolvesFeedbackActor
{
    /**
     * 找不到 --as 指定的帳號時回 null（並印出錯誤）。
     */
    protected function resolveActor(): ?FeedbackActor
    {
        $agent = FeedbackAgentName::fromEnvironment($this->option('agent'));
        $username = $this->option('as');
        if ($username === null || $username === '') {
            $environment = getenv('FEEDBACK_DESK_AS');
            $username = is_string($environment) && $environment !== '' ? $environment : null;
        }

        if ($username === null) {
            return FeedbackActor::sharedOwner($agent);
        }

        $developer = FeedbackDeveloper::where('username', $username)->first();
        if ($developer === null) {
            $this->components->error("找不到團隊個人帳號「{$username}」（--as 只接受用 feedback:developer 建立的帳號）。");

            return null;
        }

        return FeedbackActor::developer($developer, $agent);
    }
}
