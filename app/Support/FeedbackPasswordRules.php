<?php

namespace App\Support;

/**
 * 本人自己設定的密碼規則；系統產生的密碼不經過這裡。只擋明顯太弱的，頁面上建議用密碼管理器產生。
 */
class FeedbackPasswordRules
{
    public const MIN_LENGTH = 16;

    public const MAX_LENGTH = 200;

    /**
     * 不合格的原因（繁體中文）；空陣列表示可以用。
     *
     * @return list<string>
     */
    public static function problems(string $password, string $username): array
    {
        $points = self::codePoints($password);
        if (count($points) < self::MIN_LENGTH) {
            return ['密碼至少要 '.self::MIN_LENGTH.' 個字。'];
        }
        if (count($points) > self::MAX_LENGTH) {
            return ['密碼不能超過 '.self::MAX_LENGTH.' 個字。'];
        }
        if (trim($password) !== $password) {
            return ['密碼開頭或結尾不能是空白。'];
        }

        $problems = [];
        if (self::isShortRepeat($points)) {
            $problems[] = '密碼不能是同一個字或同一小段重複。';
        } elseif (self::isSequence($points)) {
            $problems[] = '密碼不能是連續的字元（例如 abcdefgh…、12345678…）。';
        }

        $lowered = mb_strtolower($password);
        $account = mb_strtolower(trim($username));
        if ($account !== '' && ($lowered === $account || (mb_strlen($account) >= 3 && str_contains($lowered, $account)))) {
            $problems[] = '密碼不能包含帳號。';
        }

        return $problems;
    }

    /**
     * @return list<int>
     */
    private static function codePoints(string $value): array
    {
        return array_map('mb_ord', mb_str_split($value));
    }

    /**
     * 整個密碼是一小段（1～4 字）重複，例如 abcabcabc…、12121212…。
     *
     * @param  list<int>  $points
     */
    private static function isShortRepeat(array $points): bool
    {
        for ($size = 1; $size <= 4; $size++) {
            $repeats = true;
            for ($i = $size, $count = count($points); $i < $count; $i++) {
                if ($points[$i] !== $points[$i % $size]) {
                    $repeats = false;
                    break;
                }
            }
            if ($repeats) {
                return true;
            }
        }

        return false;
    }

    /**
     * 每個字都比前一個多 1（或少 1），例如 abcdefghijklmnop。
     *
     * @param  list<int>  $points
     */
    private static function isSequence(array $points): bool
    {
        $step = $points[1] - $points[0];
        if ($step !== 1 && $step !== -1) {
            return false;
        }

        for ($i = 2, $count = count($points); $i < $count; $i++) {
            if ($step !== $points[$i] - $points[$i - 1]) {
                return false;
            }
        }

        return true;
    }
}
