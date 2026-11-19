<?php

namespace App\Support;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;

/**
 * 清單與看板的三個頁籤（待處理／待回覆／已完成）、每張單上的「等開發／等客戶」標示共用。
 * 2026-11-19 使用者：「改回3個頁籤 待處理 待回覆 已完成 待處理就是等工程師 待回覆就是等老師或業主回覆 已完成不縮小」。
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
    public const TABS = [self::DEVELOPER, self::CLIENT, self::COMPLETED];

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
     * 頁籤標題固定為待處理／待回覆／已完成（不跟著看板自訂的狀態名稱）。
     */
    public static function tabLabel(string $waitingOn): string
    {
        return match ($waitingOn) {
            self::DEVELOPER => '待處理',
            self::CLIENT => '待回覆',
            default => '已完成',
        };
    }

    /**
     * 頁籤滑鼠移上去的說明：待處理＝等工程師，待回覆＝等老師或業主回覆（用看板設定的狀態名稱）。
     */
    public static function tabHint(string $waitingOn, ?FeedbackProject $project = null): string
    {
        return $waitingOn === self::COMPLETED
            ? '已完成的單'
            : self::status($waitingOn)->label($project).'的單';
    }

    /**
     * 每張單上的標示（同狀態名稱）；已完成沒有標示。
     */
    public static function badgeLabel(string $waitingOn, ?FeedbackProject $project = null): ?string
    {
        return $waitingOn === self::COMPLETED ? null : self::status($waitingOn)->label($project);
    }
}
