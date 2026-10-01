<?php

namespace Database\Factories;

use App\Enums\FeedbackAuthorType;
use App\Models\FeedbackMessage;
use App\Models\FeedbackReport;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<FeedbackMessage>
 */
class FeedbackMessageFactory extends Factory
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
            'author_type' => FeedbackAuthorType::Reporter,
            'author_name' => fake()->name(),
            'body' => fake()->paragraph(),
        ];
    }
}
