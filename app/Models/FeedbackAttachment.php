<?php

namespace App\Models;

use App\Enums\FeedbackAttachmentKind;
use Database\Factories\FeedbackAttachmentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'feedback_report_id',
    'feedback_message_id',
    'kind',
    'disk',
    'path',
    'original_name',
    'mime_type',
    'size',
])]
class FeedbackAttachment extends Model
{
    /** @use HasFactory<FeedbackAttachmentFactory> */
    use HasFactory;

    protected $attributes = [
        'kind' => FeedbackAttachmentKind::Feedback->value,
    ];

    /** @return BelongsTo<FeedbackReport, $this> */
    public function feedbackReport(): BelongsTo
    {
        return $this->belongsTo(FeedbackReport::class);
    }

    /** @return BelongsTo<FeedbackMessage, $this> */
    public function feedbackMessage(): BelongsTo
    {
        return $this->belongsTo(FeedbackMessage::class);
    }

    /**
     * @param  Builder<FeedbackAttachment>  $query
     */
    #[Scope]
    protected function ofKind(Builder $query, FeedbackAttachmentKind $kind): void
    {
        $query->where('kind', $kind->value);
    }

    protected function casts(): array
    {
        return [
            'kind' => FeedbackAttachmentKind::class,
        ];
    }
}
