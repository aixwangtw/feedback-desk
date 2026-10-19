<?php

namespace App\Models;

use App\Support\FeedbackAgentName;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * 給 MCP 用的 API token，屬於一個團隊個人帳號或一個客戶帳號。只存 SHA-256 雜湊。
 */
#[Fillable(['feedback_developer_id', 'feedback_client_account_id', 'name', 'agent', 'mcp_client', 'token_hash', 'last_used_at', 'expires_at'])]
#[Hidden(['token_hash'])]
class FeedbackApiToken extends Model
{
    public const PREFIX = 'fdk_';

    /** @return BelongsTo<FeedbackDeveloper, $this> */
    public function feedbackDeveloper(): BelongsTo
    {
        return $this->belongsTo(FeedbackDeveloper::class);
    }

    /** @return BelongsTo<FeedbackClientAccount, $this> */
    public function feedbackClientAccount(): BelongsTo
    {
        return $this->belongsTo(FeedbackClientAccount::class);
    }

    /**
     * 建立 token，回傳明文（只在這一次拿得到）。
     *
     * @return array{token: FeedbackApiToken, plain: string}
     */
    public static function issue(FeedbackDeveloper|FeedbackClientAccount $account, string $name, ?string $agent): array
    {
        $plain = self::PREFIX.Str::random(48);
        $token = static::create([
            'feedback_developer_id' => $account instanceof FeedbackDeveloper ? $account->id : null,
            'feedback_client_account_id' => $account instanceof FeedbackClientAccount ? $account->id : null,
            'name' => mb_substr($name, 0, 100),
            'agent' => FeedbackAgentName::normalize($agent),
            'token_hash' => hash('sha256', $plain),
        ]);

        return ['token' => $token, 'plain' => $plain];
    }

    public static function findByPlain(string $plain): ?self
    {
        if ($plain === '' || strlen($plain) > 200) {
            return null;
        }

        return static::query()->where('token_hash', hash('sha256', $plain))->first();
    }

    /**
     * 畫面上標示的 AI 工具：建立時指定的名稱優先，其次是 MCP 用戶端自報的名稱。
     */
    public function agentName(): ?string
    {
        return $this->agent ?? FeedbackAgentName::normalize($this->mcp_client);
    }

    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    protected function casts(): array
    {
        return [
            'last_used_at' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }
}
