<?php

namespace App\Enums;

enum FeedbackReportStatus: string
{
    case New = 'new';
    case NeedsInput = 'needs_input';
    case Completed = 'completed';

    public function label(): string
    {
        return match ($this) {
            self::New => '待處理',
            self::NeedsInput => '待審核',
            self::Completed => '已完成',
        };
    }

    /**
     * Tailwind background class of the colour dot shown beside this status.
     */
    public function dotClass(): string
    {
        return match ($this) {
            self::New => 'bg-slate-500',
            self::NeedsInput => 'bg-amber-500',
            self::Completed => 'bg-emerald-500',
        };
    }
}
