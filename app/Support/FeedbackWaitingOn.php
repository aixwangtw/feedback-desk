<?php

namespace App\Support;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackReport;

/**
 * 這張單在等誰：清單與看板的兩個頁籤、每張單上的「等開發團隊／等客戶」標示共用。
 * 不新增狀態值，由現有狀態與最後留言推導：
 *  - 已完成 → completed（不放頁籤，最右邊連結）
 *  - 待處理，或客戶最後留言晚於團隊最後回覆（留言或調整重點）→ developer（等開發團隊回覆）
 *  - 其餘（待審核且團隊回覆在後）→ client（等客戶回覆）
 * 查詢要帶 withWaitingStats（latest_reporter_message_at、latest_team_message_at）。
 */
final class FeedbackWaitingOn
{
    public const DEVELOPER = 'developer';

    public const CLIENT = 'client';

    public const COMPLETED = 'completed';

    /** 不分頁籤看全部（頁籤列最右邊的小連結，找舊單用）。 */
    public const ALL = 'all';

    /** @var list<string> */
    public const TABS = [self::DEVELOPER, self::CLIENT];

    public static function for(FeedbackReport $report): string
    {
        if ($report->status === FeedbackReportStatus::Completed) {
            return self::COMPLETED;
        }
        if ($report->status === FeedbackReportStatus::New) {
            return self::DEVELOPER;
        }

        $reporterAt = self::timestamp($report->latest_reporter_message_at ?? null);
        $teamAt = max(self::timestamp($report->latest_team_message_at ?? null) ?? 0, $report->adjustment_updated_at?->getTimestamp() ?? 0);

        return $reporterAt !== null && $reporterAt > $teamAt ? self::DEVELOPER : self::CLIENT;
    }

    /**
     * 頁籤標題：待開發者回覆／待老師回覆（稱呼照站台設定）。
     */
    public static function tabLabel(string $waitingOn): string
    {
        return $waitingOn === self::CLIENT
            ? '待'.config('feedback.labels.client').'回覆'
            : '待'.config('feedback.labels.owner').'回覆';
    }

    /**
     * 每張單上的標示：等開發者／等老師；已完成沒有標示。
     */
    public static function badgeLabel(string $waitingOn): ?string
    {
        return match ($waitingOn) {
            self::DEVELOPER => '等'.config('feedback.labels.owner'),
            self::CLIENT => '等'.config('feedback.labels.client'),
            default => null,
        };
    }

    private static function timestamp(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if ($value instanceof \DateTimeInterface) {
            return $value->getTimestamp();
        }
        $time = strtotime((string) $value.' UTC');

        return $time === false ? null : $time;
    }
}
