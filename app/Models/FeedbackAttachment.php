<?php

namespace App\Models;

use Database\Factories\FeedbackAttachmentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'feedback_report_id',
    'feedback_message_id',
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
}
