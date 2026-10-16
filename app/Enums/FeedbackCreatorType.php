<?php

namespace App\Enums;

enum FeedbackCreatorType: string
{
    case Client = 'client';
    case Developer = 'developer';
    case OwnerShared = 'owner_shared';

    /**
     * 老師看不到開發者建立的單（個別開發者帳號與共用身分都算）。
     */
    public function isDeveloperSide(): bool
    {
        return $this !== self::Client;
    }
}
