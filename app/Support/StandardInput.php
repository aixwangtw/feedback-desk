<?php

namespace App\Support;

/**
 * artisan 指令讀標準輸入（例如 `echo 內容 | php artisan ...`、經 ssh 傳入的文字）。獨立成類別方便測試替換。
 */
class StandardInput
{
    /**
     * 讀出標準輸入的全部內容；標準輸入是終端機（沒有用管線或導向傳入）時回 null，不會卡住等人打字。
     */
    public function read(): ?string
    {
        if (! defined('STDIN') || stream_isatty(STDIN)) {
            return null;
        }

        $content = stream_get_contents(STDIN);

        return $content === false ? null : $content;
    }
}
