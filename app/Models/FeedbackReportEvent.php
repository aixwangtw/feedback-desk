<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * 最近動態：誰（哪個帳號、哪個 AI 工具）對這張單做了什麼。只有團隊看得到。
 */
#[Fillable(['feedback_report_id', 'kind', 'feedback_developer_id', 'feedback_client_account_id', 'actor_name', 'agent', 'detail'])]
class FeedbackReportEvent extends Model
{
    public const LABELS = [
        'created' => '開單',
        'message' => '留言',
        'adjustment' => '寫調整說明',
        'status' => '改狀態',
        'claim' => '認領',
        'release' => '釋放認領',
        'takeover' => '接手',
        'handoff' => '寫交接紀錄',
    ];

    /** @return BelongsTo<FeedbackDeveloper, $this> */
    public function feedbackDeveloper(): BelongsTo
    {
        return $this->belongsTo(FeedbackDeveloper::class);
    }

    /** @return BelongsTo<FeedbackClientAccount, $this> */
    public function feedbackClientAccount(): BelongsTo
    {
        return $this->belongsTo(FeedbackClientAccount::class);
    }
}
