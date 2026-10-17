<?php

namespace App\Models;

use Database\Factories\FeedbackProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'slug', 'client_display_name', 'owner_token_hash', 'client_token_hash', 'client_username', 'client_password_hash', 'login_prefill_username', 'login_prefill_password', 'repository_path', 'automation_enabled'])]
class FeedbackProject extends Model
{
    /** @use HasFactory<FeedbackProjectFactory> */
    use HasFactory;

    protected $hidden = ['client_password_hash', 'login_prefill_password'];

    protected $attributes = [
        'automation_enabled' => false,
    ];

    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    /** @return HasMany<FeedbackReport, $this> */
    public function feedbackReports(): HasMany
    {
        return $this->hasMany(FeedbackReport::class);
    }

    /**
     * 開發者端顯示老師的名稱；未設定時用「老師」。
     */
    public function clientLabel(): string
    {
        return filled($this->client_display_name) ? $this->client_display_name : '老師';
    }

    protected function casts(): array
    {
        return [
            'automation_enabled' => 'boolean',
        ];
    }
}
