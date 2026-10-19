<?php

namespace App\Models;

use App\Enums\FeedbackAuthorType;
use App\Support\FeedbackAgentName;
use Database\Factories\FeedbackMessageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['feedback_report_id', 'author_type', 'author_name', 'author_client_account_id', 'author_developer_id', 'author_agent', 'body'])]
class FeedbackMessage extends Model
{
    /** @use HasFactory<FeedbackMessageFactory> */
    use HasFactory;

    /** @return BelongsTo<FeedbackReport, $this> */
    public function feedbackReport(): BelongsTo
    {
        return $this->belongsTo(FeedbackReport::class);
    }

    /** @return BelongsTo<FeedbackClientAccount, $this> */
    public function authorClientAccount(): BelongsTo
    {
        return $this->belongsTo(FeedbackClientAccount::class, 'author_client_account_id');
    }

    /** @return BelongsTo<FeedbackDeveloper, $this> */
    public function authorDeveloper(): BelongsTo
    {
        return $this->belongsTo(FeedbackDeveloper::class, 'author_developer_id');
    }

    /**
     * 畫面上的留言者：有帳號的顯示帳號目前的名字，AI 寫的加上工具名稱。
     * 公開回報的單維持寫入時的名字（團隊在公開單上一律顯示團隊稱呼），回報者也看不到是哪個 AI。
     */
    public function displayAuthor(FeedbackReport $report, bool $viewerIsOwner): string
    {
        $isPublic = $report->isPublicReport();
        $name = $isPublic
            ? null
            : ($this->author_client_account_id !== null ? $this->authorClientAccount?->name : null)
                ?? ($this->author_developer_id !== null ? $this->authorDeveloper?->name : null);
        $name ??= filled($this->author_name) ? $this->author_name : $this->author_type->label();

        return FeedbackAgentName::label($name, $isPublic && ! $viewerIsOwner ? null : $this->author_agent);
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
