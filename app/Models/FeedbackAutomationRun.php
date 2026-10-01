<?php

namespace App\Models;

use App\Enums\FeedbackAutomationStatus;
use Database\Factories\FeedbackAutomationRunFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'feedback_report_id',
    'status',
    'started_at',
    'finished_at',
    'exit_code',
    'summary',
    'result',
    'trace_path',
])]
class FeedbackAutomationRun extends Model
{
    /** @use HasFactory<FeedbackAutomationRunFactory> */
    use HasFactory;

    protected $attributes = [
        'status' => FeedbackAutomationStatus::Queued->value,
    ];

    /** @return BelongsTo<FeedbackReport, $this> */
    public function feedbackReport(): BelongsTo
    {
        return $this->belongsTo(FeedbackReport::class);
    }

    protected function casts(): array
    {
        return [
            'status' => FeedbackAutomationStatus::class,
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'result' => 'array',
        ];
    }
}
