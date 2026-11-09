<?php

namespace App\Enums;

use App\Models\FeedbackProject;

enum FeedbackReportStatus: string
{
    /** 改名前的中文名稱，CLI／MCP 輸入照樣接受（排程與舊筆記還在用）。 */
    public const LEGACY_LABELS = ['待處理' => self::New, '待審核' => self::NeedsInput];

    case New = 'new';
    case NeedsInput = 'needs_input';
    case Completed = 'completed';

    /**
     * 接受狀態值（needs_input）、目前的中文顯示名（等老師），或改名前的舊名稱（待處理／待審核），不分大小寫。
     */
    public static function fromInput(string $input, ?FeedbackProject $project = null): ?self
    {
        $input = mb_strtolower(trim($input));

        foreach (self::cases() as $case) {
            if ($input === $case->value || $input === mb_strtolower($case->label($project)) || $input === mb_strtolower($case->label())) {
                return $case;
            }
        }

        return self::LEGACY_LABELS[$input] ?? null;
    }

    /**
     * @return list<string> 例如 ["new（等開發）", ...]
     */
    public static function describedOptions(?FeedbackProject $project = null): array
    {
        return array_map(fn (self $case): string => "{$case->value}（{$case->label($project)}）", self::cases());
    }

    /**
     * 顯示名稱。給了看板就用看板自訂的（FeedbackProject::statusLabel）；沒給或看板沒設定，用全站 config。
     * 所有畫面、CLI、MCP、API 都走這裡，不直接讀 config。
     */
    public function label(?FeedbackProject $project = null): string
    {
        return $project?->statusLabelOverrides()[$this->value]
            ?? (string) config("feedback.status_labels.{$this->value}", $this->value);
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
