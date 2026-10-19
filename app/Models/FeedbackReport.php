<?php

namespace App\Models;

use App\Enums\FeedbackAttachmentKind;
use App\Enums\FeedbackAuthorType;
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
    'owner_last_read_at',
    'client_last_read_at',
    'adjustment_updated_at',
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
     * 開發者端的「建立者」篩選；值為 client、public、shared 或 developer:{id}。
     *
     * @param  Builder<FeedbackReport>  $query
     */
    #[Scope]
    protected function createdBy(Builder $query, string $creator): void
    {
        match (true) {
            $creator === 'client' => $query->where('creator_type', FeedbackCreatorType::Client->value),
            $creator === 'public' => $query->where('creator_type', FeedbackCreatorType::Public->value),
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

    public function isPublicReport(): bool
    {
        return $this->creator_type === FeedbackCreatorType::Public;
    }

    /**
     * 開發者端顯示的建立者名稱。
     */
    public function creatorLabel(): string
    {
        return match ($this->creator_type) {
            FeedbackCreatorType::Client => $this->feedbackProject->clientLabel(),
            FeedbackCreatorType::Developer => $this->creatorDeveloper?->name ?? config('feedback.labels.owner'),
            FeedbackCreatorType::Public => filled($this->reporter_name) ? "公開回報（{$this->reporter_name}）" : '公開回報',
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
     * 用 public_id 或團隊端清單編號（數字）找專案內的單；編號含客戶隱藏刪除的單，與團隊端網頁一致。
     */
    public static function findInProject(FeedbackProject $project, string $identifier): ?self
    {
        $identifier = trim($identifier);

        if (ctype_digit($identifier)) {
            $id = array_search((int) $identifier - 1, static::sequenceNumbersForProject($project), true);

            return $id === false ? null : $project->feedbackReports()->find($id);
        }

        return $project->feedbackReports()->where('public_id', $identifier)->first();
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

    /**
     * 客戶留言中，開發者上次開啟這張單之後才出現的；開發者與 AI 的留言不算。
     * 只能用在以 feedback_reports 為外層的子查詢（withCount、whereHas）。
     *
     * @param  Builder<FeedbackMessage>  $query
     */
    public static function constrainToUnreadByOwner(Builder $query): void
    {
        $query->where('feedback_messages.author_type', FeedbackAuthorType::Reporter->value)
            ->where(fn (Builder $query) => $query
                ->whereNull('feedback_reports.owner_last_read_at')
                ->orWhereColumn('feedback_messages.created_at', '>', 'feedback_reports.owner_last_read_at'));
    }

    /**
     * 開發者端清單要用的留言統計：總留言數、未讀客戶留言數、最新留言時間。
     *
     * @param  Builder<FeedbackReport>  $query
     */
    #[Scope]
    protected function withOwnerMessageStats(Builder $query): void
    {
        $query->withCount([
            'feedbackMessages',
            'feedbackMessages as unread_messages_count' => fn (Builder $query) => static::constrainToUnreadByOwner($query),
        ])->withMax('feedbackMessages as latest_message_at', 'created_at');
    }

    /**
     * 有開發者還沒看過的客戶留言的單。
     *
     * @param  Builder<FeedbackReport>  $query
     */
    #[Scope]
    protected function unreadByOwner(Builder $query): void
    {
        $query->whereHas('feedbackMessages', fn (Builder $query) => static::constrainToUnreadByOwner($query));
    }

    /**
     * 客戶端清單要用的：客戶上次開啟之後，開發者（含 AI）新增的留言數。
     *
     * @param  Builder<FeedbackReport>  $query
     */
    #[Scope]
    protected function withClientNewReplyCount(Builder $query): void
    {
        $query->withCount(['feedbackMessages as client_new_replies_count' => fn (Builder $query) => $query
            ->whereIn('feedback_messages.author_type', [FeedbackAuthorType::Owner->value, FeedbackAuthorType::Agent->value])
            ->where(fn (Builder $query) => $query
                ->whereNull('feedback_reports.client_last_read_at')
                ->orWhereColumn('feedback_messages.created_at', '>', 'feedback_reports.client_last_read_at'))]);
    }

    /**
     * 客戶端的「有新回覆」：開發者在客戶上次開啟後留言，或更新了調整說明。
     * 需先用 withClientNewReplyCount 載入留言數。
     */
    public function hasNewReplyForClient(): bool
    {
        return $this->adjustmentIsNewForClient() || (int) ($this->client_new_replies_count ?? 0) > 0;
    }

    /**
     * 開發者在客戶上次開啟這張單之後更新了調整說明。
     */
    public function adjustmentIsNewForClient(): bool
    {
        return $this->adjustment_updated_at !== null
            && ($this->client_last_read_at === null || $this->adjustment_updated_at->greaterThan($this->client_last_read_at));
    }

    /**
     * 清單、看板與對話面板共用的未讀數：開發者看客戶的新留言；客戶看開發者（含 AI）的新留言，調整說明有更新再加 1。
     * 需先用 withOwnerMessageStats 或 withClientNewReplyCount 載入留言數。
     */
    public function unreadCountFor(bool $forOwner): int
    {
        if ($forOwner) {
            return (int) ($this->unread_messages_count ?? 0);
        }

        return (int) ($this->client_new_replies_count ?? 0) + ($this->adjustmentIsNewForClient() ? 1 : 0);
    }

    public function markReadByOwner(): void
    {
        $this->markReadAt('owner_last_read_at');
    }

    public function markReadByClient(): void
    {
        $this->markReadAt('client_last_read_at');
    }

    /**
     * 只寫已讀時間，不動 updated_at 與最後更新時間。
     */
    private function markReadAt(string $column): void
    {
        $now = now();
        static::query()->whereKey($this->getKey())->toBase()->update([$column => $now]);
        $this->setAttribute($column, $now);
        $this->syncOriginalAttribute($column);
    }

    protected function casts(): array
    {
        return [
            'status' => FeedbackReportStatus::class,
            'creator_type' => FeedbackCreatorType::class,
            'completed_at' => 'datetime',
            'client_deleted_at' => 'datetime',
            'latest_activity_at' => 'datetime',
            'owner_last_read_at' => 'datetime',
            'client_last_read_at' => 'datetime',
            'adjustment_updated_at' => 'datetime',
            'latest_message_at' => 'datetime',
        ];
    }
}
