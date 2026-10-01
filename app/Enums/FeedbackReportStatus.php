<?php

namespace App\Enums;

enum FeedbackReportStatus: string
{
    case New = 'new';
    case InProgress = 'in_progress';
    case NeedsInput = 'needs_input';
    case Completed = 'completed';
    case Failed = 'failed';

    public function label(): string
    {
        return match ($this) {
            self::New => '待處理',
            self::InProgress => '處理中',
            self::NeedsInput => '待補充',
            self::Completed => '已完成',
            self::Failed => '處理失敗',
        };
    }
}
