<?php

namespace Database\Factories;

use App\Models\FeedbackProject;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
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
            'client_username' => 'test',
            'client_password_hash' => Hash::make('change-me'),
            'login_prefill_username' => 'test',
            'login_prefill_password' => 'change-me',
            'repository_path' => null,
            'automation_enabled' => false,
        ];
    }

    /**
     * 沒有設定老師帳號的專案。
     */
    public function withoutClientAccount(): static
    {
        return $this->state([
            'client_username' => null,
            'client_password_hash' => null,
            'login_prefill_username' => null,
            'login_prefill_password' => null,
        ]);
    }
}
