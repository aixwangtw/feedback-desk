<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 交接紀錄：工作中斷時留給下一個人或 AI 的進度筆記，只有團隊看得到。
 */
#[Fillable(['feedback_report_id', 'feedback_developer_id', 'author_name', 'agent', 'body'])]
class FeedbackHandoffNote extends Model
{
    /** @return BelongsTo<FeedbackDeveloper, $this> */
    public function feedbackDeveloper(): BelongsTo
    {
        return $this->belongsTo(FeedbackDeveloper::class);
    }
}
