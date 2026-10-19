<?php

namespace App\Models;

use Database\Factories\FeedbackClientAccountFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * 專案的客戶帳號，每位客戶一個。帳號（username）不能改，顯示名稱與密碼本人可改。
 */
#[Fillable(['feedback_project_id', 'username', 'name', 'password_hash', 'password_set_by_self', 'disabled_at'])]
#[Hidden(['password_hash'])]
class FeedbackClientAccount extends Model
{
    /** @use HasFactory<FeedbackClientAccountFactory> */
    use HasFactory;

    protected $attributes = [
        'password_set_by_self' => false,
    ];

    /** @return BelongsTo<FeedbackProject, $this> */
    public function feedbackProject(): BelongsTo
    {
        return $this->belongsTo(FeedbackProject::class);
    }

    /** @return HasMany<FeedbackApiToken, $this> */
    public function apiTokens(): HasMany
    {
        return $this->hasMany(FeedbackApiToken::class);
    }

    public function isDisabled(): bool
    {
        return $this->disabled_at !== null;
    }

    protected function casts(): array
    {
        return [
            'password_set_by_self' => 'boolean',
            'disabled_at' => 'datetime',
        ];
    }
}
