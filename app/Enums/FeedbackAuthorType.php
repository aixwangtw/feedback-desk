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
            self::Reporter => (string) config('feedback.labels.client'),
            self::Owner => (string) config('feedback.labels.owner'),
            self::Agent => 'Vibe coding',
        };
    }
}
