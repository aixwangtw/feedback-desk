<?php

namespace App\Models;

use Database\Factories\FeedbackProjectFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'slug', 'owner_token_hash', 'client_token_hash', 'repository_path', 'automation_enabled'])]
class FeedbackProject extends Model
{
    /** @use HasFactory<FeedbackProjectFactory> */
    use HasFactory;

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

    protected function casts(): array
    {
        return [
            'automation_enabled' => 'boolean',
        ];
    }
}
