<?php

namespace App\Support;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;

/**
 * 清單與看板的兩個頁籤、每張單上的「等開發／等客戶」標示共用。
 * 直接對應狀態：等開發＝new（developer 頁籤）、等客戶＝needs_input（client 頁籤）、已完成＝completed。
 * 頁籤與標示的文字就是狀態名稱（config feedback.status_labels）。
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
        return self::fromStatus($report->status);
    }

    public static function fromStatus(FeedbackReportStatus $status): string
    {
        return match ($status) {
            FeedbackReportStatus::New => self::DEVELOPER,
            FeedbackReportStatus::NeedsInput => self::CLIENT,
            FeedbackReportStatus::Completed => self::COMPLETED,
        };
    }

    public static function status(string $waitingOn): FeedbackReportStatus
    {
        return match ($waitingOn) {
            self::DEVELOPER => FeedbackReportStatus::New,
            self::CLIENT => FeedbackReportStatus::NeedsInput,
            default => FeedbackReportStatus::Completed,
        };
    }

    /**
     * 頁籤標題＝狀態名稱：等開發／等老師。
     */
    public static function tabLabel(string $waitingOn, ?FeedbackProject $project = null): string
    {
        return self::status($waitingOn)->label($project);
    }

    /**
     * 每張單上的標示（同狀態名稱）；已完成沒有標示。
     */
    public static function badgeLabel(string $waitingOn, ?FeedbackProject $project = null): ?string
    {
        return $waitingOn === self::COMPLETED ? null : self::status($waitingOn)->label($project);
    }
}
