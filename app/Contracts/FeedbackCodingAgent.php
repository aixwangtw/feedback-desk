<?php

namespace App\Contracts;

use App\Models\FeedbackAutomationRun;
use App\Models\FeedbackReport;
use App\Support\FeedbackCodingResult;

interface FeedbackCodingAgent
{
    public function resolve(FeedbackReport $report, FeedbackAutomationRun $run): FeedbackCodingResult;
}
