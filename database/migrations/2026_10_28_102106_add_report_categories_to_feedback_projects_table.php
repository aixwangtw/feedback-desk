<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 開單分類改成每個專案各自設定。原本整站共用的 FEEDBACK_REPORT_CATEGORIES 有值時，
     * 先複製給所有既有專案，站台行為不變；之後由專案設定或 feedback:categories 調整。
     */
    public function up(): void
    {
        Schema::table('feedback_projects', function (Blueprint $table) {
            $table->json('report_categories')->nullable()->after('public_reporting_enabled');
        });

        $legacy = array_values(array_filter((array) config('feedback.report_categories'), fn (mixed $category): bool => is_string($category) && $category !== ''));
        if ($legacy !== []) {
            DB::table('feedback_projects')->update(['report_categories' => json_encode($legacy, JSON_UNESCAPED_UNICODE)]);
        }
    }

    public function down(): void
    {
        Schema::table('feedback_projects', function (Blueprint $table) {
            $table->dropColumn('report_categories');
        });
    }
};
