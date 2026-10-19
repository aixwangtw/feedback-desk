<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * 多人、多個 AI 接手同一批單：團隊與客戶帳號各自的 API token（給 MCP 用）、每個動作記錄帳號與 AI 工具、
 * 認領與交接紀錄、最近動態。只新增資料表與欄位，既有資料不動。
 */
return new class extends Migration
{
    /**
     * SQLite 加外鍵欄位時會重建資料表；在交易裡關不掉外鍵檢查，重建時舊表被刪會連帶刪掉留言等子資料。
     */
    public $withinTransaction = false;

    public function up(): void
    {
        if (! Schema::hasTable('feedback_api_tokens')) {
            Schema::create('feedback_api_tokens', function (Blueprint $table): void {
                $table->id();
                // 團隊個人帳號或客戶帳號，兩者恰好一個。
                $table->foreignId('feedback_developer_id')->nullable()->constrained()->cascadeOnDelete();
                $table->foreignId('feedback_client_account_id')->nullable()->constrained()->cascadeOnDelete();
                $table->string('name', 100);
                // 建立 token 時指定的 AI 工具名稱；沒指定時用 MCP 用戶端連線時自報的名稱（mcp_client）。
                $table->string('agent', 40)->nullable();
                $table->string('mcp_client', 40)->nullable();
                $table->string('token_hash', 64)->unique();
                $table->timestamp('last_used_at')->nullable();
                $table->timestamp('expires_at')->nullable();
                $table->timestamps();
            });
        }

        if (! Schema::hasColumn('feedback_reports', 'creator_agent')) {
            Schema::table('feedback_reports', function (Blueprint $table): void {
                // 用哪個 AI 工具開的單；NULL 是人在網頁上開的。
                $table->string('creator_agent', 40)->nullable()->after('creator_client_account_id');
                // 誰在處理（團隊個人帳號）；認領不是鎖，別人仍看得到。
                $table->foreignId('claimed_by_developer_id')->nullable()->after('creator_agent')
                    ->constrained('feedback_developers')->nullOnDelete();
                $table->string('claimed_agent', 40)->nullable()->after('claimed_by_developer_id');
                $table->timestamp('claimed_at', 6)->nullable()->after('claimed_agent');
            });
        }

        if (! Schema::hasColumn('feedback_messages', 'author_agent')) {
            Schema::table('feedback_messages', function (Blueprint $table): void {
                $table->string('author_agent', 40)->nullable()->after('author_developer_id');
            });
        }

        // 工作中斷時留給下一個人或 AI 的進度筆記，只有團隊看得到。
        if (! Schema::hasTable('feedback_handoff_notes')) {
            Schema::create('feedback_handoff_notes', function (Blueprint $table): void {
                $table->id();
                $table->foreignId('feedback_report_id')->constrained()->cascadeOnDelete();
                $table->foreignId('feedback_developer_id')->nullable()->constrained()->nullOnDelete();
                $table->string('author_name', 100);
                $table->string('agent', 40)->nullable();
                $table->text('body');
                $table->timestamps();

                $table->index(['feedback_report_id', 'id']);
            });
        }

        // 誰對這張單做了什麼：created、message、adjustment、status、claim、release、takeover、handoff。
        if (! Schema::hasTable('feedback_report_events')) {
            Schema::create('feedback_report_events', function (Blueprint $table): void {
                $table->id();
                $table->foreignId('feedback_report_id')->constrained()->cascadeOnDelete();
                $table->string('kind', 20);
                $table->foreignId('feedback_developer_id')->nullable()->constrained()->nullOnDelete();
                $table->foreignId('feedback_client_account_id')->nullable()->constrained()->nullOnDelete();
                $table->string('actor_name', 100);
                $table->string('agent', 40)->nullable();
                $table->string('detail', 200)->nullable();
                $table->timestamps();

                $table->index(['feedback_report_id', 'id']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('feedback_report_events');
        Schema::dropIfExists('feedback_handoff_notes');

        Schema::table('feedback_messages', function (Blueprint $table): void {
            $table->dropColumn('author_agent');
        });
        Schema::table('feedback_reports', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('claimed_by_developer_id');
            $table->dropColumn(['creator_agent', 'claimed_agent', 'claimed_at']);
        });

        Schema::dropIfExists('feedback_api_tokens');
    }
};
