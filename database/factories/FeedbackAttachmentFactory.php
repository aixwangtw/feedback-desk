<?php

namespace Database\Factories;

use App\Models\FeedbackAttachment;
use App\Models\FeedbackReport;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<FeedbackAttachment>
 */
class FeedbackAttachmentFactory extends Factory
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
            'feedback_message_id' => null,
            'disk' => 'local',
            'path' => 'feedback/test.png',
            'original_name' => 'screenshot.png',
            'mime_type' => 'image/png',
            'size' => 1024,
        ];
    }
}
