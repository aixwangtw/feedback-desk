<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 開單分類（選項由 FEEDBACK_REPORT_CATEGORIES 設定；沒設定的站維持空值）。
     */
    public function up(): void
    {
        Schema::table('feedback_reports', function (Blueprint $table): void {
            $table->string('category', 50)->nullable()->after('reporter_name');
        });
    }

    public function down(): void
    {
        Schema::table('feedback_reports', function (Blueprint $table): void {
            $table->dropColumn('category');
        });
    }
};
