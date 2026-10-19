<?php

namespace App\Models;

use Database\Factories\FeedbackDeveloperFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'username', 'password_hash', 'password_set_by_self'])]
#[Hidden(['password_hash'])]
class FeedbackDeveloper extends Model
{
    /** @use HasFactory<FeedbackDeveloperFactory> */
    use HasFactory;

    protected $attributes = [
        'password_set_by_self' => false,
    ];

    /** @return HasMany<FeedbackReport, $this> */
    public function feedbackReports(): HasMany
    {
        return $this->hasMany(FeedbackReport::class, 'creator_developer_id');
    }

    /** @return HasMany<FeedbackApiToken, $this> */
    public function apiTokens(): HasMany
    {
        return $this->hasMany(FeedbackApiToken::class);
    }

    protected function casts(): array
    {
        return [
            'password_set_by_self' => 'boolean',
        ];
    }
}
