<?php

namespace Database\Seeders;

use App\Models\FeedbackDeveloper;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class FeedbackDeveloperSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        $developers = [
            [
                'username' => 'nick',
                'name' => 'Nick',
                'password' => '123456',
            ],
            [
                'username' => 'alex',
                'name' => 'Alex',
                'password' => '123456',
            ],
        ];

        foreach ($developers as $developer) {
            FeedbackDeveloper::updateOrCreate(
                ['username' => $developer['username']],
                [
                    'name' => $developer['name'],
                    'password_hash' => Hash::make($developer['password']),
                    'password_set_by_self' => false,
                ]
            );
        }
    }
}
