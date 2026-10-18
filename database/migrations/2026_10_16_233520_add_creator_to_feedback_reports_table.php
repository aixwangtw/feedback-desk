<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('feedback_projects', function (Blueprint $table) {
            $table->string('client_display_name', 50)->nullable()->after('slug');
        });

        Schema::table('feedback_reports', function (Blueprint $table) {
            $table->string('creator_type', 20)->default('client')->after('reporter_name')->index();
            $table->foreignId('creator_developer_id')->nullable()->after('creator_type')
                ->constrained('feedback_developers')->nullOnDelete();
        });

        // 既有的單全部都是老師建立的。
        DB::table('feedback_reports')->update(['creator_type' => 'client', 'creator_developer_id' => null]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('feedback_reports', function (Blueprint $table) {
            $table->dropConstrainedForeignId('creator_developer_id');
            $table->dropIndex(['creator_type']);
            $table->dropColumn('creator_type');
        });

        Schema::table('feedback_projects', function (Blueprint $table) {
            $table->dropColumn('client_display_name');
        });
    }
};
