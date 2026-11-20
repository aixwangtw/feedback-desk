<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 重複的單合併進另一張後，記下合併到哪一張（合併的單同時設 client_deleted_at 隱藏）。
     */
    public function up(): void
    {
        Schema::table('feedback_reports', function (Blueprint $table) {
            $table->foreignId('merged_into_report_id')->nullable()->after('client_deleted_at')
                ->constrained('feedback_reports')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('feedback_reports', function (Blueprint $table) {
            $table->dropConstrainedForeignId('merged_into_report_id');
        });
    }
};
