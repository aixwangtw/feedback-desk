<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 留言「收回」用軟刪除：畫面與 API 都當它不存在（沒有任何痕跡），資料庫裡仍救得回來。
     */
    public function up(): void
    {
        Schema::table('feedback_messages', function (Blueprint $table): void {
            $table->softDeletes();
        });
    }

    public function down(): void
    {
        Schema::table('feedback_messages', function (Blueprint $table): void {
            $table->dropSoftDeletes();
        });
    }
};
