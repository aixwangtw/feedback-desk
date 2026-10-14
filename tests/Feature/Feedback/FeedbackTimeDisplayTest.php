<?php

namespace Tests\Feature\Feedback;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Blade;
use Tests\TestCase;

class FeedbackTimeDisplayTest extends TestCase
{
    public function test_absolute_time_is_shown_in_taipei_time(): void
    {
        $html = Blade::render('<x-feedback.time :at="$at" />', ['at' => Carbon::parse('2026-10-14 02:30:00', 'UTC')]);

        $this->assertStringContainsString('2026/10/14 10:30', $html);
    }

    public function test_relative_time_is_in_chinese(): void
    {
        Carbon::setTestNow('2026-10-14 06:00:00');
        $html = Blade::render('<x-feedback.time :at="$at" relative />', ['at' => Carbon::parse('2026-10-14 03:00:00', 'UTC')]);

        $this->assertStringContainsString('3小時前', str_replace(' ', '', $html));
        Carbon::setTestNow();
    }

    public function test_future_time_never_shows_from_now(): void
    {
        Carbon::setTestNow('2026-10-14 06:00:00');
        $html = Blade::render('<x-feedback.time :at="$at" relative />', ['at' => Carbon::parse('2026-10-14 07:00:00', 'UTC')]);

        $this->assertStringContainsString('剛剛', $html);
        $this->assertStringNotContainsString('from now', $html);
        Carbon::setTestNow();
    }
}
