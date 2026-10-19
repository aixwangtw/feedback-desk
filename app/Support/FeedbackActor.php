<?php

namespace App\Support;

use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;

/**
 * 誰在寫：團隊個人帳號、客戶帳號，或沒有帳號的共用身分（共用 owner 帳號、專屬連結）。
 * 用在單、留言、附件的帳號欄位與最近動態；agent 是透過 MCP 或 artisan 指令做事的 AI 工具。
 */
final readonly class FeedbackActor
{
    public function __construct(
        public string $name,
        public bool $isTeam,
        public ?FeedbackDeveloper $developer = null,
        public ?FeedbackClientAccount $clientAccount = null,
        public ?string $agent = null,
    ) {}

    public static function developer(FeedbackDeveloper $developer, ?string $agent = null): self
    {
        return new self($developer->name, true, developer: $developer, agent: $agent);
    }

    public static function client(FeedbackClientAccount $account, ?string $agent = null): self
    {
        return new self($account->name, false, clientAccount: $account, agent: $agent);
    }

    public static function sharedOwner(?string $agent = null): self
    {
        return new self((string) config('feedback.labels.owner'), true, agent: $agent);
    }

    public static function sharedClient(): self
    {
        return new self((string) config('feedback.labels.client'), false);
    }

    public function label(): string
    {
        return FeedbackAgentName::label($this->name, $this->agent);
    }
}
