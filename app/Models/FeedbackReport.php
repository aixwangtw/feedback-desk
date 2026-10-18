<?php

namespace App\Models;

use App\Enums\FeedbackAttachmentKind;
use App\Enums\FeedbackCreatorType;
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
    'creator_type',
    'creator_developer_id',
    'title',
    'description',
    'adjustment_note',
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
        'creator_type' => 'client',
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

    /** @return BelongsTo<FeedbackDeveloper, $this> */
    public function creatorDeveloper(): BelongsTo
    {
        return $this->belongsTo(FeedbackDeveloper::class, 'creator_developer_id');
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

    /**
     * 開發者在「調整說明」附上的圖片。
     *
     * @return HasMany<FeedbackAttachment, $this>
     */
    public function adjustmentAttachments(): HasMany
    {
        return $this->feedbackAttachments()->ofKind(FeedbackAttachmentKind::Adjustment);
    }

    public function hasAdjustment(): bool
    {
        return filled($this->adjustment_note) || $this->adjustmentAttachments->isNotEmpty();
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
     * 只留下老師建立的單；開發者建立的單老師完全看不到。
     *
     * @param  Builder<FeedbackReport>  $query
     */
    #[Scope]
    protected function createdByClient(Builder $query): void
    {
        $query->where('creator_type', FeedbackCreatorType::Client->value);
    }

    /**
     * 開發者端的「建立者」篩選；值為 client、shared 或 developer:{id}。
     *
     * @param  Builder<FeedbackReport>  $query
     */
    #[Scope]
    protected function createdBy(Builder $query, string $creator): void
    {
        match (true) {
            $creator === 'client' => $query->where('creator_type', FeedbackCreatorType::Client->value),
            $creator === 'shared' => $query->where('creator_type', FeedbackCreatorType::OwnerShared->value),
            (bool) preg_match('/^developer:(\d+)$/', $creator, $matches) => $query
                ->where('creator_type', FeedbackCreatorType::Developer->value)
                ->where('creator_developer_id', (int) $matches[1]),
            default => null,
        };
    }

    public function isCreatedByClient(): bool
    {
        return $this->creator_type === FeedbackCreatorType::Client;
    }

    /**
     * 開發者端顯示的建立者名稱。
     */
    public function creatorLabel(): string
    {
        return match ($this->creator_type) {
            FeedbackCreatorType::Client => $this->feedbackProject->clientLabel(),
            FeedbackCreatorType::Developer => $this->creatorDeveloper?->name ?? config('feedback.labels.owner'),
            FeedbackCreatorType::OwnerShared => config('feedback.labels.owner'),
        };
    }

    /**
     * 該專案內依建立時間先後的固定編號（最新為 1）。
     * 老師端只算老師建立的單，所以不會跳號。
     */
    public function sequenceNumber(bool $clientCreatedOnly = false): int
    {
        return static::query()
            ->where('feedback_project_id', $this->feedback_project_id)
            ->when($clientCreatedOnly, fn (Builder $query) => $query->createdByClient())
            ->where(fn ($query) => $query
                ->where('created_at', '>', $this->created_at)
                ->orWhere(fn ($tie) => $tie->where('created_at', $this->created_at)->where('id', '>=', $this->id)))
            ->count();
    }

    /**
     * @return array<int, int> report id => 專案內編號
     */
    public static function sequenceNumbersForProject(FeedbackProject $project, bool $clientCreatedOnly = false): array
    {
        return array_flip(static::query()
            ->where('feedback_project_id', $project->id)
            ->when($clientCreatedOnly, fn (Builder $query) => $query->createdByClient())
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->pluck('id')
            ->map(fn ($id): int => (int) $id)
            ->all());
    }

    /**
     * @return array<string, int> 狀態值 => 整個專案該狀態的題數
     */
    public static function statusCountsForProject(FeedbackProject $project, bool $includeClientDeleted = true, bool $clientCreatedOnly = false): array
    {
        return static::query()
            ->where('feedback_project_id', $project->id)
            ->when($clientCreatedOnly, fn (Builder $query) => $query->createdByClient())
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
            'creator_type' => FeedbackCreatorType::class,
            'completed_at' => 'datetime',
            'client_deleted_at' => 'datetime',
            'latest_activity_at' => 'datetime',
        ];
    }
}
