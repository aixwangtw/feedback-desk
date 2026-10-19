<?php

namespace App\Support;

/**
 * 哪個 AI 工具做的。來源依序是：token 建立時指定的名稱、MCP 用戶端連線時自報的 clientInfo.name、
 * artisan 指令的 --agent／FEEDBACK_DESK_AGENT（在 Claude Code、Codex 裡會自動判斷）。
 * 都是自報的標籤，不是身分證明；身分以帳號為準。
 */
class FeedbackAgentName
{
    public const MAX_LENGTH = 40;

    /**
     * 常見 MCP 用戶端 clientInfo.name 的好讀名稱。
     */
    private const KNOWN_CLIENTS = [
        'claude-code' => 'Claude Code',
        'claudecode' => 'Claude Code',
        'claude' => 'Claude Code',
        'codex' => 'Codex',
        'codex-mcp-client' => 'Codex',
        'codexmcpclient' => 'Codex',
    ];

    /**
     * 清理自報的工具名稱：只留文字（任何語言）、數字、空白與 . _ - / +，最多 40 字。
     * 不留括號，名稱就沒辦法假裝成「名字（工具）」的一部分。清完是空的就回 null。
     */
    public static function normalize(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }

        $key = mb_strtolower(trim($value));
        $known = self::KNOWN_CLIENTS[preg_replace('/[\s_]+/u', '-', $key)] ?? self::KNOWN_CLIENTS[preg_replace('/[\s_-]+/u', '', $key)] ?? null;
        if ($known !== null) {
            return $known;
        }

        if (class_exists(\Normalizer::class)) {
            $value = (string) \Normalizer::normalize($value, \Normalizer::FORM_KC);
        }

        $cleaned = trim((string) preg_replace('/\s+/u', ' ', (string) preg_replace('/[^\p{L}\p{N} ._\-\/+]/u', '', $value)));

        return $cleaned === '' ? null : mb_substr($cleaned, 0, self::MAX_LENGTH);
    }

    /**
     * 「王小明（Codex）」；人在網頁上做的只顯示名字。
     */
    public static function label(string $name, ?string $agent): string
    {
        return $agent !== null && $agent !== '' ? "{$name}（{$agent}）" : $name;
    }

    /**
     * artisan 指令由哪個 AI 執行：--agent 或 FEEDBACK_DESK_AGENT 優先；否則 Codex 的 shell 有
     * CODEX_THREAD_ID／CODEX_SESSION_ID，Claude Code 有 CLAUDECODE=1。先判斷 Codex，
     * 因為從 Claude Code 開的 Codex 會繼承 CLAUDECODE。
     */
    public static function fromEnvironment(?string $option = null): ?string
    {
        $explicit = $option ?? self::env('FEEDBACK_DESK_AGENT');
        if ($explicit !== null && $explicit !== '') {
            return self::normalize($explicit);
        }

        if (self::env('CODEX_THREAD_ID') || self::env('CODEX_SESSION_ID')) {
            return 'Codex';
        }

        return self::env('CLAUDECODE') === '1' ? 'Claude Code' : null;
    }

    private static function env(string $name): ?string
    {
        $value = getenv($name);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
