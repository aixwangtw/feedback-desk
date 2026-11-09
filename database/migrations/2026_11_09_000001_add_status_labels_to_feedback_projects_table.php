<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 每個看板可自訂狀態顯示名稱（{"new":"…","needs_input":"…","completed":"…"}）；
     * 沒設定（null）的看板沿用全站 config feedback.status_labels。
     */
    public function up(): void
    {
        Schema::table('feedback_projects', function (Blueprint $table) {
            $table->json('status_labels')->nullable()->after('report_categories');
        });
    }

    public function down(): void
    {
        Schema::table('feedback_projects', function (Blueprint $table) {
            $table->dropColumn('status_labels');
        });
    }
};
