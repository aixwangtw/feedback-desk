<?php

namespace Database\Factories;

use App\Enums\FeedbackAutomationStatus;
use App\Models\FeedbackAutomationRun;
use App\Models\FeedbackReport;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<FeedbackAutomationRun>
 */
class FeedbackAutomationRunFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'feedback_report_id' => FeedbackReport::factory(),
            'status' => FeedbackAutomationStatus::Queued,
        ];
    }
}
