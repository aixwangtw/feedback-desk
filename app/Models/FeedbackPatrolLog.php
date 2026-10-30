<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 排程 API 的寫入操作紀錄：哪個 token、做了什麼、對哪張單、成功與否。不存留言或說明全文，只存長度等摘要。
 */
#[Fillable(['feedback_patrol_token_id', 'action', 'project_slug', 'report_public_id', 'succeeded', 'detail', 'ip'])]
class FeedbackPatrolLog extends Model
{
    /** @return BelongsTo<FeedbackPatrolToken, $this> */
    public function feedbackPatrolToken(): BelongsTo
    {
        return $this->belongsTo(FeedbackPatrolToken::class);
    }

    protected function casts(): array
    {
        return [
            'succeeded' => 'boolean',
            'detail' => 'array',
        ];
    }
}
