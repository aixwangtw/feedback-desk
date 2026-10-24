<?php

namespace App\Contracts;

use App\Models\FeedbackAutomationRun;
use App\Models\FeedbackReport;
use App\Support\FeedbackCodingResult;

interface FeedbackCodingAgent
{
    /**
     * 顯示在留言與動態上的工具名稱。
     */
    public function name(): string;

    public function resolve(FeedbackReport $report, FeedbackAutomationRun $run): FeedbackCodingResult;
}
