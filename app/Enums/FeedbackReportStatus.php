<?php

namespace App\Enums;

enum FeedbackReportStatus: string
{
    case New = 'new';
    case NeedsInput = 'needs_input';
    case Completed = 'completed';

    /**
     * 接受狀態值（needs_input）或中文顯示名（待審核），不分大小寫。
     */
    public static function fromInput(string $input): ?self
    {
        $input = mb_strtolower(trim($input));

        foreach (self::cases() as $case) {
            if ($input === $case->value || $input === mb_strtolower($case->label())) {
                return $case;
            }
        }

        return null;
    }

    /**
     * @return list<string> 例如 ["new（待處理）", ...]
     */
    public static function describedOptions(): array
    {
        return array_map(fn (self $case): string => "{$case->value}（{$case->label()}）", self::cases());
    }

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
