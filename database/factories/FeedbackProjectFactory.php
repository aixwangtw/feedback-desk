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
            'client_password_hash' => Hash::make('client-pass'),
            'login_prefill_username' => 'test',
            'login_prefill_password' => 'client-pass',
            'repository_path' => null,
            'automation_enabled' => false,
        ];
    }

    /**
     * 專案的 client_username／client_password_hash 跟正式站改版前一樣，建立後搬成第一個客戶帳號
     * （與資料庫遷移相同的做法），專案欄位的密碼雜湊清掉。
     */
    public function configure(): static
    {
        return $this->afterCreating(function (FeedbackProject $project): void {
            if (blank($project->client_username) || blank($project->client_password_hash)) {
                return;
            }

            $project->clientAccounts()->create([
                'username' => $project->client_username,
                'name' => filled($project->client_display_name) ? $project->client_display_name : $project->client_username,
                'password_hash' => $project->client_password_hash,
            ]);
            $project->forceFill(['client_password_hash' => null])->save();
        });
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
