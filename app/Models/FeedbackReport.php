<?php

namespace App\Models;

use App\Enums\FeedbackAttachmentKind;
use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackCreatorType;
use App\Enums\FeedbackReportStatus;
use App\Support\FeedbackActor;
use App\Support\FeedbackAgentName;
use Carbon\CarbonInterface;
use Database\Factories\FeedbackReportFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Scope;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

#[Fillable([
    'feedback_project_id',
    'public_id',
    'reporter_token_hash',
    'reporter_name',
    'category',
    'creator_type',
    'creator_developer_id',
    'creator_client_account_id',
    'creator_agent',
    'claimed_by_developer_id',
    'claimed_agent',
    'claimed_at',
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

    /** @return BelongsTo<FeedbackClientAccount, $this> */
    public function creatorClientAccount(): BelongsTo
    {
        return $this->belongsTo(FeedbackClientAccount::class, 'creator_client_account_id');
    }

    /** @return BelongsTo<FeedbackDeveloper, $this> */
    public function claimedBy(): BelongsTo
    {
        return $this->belongsTo(FeedbackDeveloper::class, 'claimed_by_developer_id');
    }

    /** @return HasMany<FeedbackHandoffNote, $this> */
    public function handoffNotes(): HasMany
    {
        return $this->hasMany(FeedbackHandoffNote::class);
    }

    /** @return HasMany<FeedbackReportEvent, $this> */
    public function events(): HasMany
    {
        return $this->hasMany(FeedbackReportEvent::class);
    }

    /**
     * 記一筆最近動態（誰、用哪個 AI、做了什麼）。
     */
    public function recordEvent(string $kind, FeedbackActor $actor, ?string $detail = null): FeedbackReportEvent
    {
        return $this->events()->create([
            'kind' => $kind,
            'feedback_developer_id' => $actor->developer?->id,
            'feedback_client_account_id' => $actor->clientAccount?->id,
            'actor_name' => mb_substr($actor->name, 0, 100),
            'agent' => $actor->agent,
            'detail' => $detail !== null ? mb_substr($detail, 0, 200) : null,
        ]);
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
            (bool) preg_match('/^client:(\d+)$/', $creator, $matches) => $query
                ->where('creator_type', FeedbackCreatorType::Client->value)
                ->where('creator_client_account_id', (int) $matches[1]),
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
     * 清單、單頁與對話面板顯示的建立者：帳號目前的名字，用 AI 開的單加上工具名稱，例如「王小明（Codex）」。
     */
    public function creatorLabel(): string
    {
        return FeedbackAgentName::label($this->creatorName(), $this->creator_type === FeedbackCreatorType::Public ? null : $this->creator_agent);
    }

    private function creatorName(): string
    {
        return match ($this->creator_type) {
            FeedbackCreatorType::Client => $this->creatorClientAccount?->name ?? $this->feedbackProject->clientLabel(),
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
     * 客戶端「上次開啟這張單」的時間（SQL）：客戶帳號各自記在 feedback_client_reads；還沒開過的單，
     * 帳號建立之前的內容都算讀過，新帳號不會一開始就整片未讀。沒有帳號（專屬連結、公開回報者）用共用的時間。
     * 只能用在以 feedback_reports 為外層的查詢。
     *
     * @return array{0: string, 1: list<int|string>}
     */
    public static function clientReadAtSql(?FeedbackClientAccount $viewer): array
    {
        if ($viewer === null) {
            return ['feedback_reports.client_last_read_at', []];
        }

        return [
            '(COALESCE((SELECT fcr.last_read_at FROM feedback_client_reads fcr WHERE fcr.feedback_client_account_id = ? AND fcr.feedback_report_id = feedback_reports.id), ?))',
            [$viewer->id, $viewer->created_at->copy()->utc()->format('Y-m-d H:i:s')],
        ];
    }

    /**
     * 客戶端清單要用的：這位客戶（或共用客戶端）上次開啟之後，開發者（含 AI）新增的留言數，
     * 另外帶出上次開啟時間（viewer_read_at）給「調整說明有更新」判斷。
     *
     * @param  Builder<FeedbackReport>  $query
     */
    #[Scope]
    protected function withClientNewReplyCount(Builder $query, ?FeedbackClientAccount $viewer = null): void
    {
        [$readAt, $bindings] = static::clientReadAtSql($viewer);

        if ($query->getQuery()->columns === null) {
            $query->select('feedback_reports.*');
        }
        $query->selectRaw("{$readAt} as viewer_read_at", $bindings);

        $query->withCount(['feedbackMessages as client_new_replies_count' => fn (Builder $query) => $query
            ->whereIn('feedback_messages.author_type', [FeedbackAuthorType::Owner->value, FeedbackAuthorType::Agent->value])
            ->where(fn (Builder $query) => $query
                ->whereRaw("{$readAt} IS NULL", $bindings)
                ->orWhereRaw("feedback_messages.created_at > {$readAt}", $bindings))]);
    }

    /**
     * 客戶端的「有新動態」：開發者在客戶上次開啟後留言，或更新了調整說明（後者不算未讀留言）。
     * 需先用 withClientNewReplyCount 載入留言數。
     */
    public function hasNewReplyForClient(): bool
    {
        return $this->adjustmentIsNewForClient() || (int) ($this->client_new_replies_count ?? 0) > 0;
    }

    /**
     * 開發者在客戶上次開啟這張單之後更新了調整說明。查詢有帶 viewer_read_at（withClientNewReplyCount）時以它為準，
     * 否則傳入客戶帳號另外查。
     */
    public function adjustmentIsNewForClient(?FeedbackClientAccount $viewer = null): bool
    {
        if ($this->adjustment_updated_at === null) {
            return false;
        }

        $readAt = $this->clientReadAt($viewer);

        return $readAt === null || $this->adjustment_updated_at->greaterThan($readAt);
    }

    /**
     * 這位客戶（null：共用客戶端）上次開啟這張單的時間。
     */
    public function clientReadAt(?FeedbackClientAccount $viewer = null): ?Carbon
    {
        if (array_key_exists('viewer_read_at', $this->attributes) && $viewer === null) {
            return $this->attributes['viewer_read_at'] !== null ? Carbon::parse($this->attributes['viewer_read_at']) : null;
        }

        if ($viewer === null) {
            return $this->client_last_read_at;
        }

        $readAt = FeedbackClientRead::query()
            ->where('feedback_client_account_id', $viewer->id)
            ->where('feedback_report_id', $this->id)
            ->value('last_read_at');

        return $readAt !== null ? Carbon::parse($readAt) : $viewer->created_at;
    }

    /**
     * 清單、看板與對話面板共用的未讀數（紅色數字），只算對方的新留言：開發者看客戶的新留言；客戶看開發者（含 AI）的新留言。
     * 調整說明更新不算未讀，另用 adjustmentIsNewForClient 顯示「說明已更新」標籤。
     * 需先用 withOwnerMessageStats 或 withClientNewReplyCount 載入留言數。
     */
    public function unreadCountFor(bool $forOwner): int
    {
        return (int) ($forOwner ? ($this->unread_messages_count ?? 0) : ($this->client_new_replies_count ?? 0));
    }

    /**
     * 留言對話面板、問題清單與看板共用的預設排序（resources/js/chat-order.js 用同一套規則）：
     * 有未讀留言的最前（調整說明更新不算）、其次有留言但已讀的，兩者依最新留言時間新到舊；沒有留言的最後，依建立時間新到舊。
     * 同時間再依編號新到舊（編號最新為 1）。鍵值由大到小排即為上述順序。
     *
     * @return array{0: int, 1: int, 2: int}
     */
    public static function conversationSortKey(int $unread, int $messagesCount, CarbonInterface|string|null $latestMessageAt, CarbonInterface|string $createdAt, int $number): array
    {
        $tier = match (true) {
            $unread > 0 => 2,
            $messagesCount > 0 => 1,
            default => 0,
        };
        $time = $tier > 0 && $latestMessageAt !== null ? $latestMessageAt : $createdAt;

        return [$tier, Carbon::parse($time)->getTimestamp(), -$number];
    }

    /**
     * 依檢視者身分取這張單的預設排序鍵；需先用 withOwnerMessageStats，或 withClientNewReplyCount 加留言數與最新留言時間。
     *
     * @return array{0: int, 1: int, 2: int}
     */
    public function conversationSortKeyFor(bool $forOwner, int $number): array
    {
        return static::conversationSortKey(
            $this->unreadCountFor($forOwner),
            (int) ($this->feedback_messages_count ?? 0),
            $this->latest_message_at,
            $this->created_at,
            $number,
        );
    }

    public function markReadByOwner(): void
    {
        $this->markReadAt('owner_last_read_at');
    }

    /**
     * 客戶端讀過：共用的客戶已讀時間照樣更新（專屬連結用它），客戶帳號另外記自己的。
     */
    public function markReadByClient(?FeedbackClientAccount $viewer = null): void
    {
        $this->markReadAt('client_last_read_at');

        if ($viewer !== null) {
            FeedbackClientRead::query()->upsert(
                [['feedback_client_account_id' => $viewer->id, 'feedback_report_id' => $this->id, 'last_read_at' => $this->client_last_read_at]],
                ['feedback_client_account_id', 'feedback_report_id'],
                ['last_read_at'],
            );
        }
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
            'claimed_at' => 'datetime',
            'latest_message_at' => 'datetime',
        ];
    }
}
