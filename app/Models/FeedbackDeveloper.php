<?php

namespace App\Models;

use Database\Factories\FeedbackDeveloperFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'username', 'password_hash'])]
#[Hidden(['password_hash'])]
class FeedbackDeveloper extends Model
{
    /** @use HasFactory<FeedbackDeveloperFactory> */
    use HasFactory;

    /** @return HasMany<FeedbackReport, $this> */
    public function feedbackReports(): HasMany
    {
        return $this->hasMany(FeedbackReport::class, 'creator_developer_id');
    }
}
