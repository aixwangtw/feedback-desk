<?php

namespace App\Support;

/**
 * 開發團隊在畫面上的人名：開發者個人帳號顯示帳號的 name；共用團隊身分（共用 owner 帳號、AI 工具代發）
 * 顯示 config('feedback.shared_owner_name')（例如 Alex），沒設定時退回 labels.owner。
 * 畫面上不顯示「開發者」稱呼，也不顯示 AI 工具名稱（agent 只留在資料庫與只有團隊看得到的稽核紀錄）。
 */
class FeedbackTeamName
{
    /** 共用團隊身分要顯示的名字。 */
    public static function shared(): string
    {
        $name = trim((string) config('feedback.shared_owner_name'));

        return $name !== '' ? $name : (string) config('feedback.labels.owner');
    }

    /** 這個名字是不是共用團隊身分（含舊資料裡存的「開發團隊」稱呼）。 */
    public static function isShared(string $name): bool
    {
        return $name === self::shared() || $name === (string) config('feedback.labels.owner');
    }
}
