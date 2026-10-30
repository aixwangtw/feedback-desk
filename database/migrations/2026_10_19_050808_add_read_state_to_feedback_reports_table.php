<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 記錄開發者與客戶各自最後一次開啟單的時間，以及調整重點最後變動的時間。
     */
    public function up(): void
    {
        Schema::table('feedback_reports', function (Blueprint $table) {
            $table->timestamp('owner_last_read_at')->nullable()->after('latest_activity_at');
            $table->timestamp('client_last_read_at')->nullable()->after('owner_last_read_at');
            $table->timestamp('adjustment_updated_at')->nullable()->after('client_last_read_at');
        });

        $now = now();

        // 既有的單預設都算已讀，上線後不會整片顯示未讀。
        DB::table('feedback_reports')->update([
            'owner_last_read_at' => $now,
            'client_last_read_at' => $now,
        ]);

        // 例外：最後一則留言來自客戶、之後沒有任何其他動作，且晚於開發者最後一次調整（留言或調整附圖），
        // 把開發者已讀時間退回那次調整，讓這則留言算未讀。
        DB::table('feedback_reports')->select(['id', 'latest_activity_at'])->orderBy('id')->each(function (object $report): void {
            $lastMessage = DB::table('feedback_messages')
                ->where('feedback_report_id', $report->id)
                ->orderByDesc('id')
                ->first(['author_type', 'created_at']);

            if ($lastMessage === null || $lastMessage->author_type !== 'reporter' || $lastMessage->created_at === null) {
                return;
            }

            $lastMessageAt = Carbon::parse($lastMessage->created_at);
            if ($report->latest_activity_at !== null && Carbon::parse($report->latest_activity_at)->greaterThan($lastMessageAt)) {
                return;
            }

            $lastDeveloperAction = collect([
                DB::table('feedback_messages')
                    ->where('feedback_report_id', $report->id)
                    ->whereIn('author_type', ['owner', 'agent'])
                    ->max('created_at'),
                DB::table('feedback_attachments')
                    ->where('feedback_report_id', $report->id)
                    ->where('kind', 'adjustment')
                    ->max('created_at'),
            ])->filter()->map(fn (string $at): Carbon => Carbon::parse($at))->max();

            if ($lastDeveloperAction !== null && ! $lastMessageAt->greaterThan($lastDeveloperAction)) {
                return;
            }

            DB::table('feedback_reports')->where('id', $report->id)->update(['owner_last_read_at' => $lastDeveloperAction]);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('feedback_reports', function (Blueprint $table) {
            $table->dropColumn(['owner_last_read_at', 'client_last_read_at', 'adjustment_updated_at']);
        });
    }
};
