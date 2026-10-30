<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 排程（雲端例行巡檢）專用的 API token 與寫入操作紀錄。token 只存 SHA-256 雜湊，可撤銷；
 * 每個 token 代表一個團隊個人帳號。只新增資料表，既有資料不動。
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('feedback_patrol_tokens')) {
            Schema::create('feedback_patrol_tokens', function (Blueprint $table): void {
                $table->id();
                $table->foreignId('feedback_developer_id')->constrained()->cascadeOnDelete();
                $table->string('name', 100);
                $table->string('token_hash', 64)->unique();
                $table->timestamp('last_used_at')->nullable();
                $table->timestamp('revoked_at')->nullable();
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('feedback_patrol_logs')) {
            Schema::create('feedback_patrol_logs', function (Blueprint $table): void {
                $table->id();
                $table->foreignId('feedback_patrol_token_id')->constrained()->cascadeOnDelete();
                $table->string('action', 40);
                $table->string('project_slug', 100)->nullable();
                $table->string('report_public_id', 64)->nullable();
                $table->boolean('succeeded');
                $table->json('detail')->nullable();
                $table->string('ip', 45)->nullable();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('feedback_patrol_logs');
        Schema::dropIfExists('feedback_patrol_tokens');
    }
};
