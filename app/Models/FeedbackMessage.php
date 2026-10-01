<?php

namespace App\Models;

use App\Enums\FeedbackAuthorType;
use Database\Factories\FeedbackMessageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['feedback_report_id', 'author_type', 'author_name', 'body'])]
class FeedbackMessage extends Model
{
    /** @use HasFactory<FeedbackMessageFactory> */
    use HasFactory;

    /** @return BelongsTo<FeedbackReport, $this> */
    public function feedbackReport(): BelongsTo
    {
        return $this->belongsTo(FeedbackReport::class);
    }

    /** @return HasMany<FeedbackAttachment, $this> */
    public function feedbackAttachments(): HasMany
    {
        return $this->hasMany(FeedbackAttachment::class);
    }

    protected function casts(): array
    {
        return [
            'author_type' => FeedbackAuthorType::class,
        ];
    }
}
