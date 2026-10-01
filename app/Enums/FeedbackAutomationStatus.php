<?php

namespace App\Enums;

enum FeedbackAutomationStatus: string
{
    case Queued = 'queued';
    case Running = 'running';
    case Completed = 'completed';
    case NeedsInput = 'needs_input';
    case Failed = 'failed';
}
