<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('feedback_projects', function (Blueprint $table): void {
            $table->string('client_username', 50)->nullable();
            $table->string('client_password_hash')->nullable();
            $table->string('login_prefill_username', 50)->nullable();
            $table->string('login_prefill_password', 200)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('feedback_projects', function (Blueprint $table): void {
            $table->dropColumn(['client_username', 'client_password_hash', 'login_prefill_username', 'login_prefill_password']);
        });
    }
};
