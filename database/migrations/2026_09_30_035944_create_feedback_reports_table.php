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
        Schema::create('feedback_reports', function (Blueprint $table) {
            $table->id();
            $table->foreignId('feedback_project_id')->constrained()->cascadeOnDelete();
            $table->uuid('public_id')->unique();
            $table->string('reporter_token_hash', 64);
            $table->string('reporter_name')->nullable();
            $table->string('title');
            $table->text('description');
            $table->text('page_url')->nullable();
            $table->string('status')->default('new')->index();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('latest_activity_at')->index();
            $table->timestamps();

            $table->index(
                ['feedback_project_id', 'status', 'latest_activity_at'],
                'feedback_reports_project_status_activity_idx',
            );
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('feedback_reports');
    }
};
