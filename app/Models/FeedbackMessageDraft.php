<?php

namespace App\Models;

use App\Support\FeedbackAgentName;
use App\Support\FeedbackTeamName;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 待審留言（草稿）：只有開發團隊看得到；團隊按「送出」才變成正式留言（或改寫 replaces_message_id 指的那則團隊留言）。
 *
 * @property list<array{disk: string, path: string, original_name: string, mime_type: string, size: int}>|null $attachments
 */
#[Fillable(['feedback_report_id', 'replaces_message_id', 'author_developer_id', 'author_name', 'author_agent', 'body', 'attachments'])]
class FeedbackMessageDraft extends Model
{
    /** @return BelongsTo<FeedbackReport, $this> */
    public function feedbackReport(): BelongsTo
    {
        return $this->belongsTo(FeedbackReport::class);
    }

    /** @return BelongsTo<FeedbackMessage, $this> */
    public function replacesMessage(): BelongsTo
    {
        return $this->belongsTo(FeedbackMessage::class, 'replaces_message_id');
    }

    /** @return BelongsTo<FeedbackDeveloper, $this> */
    public function authorDeveloper(): BelongsTo
    {
        return $this->belongsTo(FeedbackDeveloper::class, 'author_developer_id');
    }

    /**
     * 畫面上「誰寫的草稿」：有帳號顯示帳號目前的名字，AI 寫的加上工具名稱。
     */
    public function displayAuthor(): string
    {
        // 畫面上團隊一律顯示人名：個人帳號用帳號的名字，共用身分（含 AI 代發）用共用名字；AI 工具名稱只留在資料庫。
        return FeedbackAgentName::label($this->authorDeveloper?->name ?? FeedbackTeamName::shared(), $this->author_agent, true);
    }

    /**
     * @return list<array{disk: string, path: string, original_name: string, mime_type: string, size: int}>
     */
    public function attachmentList(): array
    {
        return array_values($this->attachments ?? []);
    }

    protected function casts(): array
    {
        return [
            'attachments' => 'array',
        ];
    }
}
