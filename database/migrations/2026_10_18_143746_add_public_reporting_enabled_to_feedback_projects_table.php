<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('feedback_projects', function (Blueprint $table) {
            $table->boolean('public_reporting_enabled')->default(false)->after('automation_enabled');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('feedback_projects', function (Blueprint $table) {
            $table->dropColumn('public_reporting_enabled');
        });
    }
};
