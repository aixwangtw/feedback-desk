<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * The in_progress and failed report statuses no longer exist; fold any leftovers back into new.
     */
    public function up(): void
    {
        DB::table('feedback_reports')
            ->whereIn('status', ['in_progress', 'failed'])
            ->update(['status' => 'new']);
    }

    public function down(): void
    {
        //
    }
};
