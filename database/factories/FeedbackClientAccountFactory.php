<?php

namespace Database\Factories;

use App\Models\FeedbackClientAccount;
use App\Models\FeedbackProject;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/**
 * @extends Factory<FeedbackClientAccount>
 */
class FeedbackClientAccountFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'feedback_project_id' => FeedbackProject::factory()->withoutClientAccount(),
            'username' => fake()->unique()->userName(),
            'name' => fake()->name(),
            'password_hash' => Hash::make('client-account-pass'),
            'password_set_by_self' => false,
        ];
    }

    public function withPassword(string $password): static
    {
        return $this->state(fn (): array => ['password_hash' => Hash::make($password)]);
    }

    public function disabled(): static
    {
        return $this->state(fn (): array => ['disabled_at' => now()]);
    }

    public function passwordSetBySelf(): static
    {
        return $this->state(fn (): array => ['password_set_by_self' => true]);
    }
}
