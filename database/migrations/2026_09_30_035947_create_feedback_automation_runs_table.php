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
        Schema::create('feedback_automation_runs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('feedback_report_id')->constrained()->cascadeOnDelete();
            $table->string('status')->default('queued')->index();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->integer('exit_code')->nullable();
            $table->text('summary')->nullable();
            $table->json('result')->nullable();
            $table->string('trace_path')->nullable();
            $table->timestamps();

            $table->index(['feedback_report_id', 'created_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('feedback_automation_runs');
    }
};
