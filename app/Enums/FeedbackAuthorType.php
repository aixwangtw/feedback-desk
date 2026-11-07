<?php

namespace App\Enums;

use App\Support\FeedbackTeamName;

enum FeedbackAuthorType: string
{
    case Reporter = 'reporter';
    case Owner = 'owner';
    case Agent = 'agent';

    public function label(): string
    {
        return match ($this) {
            self::Reporter => (string) config('feedback.labels.client'),
            self::Owner => FeedbackTeamName::shared(),
            self::Agent => 'Vibe coding',
        };
    }
}
