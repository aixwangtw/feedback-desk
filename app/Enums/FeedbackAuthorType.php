<?php

namespace App\Enums;

enum FeedbackAuthorType: string
{
    case Reporter = 'reporter';
    case Owner = 'owner';
    case Agent = 'agent';

    public function label(): string
    {
        return match ($this) {
            self::Reporter => '老師',
            self::Owner => '開發者',
            self::Agent => 'Vibe coding',
        };
    }
}
