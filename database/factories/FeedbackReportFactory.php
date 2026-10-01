<?php

namespace Database\Factories;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<FeedbackReport>
 */
class FeedbackReportFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'feedback_project_id' => FeedbackProject::factory(),
            'public_id' => (string) Str::uuid(),
            'reporter_token_hash' => hash('sha256', Str::random(48)),
            'reporter_name' => fake()->name(),
            'title' => fake()->sentence(6),
            'description' => fake()->paragraph(),
            'page_url' => fake()->url(),
            'status' => FeedbackReportStatus::New,
            'latest_activity_at' => now(),
        ];
    }
}
