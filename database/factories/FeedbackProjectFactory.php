<?php

namespace Database\Factories;

use App\Models\FeedbackProject;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<FeedbackProject>
 */
class FeedbackProjectFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = fake()->unique()->company();

        return [
            'name' => $name,
            'slug' => Str::slug($name).'-'.fake()->unique()->randomNumber(4),
            'owner_token_hash' => hash('sha256', Str::random(48)),
            'repository_path' => null,
            'automation_enabled' => false,
        ];
    }
}
