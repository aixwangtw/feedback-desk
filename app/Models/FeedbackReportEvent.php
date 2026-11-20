<?php

namespace App\Models;

use App\Enums\FeedbackReportStatus;
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
        'draft' => '寫待審留言',
        'message_edit' => '修改留言',
        'adjustment' => '寫調整重點',
        'status' => '改狀態',
        'reopen_by_message' => '留言後改回',
        'reopen_by_client' => '按「待處理」改回',
        'claim' => '認領',
        'release' => '釋放認領',
        'takeover' => '接手',
        'handoff' => '寫交接紀錄',
        'merged' => '合併重複的單',
    ];

    /**
     * 顯示用名稱。客戶重新開啟的兩種事件把目標狀態名稱接在後面（例如「留言後改回等工程師」），狀態名稱照看板設定。
     */
    public static function labelFor(string $kind, ?FeedbackProject $project = null): string
    {
        $label = self::LABELS[$kind] ?? $kind;

        return in_array($kind, ['reopen_by_message', 'reopen_by_client'], true)
            ? $label.FeedbackReportStatus::New->label($project)
            : $label;
    }

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
