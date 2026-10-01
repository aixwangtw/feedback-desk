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
            $table->string('client_token_hash', 64)->nullable()->after('owner_token_hash');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('feedback_projects', function (Blueprint $table) {
            $table->dropColumn('client_token_hash');
        });
    }
};
