<?php

namespace App\Support;

use RuntimeException;

/**
 * 給 MCP、artisan 指令與網頁共用的業務錯誤：code 給程式判斷，message 給人看。
 */
class FeedbackServiceException extends RuntimeException
{
    public function __construct(public readonly string $errorCode, string $message, public readonly int $status = 422)
    {
        parent::__construct($message);
    }
}
