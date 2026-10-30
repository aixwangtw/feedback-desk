<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * 排程專用 API token：代表一個團隊個人帳號，只能讀單、留言、寫調整重點、改成待審核。只存 SHA-256 雜湊。
 */
#[Fillable(['feedback_developer_id', 'name', 'token_hash', 'last_used_at', 'revoked_at'])]
#[Hidden(['token_hash'])]
class FeedbackPatrolToken extends Model
{
    public const PREFIX = 'fdp_';

    /** @return BelongsTo<FeedbackDeveloper, $this> */
    public function feedbackDeveloper(): BelongsTo
    {
        return $this->belongsTo(FeedbackDeveloper::class);
    }

    /** @return HasMany<FeedbackPatrolLog, $this> */
    public function logs(): HasMany
    {
        return $this->hasMany(FeedbackPatrolLog::class);
    }

    /**
     * 建立 token，回傳明文（只在這一次拿得到）。
     *
     * @return array{token: FeedbackPatrolToken, plain: string}
     */
    public static function issue(FeedbackDeveloper $developer, string $name): array
    {
        $plain = self::PREFIX.Str::random(48);
        $token = static::create([
            'feedback_developer_id' => $developer->id,
            'name' => mb_substr($name, 0, 100),
            'token_hash' => hash('sha256', $plain),
        ]);

        return ['token' => $token, 'plain' => $plain];
    }

    /**
     * 有效的 token：雜湊相符、沒有撤銷、帳號還在。
     */
    public static function findActiveByPlain(string $plain): ?self
    {
        if (! str_starts_with($plain, self::PREFIX) || strlen($plain) > 200) {
            return null;
        }

        $token = static::query()->where('token_hash', hash('sha256', $plain))->whereNull('revoked_at')->first();

        return $token?->feedbackDeveloper !== null ? $token : null;
    }

    public function isRevoked(): bool
    {
        return $this->revoked_at !== null;
    }

    protected function casts(): array
    {
        return [
            'last_used_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }
}
