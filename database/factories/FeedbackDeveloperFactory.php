<?php

namespace Database\Factories;

use App\Models\FeedbackDeveloper;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/**
 * @extends Factory<FeedbackDeveloper>
 */
class FeedbackDeveloperFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->firstName(),
            'username' => fake()->unique()->userName(),
            'password_hash' => Hash::make('dev-password'),
        ];
    }

    public function withPassword(string $password): static
    {
        return $this->state(fn (): array => ['password_hash' => Hash::make($password)]);
    }
}
