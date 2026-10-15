<?php

namespace App\Models;

use App\Enums\FeedbackReportStatus;
use Database\Factories\FeedbackReportFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable([
    'feedback_project_id',
    'public_id',
    'reporter_token_hash',
    'reporter_name',
    'title',
    'description',
    'page_url',
    'status',
    'completed_at',
    'client_deleted_at',
    'latest_activity_at',
])]
class FeedbackReport extends Model
{
    /** @use HasFactory<FeedbackReportFactory> */
    use HasFactory;

    protected $attributes = [
        'status' => FeedbackReportStatus::New->value,
    ];

    public function getRouteKeyName(): string
    {
        return 'public_id';
    }

    /** @return BelongsTo<FeedbackProject, $this> */
    public function feedbackProject(): BelongsTo
    {
        return $this->belongsTo(FeedbackProject::class);
    }

    /** @return HasMany<FeedbackMessage, $this> */
    public function feedbackMessages(): HasMany
    {
        return $this->hasMany(FeedbackMessage::class);
    }

    /** @return HasMany<FeedbackAttachment, $this> */
    public function feedbackAttachments(): HasMany
    {
        return $this->hasMany(FeedbackAttachment::class);
    }

    /** @return HasMany<FeedbackAutomationRun, $this> */
    public function automationRuns(): HasMany
    {
        return $this->hasMany(FeedbackAutomationRun::class);
    }

    /**
     * 老師刪除的問題只是隱藏，開發者仍看得到並可還原。
     */
    public function isDeletedByClient(): bool
    {
        return $this->client_deleted_at !== null;
    }

    /**
     * @param  Builder<FeedbackReport>  $query
     */
    #[Scope]
    protected function visibleToClient(Builder $query): void
    {
        $query->whereNull('client_deleted_at');
    }

    /**
     * 該專案內依建立時間先後的固定編號（最新為 1）。
     */
    public function sequenceNumber(): int
    {
        return static::query()
            ->where('feedback_project_id', $this->feedback_project_id)
            ->where(fn ($query) => $query
                ->where('created_at', '>', $this->created_at)
                ->orWhere(fn ($tie) => $tie->where('created_at', $this->created_at)->where('id', '>=', $this->id)))
            ->count();
    }

    /**
     * @return array<int, int> report id => 專案內編號
     */
    public static function sequenceNumbersForProject(FeedbackProject $project): array
    {
        return array_flip(static::query()
            ->where('feedback_project_id', $project->id)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->pluck('id')
            ->map(fn ($id): int => (int) $id)
            ->all());
    }

    /**
     * @return array<string, int> 狀態值 => 整個專案該狀態的題數
     */
    public static function statusCountsForProject(FeedbackProject $project, bool $includeClientDeleted = true): array
    {
        return static::query()
            ->where('feedback_project_id', $project->id)
            ->when(! $includeClientDeleted, fn (Builder $query) => $query->whereNull('client_deleted_at'))
            ->selectRaw('status, count(*) as aggregate')
            ->groupBy('status')
            ->pluck('aggregate', 'status')
            ->map(fn ($count): int => (int) $count)
            ->all();
    }

    protected function casts(): array
    {
        return [
            'status' => FeedbackReportStatus::class,
            'completed_at' => 'datetime',
            'client_deleted_at' => 'datetime',
            'latest_activity_at' => 'datetime',
        ];
    }
}
