<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 開發團隊開的單是否給客戶看（feedback:create --for-client）；既有的團隊單維持只有團隊看得到。
     */
    public function up(): void
    {
        Schema::table('feedback_reports', function (Blueprint $table): void {
            $table->boolean('shared_with_client')->default(false)->after('creator_agent');
        });
    }

    public function down(): void
    {
        Schema::table('feedback_reports', function (Blueprint $table): void {
            $table->dropColumn('shared_with_client');
        });
    }
};
