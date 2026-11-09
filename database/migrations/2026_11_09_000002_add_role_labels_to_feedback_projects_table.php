<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 說明文字裡的角色稱呼（客戶端、開發者端）可每個看板各自設定；沒設定（null）沿用全站 config feedback.labels。
     * 與 client_display_name（開發者端顯示的客戶名稱，例如「陳老師」）分開，避免改動既有看板的文字。
     */
    public function up(): void
    {
        Schema::table('feedback_projects', function (Blueprint $table) {
            $table->string('client_role_label', 50)->nullable()->after('status_labels');
            $table->string('owner_role_label', 50)->nullable()->after('client_role_label');
        });
    }

    public function down(): void
    {
        Schema::table('feedback_projects', function (Blueprint $table) {
            $table->dropColumn(['client_role_label', 'owner_role_label']);
        });
    }
};
