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
        Schema::table('feedback_attachments', function (Blueprint $table) {
            $table->string('kind', 20)->default('feedback')->after('feedback_message_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('feedback_attachments', function (Blueprint $table) {
            $table->dropColumn('kind');
        });
    }
};
