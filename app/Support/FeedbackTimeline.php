<?php

namespace App\Support;

use App\Models\FeedbackMessage;
use App\Models\FeedbackReport;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * 留言時間軸（單頁、詳情視窗、右下角面板共用）：只有留言本身，不顯示「某某將狀態改為…」這類狀態變更紀錄；
 * 單目前的狀態看右側欄。狀態變更紀錄仍存在最近動態（events），只是畫面上不列。
 */
class FeedbackTimeline
{
    /**
     * @return Collection<int, array{type: 'message', at: Carbon, message: FeedbackMessage}>
     */
    public function entries(FeedbackReport $report): Collection
    {
        $entries = $report->feedbackMessages->map(fn (FeedbackMessage $message): array => [
            'type' => 'message',
            'at' => $message->created_at,
            'message' => $message,
            'order' => [0, $message->id],
        ]);

        return $entries
            ->sort(fn (array $a, array $b): int => [$a['at']->getTimestamp(), ...$a['order']] <=> [$b['at']->getTimestamp(), ...$b['order']])
            ->values();
    }
}
