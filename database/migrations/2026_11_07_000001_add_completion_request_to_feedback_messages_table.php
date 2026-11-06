<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 「請老師確認完成」的留言：開發團隊按「完成」只會發出這種確認留言，留言上附「通過」按鈕，
     * 單要等老師按「通過」才變成已完成。既有留言一律不是確認留言。
     */
    public function up(): void
    {
        Schema::table('feedback_messages', function (Blueprint $table): void {
            $table->boolean('is_completion_request')->default(false)->after('body');
        });
    }

    public function down(): void
    {
        Schema::table('feedback_messages', function (Blueprint $table): void {
            $table->dropColumn('is_completion_request');
        });
    }
};
