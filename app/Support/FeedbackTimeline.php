<?php

namespace App\Support;

use App\Models\FeedbackMessage;
use App\Models\FeedbackReport;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * 活動時間軸：留言與狀態變更依時間排在一起（單頁、詳情視窗、右下角面板共用）。
 * 狀態變更取自最近動態裡的 status 紀錄（「new>needs_input」）；沒有記到動作者的狀態變更不會出現。
 */
class FeedbackTimeline
{
    /**
     * @return Collection<int, array{type: 'message', at: Carbon, message: FeedbackMessage}|array{type: 'status', at: Carbon, from: string, to: string, actor: string, agent: string|null}>
     */
    public function entries(FeedbackReport $report): Collection
    {
        $entries = $report->feedbackMessages->map(fn (FeedbackMessage $message): array => [
            'type' => 'message',
            'at' => $message->created_at,
            'message' => $message,
            'order' => [0, $message->id],
        ]);

        $events = $report->events()->where('kind', 'status')->orderBy('id')->get()
            ->map(function ($event): ?array {
                [$from, $to] = array_pad(explode('>', (string) $event->detail, 2), 2, '');
                if ($to === '') {
                    return null;
                }

                return [
                    'type' => 'status',
                    'at' => $event->created_at,
                    'from' => $from,
                    'to' => $to,
                    'actor' => $event->actor_name,
                    'agent' => $event->agent,
                    'order' => [1, $event->id],
                ];
            })
            ->filter();

        return $entries->concat($events)
            ->sort(fn (array $a, array $b): int => [$a['at']->getTimestamp(), ...$a['order']] <=> [$b['at']->getTimestamp(), ...$b['order']])
            ->values();
    }
}
