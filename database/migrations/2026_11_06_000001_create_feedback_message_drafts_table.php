<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 待審留言（草稿）：團隊或排程先寫好，團隊在單頁審過按「送出」才變成正式留言。
     * 放在獨立的表，客戶端讀留言的查詢完全碰不到；附圖先記在 attachments（JSON），送出時才建立 feedback_attachments。
     */
    public function up(): void
    {
        Schema::create('feedback_message_drafts', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('feedback_report_id')->constrained()->cascadeOnDelete();
            $table->foreignId('replaces_message_id')->nullable()->constrained('feedback_messages')->cascadeOnDelete();
            $table->foreignId('author_developer_id')->nullable()->constrained('feedback_developers')->nullOnDelete();
            $table->string('author_name', 100);
            $table->string('author_agent', 40)->nullable();
            $table->text('body');
            $table->json('attachments')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('feedback_message_drafts');
    }
};
