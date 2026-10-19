<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * 客戶改成每人一個帳號，並讓本人自己設定密碼。
 *
 * 既有站可直接執行：只新增資料表與欄位，把專案原本那一組客戶帳密原封不動（帳號、bcrypt 雜湊）
 * 搬成第一個客戶帳號，所以老師用原本的帳密照樣能登入。每一步都先檢查是否已做過，
 * MySQL 的 DDL 不在交易內，中途失敗後可以直接重跑。
 */
return new class extends Migration
{
    /**
     * SQLite 加外鍵欄位時會重建資料表；在交易裡關不掉外鍵檢查，重建時舊表被刪會連帶刪掉留言等子資料。
     */
    public $withinTransaction = false;

    public function up(): void
    {
        if (! Schema::hasColumn('feedback_developers', 'password_set_by_self')) {
            Schema::table('feedback_developers', function (Blueprint $table): void {
                // 1：本人在「我的帳號」設定的密碼，其他人不能用指令重設；只有主機管理者能 recover。
                $table->boolean('password_set_by_self')->default(false)->after('password_hash');
            });
        }

        if (! Schema::hasTable('feedback_client_accounts')) {
            Schema::create('feedback_client_accounts', function (Blueprint $table): void {
                $table->id();
                $table->foreignId('feedback_project_id')->constrained()->cascadeOnDelete();
                $table->string('username', 50);
                $table->string('name', 100);
                $table->string('password_hash');
                $table->boolean('password_set_by_self')->default(false);
                $table->timestamp('disabled_at')->nullable();
                $table->timestamps();

                $table->unique(['feedback_project_id', 'username']);
                $table->index('username');
            });
        }

        // 專案原本那一組客戶帳密 → 第一個客戶帳號（同帳號、同密碼雜湊）。
        $now = now();
        DB::table('feedback_projects')
            ->whereNotNull('client_username')->where('client_username', '<>', '')
            ->whereNotNull('client_password_hash')->where('client_password_hash', '<>', '')
            ->orderBy('id')
            ->get(['id', 'client_username', 'client_display_name', 'client_password_hash'])
            ->each(function (object $project) use ($now): void {
                $exists = DB::table('feedback_client_accounts')
                    ->where('feedback_project_id', $project->id)
                    ->where('username', $project->client_username)
                    ->exists();
                if ($exists) {
                    return;
                }

                $displayName = trim((string) $project->client_display_name);
                DB::table('feedback_client_accounts')->insert([
                    'feedback_project_id' => $project->id,
                    'username' => $project->client_username,
                    'name' => mb_substr($displayName !== '' ? $displayName : $project->client_username, 0, 100),
                    'password_hash' => $project->client_password_hash,
                    'password_set_by_self' => false,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            });

        // 誰寫的：NULL 表示客戶專屬連結（沒有帳號）或舊資料。
        if (! Schema::hasColumn('feedback_reports', 'creator_client_account_id')) {
            Schema::table('feedback_reports', function (Blueprint $table): void {
                $table->foreignId('creator_client_account_id')->nullable()->after('creator_developer_id')
                    ->constrained('feedback_client_accounts')->nullOnDelete();
            });
        }
        if (! Schema::hasColumn('feedback_messages', 'author_client_account_id')) {
            Schema::table('feedback_messages', function (Blueprint $table): void {
                $table->foreignId('author_client_account_id')->nullable()->after('author_name')
                    ->constrained('feedback_client_accounts')->nullOnDelete();
                $table->foreignId('author_developer_id')->nullable()->after('author_client_account_id')
                    ->constrained('feedback_developers')->nullOnDelete();
            });
        }
        if (! Schema::hasColumn('feedback_attachments', 'uploader_client_account_id')) {
            Schema::table('feedback_attachments', function (Blueprint $table): void {
                $table->foreignId('uploader_client_account_id')->nullable()->after('kind')
                    ->constrained('feedback_client_accounts')->nullOnDelete();
                $table->foreignId('uploader_developer_id')->nullable()->after('uploader_client_account_id')
                    ->constrained('feedback_developers')->nullOnDelete();
            });
        }

        // 既有的客戶端資料歸給搬過來的帳號（第一次執行時每個專案最多一個；只補還沒歸屬的資料）。
        $accounts = DB::table('feedback_client_accounts')->pluck('id', 'feedback_project_id');
        foreach ($accounts as $projectId => $accountId) {
            DB::table('feedback_reports')
                ->where('feedback_project_id', $projectId)
                ->where('creator_type', 'client')
                ->whereNull('creator_client_account_id')
                ->update(['creator_client_account_id' => $accountId]);

            $clientSideReportIds = DB::table('feedback_reports')
                ->where('feedback_project_id', $projectId)
                ->where('creator_type', '<>', 'public')
                ->pluck('id');

            foreach ($clientSideReportIds->chunk(500) as $reportIds) {
                DB::table('feedback_messages')
                    ->whereIn('feedback_report_id', $reportIds->all())
                    ->where('author_type', 'reporter')
                    ->whereNull('author_client_account_id')
                    ->update(['author_client_account_id' => $accountId]);
            }

            $clientCreatedReportIds = DB::table('feedback_reports')
                ->where('feedback_project_id', $projectId)
                ->where('creator_type', 'client')
                ->pluck('id');

            foreach ($clientCreatedReportIds->chunk(500) as $reportIds) {
                DB::table('feedback_attachments')
                    ->whereIn('feedback_report_id', $reportIds->all())
                    ->where('kind', 'feedback')
                    ->whereNull('feedback_message_id')
                    ->whereNull('uploader_client_account_id')
                    ->update(['uploader_client_account_id' => $accountId]);
            }
        }

        DB::table('feedback_messages')
            ->whereNotNull('author_client_account_id')
            ->orderBy('id')
            ->get(['id', 'author_client_account_id'])
            ->each(fn (object $message) => DB::table('feedback_attachments')
                ->where('feedback_message_id', $message->id)
                ->whereNull('uploader_client_account_id')
                ->update(['uploader_client_account_id' => $message->author_client_account_id]));

        // 每個客戶帳號各自的已讀時間；客戶專屬連結（沒有帳號）照舊用 feedback_reports.client_last_read_at。
        if (! Schema::hasTable('feedback_client_reads')) {
            Schema::create('feedback_client_reads', function (Blueprint $table): void {
                $table->foreignId('feedback_client_account_id')->constrained()->cascadeOnDelete();
                $table->foreignId('feedback_report_id')->constrained()->cascadeOnDelete();
                $table->timestamp('last_read_at');

                $table->primary(['feedback_client_account_id', 'feedback_report_id']);
                $table->index('feedback_report_id');
            });
        }

        // 搬過來的帳號從共用的客戶已讀狀態開始，上線後未讀數不變。
        foreach ($accounts as $projectId => $accountId) {
            DB::table('feedback_reports')
                ->where('feedback_project_id', $projectId)
                ->whereNotNull('client_last_read_at')
                ->orderBy('id')
                ->get(['id', 'client_last_read_at'])
                ->each(function (object $report) use ($accountId): void {
                    DB::table('feedback_client_reads')->insertOrIgnore([
                        'feedback_client_account_id' => $accountId,
                        'feedback_report_id' => $report->id,
                        'last_read_at' => $report->client_last_read_at,
                    ]);
                });
        }

        // 密碼改存在 feedback_client_accounts；清掉舊的那份，避免本人改密碼後舊密碼還留在別處。
        DB::table('feedback_projects')
            ->whereIn('id', $accounts->keys()->all())
            ->update(['client_password_hash' => null]);
    }

    public function down(): void
    {
        // 把每個專案最早的客戶帳號放回專案欄位，舊版程式才能登入。
        if (Schema::hasTable('feedback_client_accounts')) {
            DB::table('feedback_client_accounts')
                ->orderBy('id')
                ->get(['feedback_project_id', 'username', 'password_hash'])
                ->unique('feedback_project_id')
                ->each(fn (object $account) => DB::table('feedback_projects')
                    ->where('id', $account->feedback_project_id)
                    ->update(['client_username' => $account->username, 'client_password_hash' => $account->password_hash]));
        }

        Schema::dropIfExists('feedback_client_reads');

        Schema::table('feedback_attachments', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('uploader_developer_id');
            $table->dropConstrainedForeignId('uploader_client_account_id');
        });
        Schema::table('feedback_messages', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('author_developer_id');
            $table->dropConstrainedForeignId('author_client_account_id');
        });
        Schema::table('feedback_reports', function (Blueprint $table): void {
            $table->dropConstrainedForeignId('creator_client_account_id');
        });

        Schema::dropIfExists('feedback_client_accounts');

        Schema::table('feedback_developers', function (Blueprint $table): void {
            $table->dropColumn('password_set_by_self');
        });
    }
};
