<?php

namespace Tests\Feature\Feedback;

use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * 正式站已有資料時的遷移：專案原本那一組客戶帳密原封不動搬成第一個客戶帳號，既有的單、留言、附件、已讀歸給它。
 */
class FeedbackAccountsMigrationTest extends TestCase
{
    use DatabaseMigrations;

    public function test_existing_client_logins_and_data_move_to_the_first_client_account(): void
    {
        Artisan::call('migrate:rollback', ['--step' => 5, '--force' => true]);

        $hash = Hash::make('teacher-original-password');
        $now = '2026-10-19 08:00:00';
        $projectId = DB::table('feedback_projects')->insertGetId([
            'name' => '題庫', 'slug' => 'question-bank', 'client_display_name' => '陳老師', 'owner_token_hash' => str_repeat('a', 64),
            'client_username' => 'teacher', 'client_password_hash' => $hash, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $noAccountProjectId = DB::table('feedback_projects')->insertGetId([
            'name' => '公開', 'slug' => 'public', 'owner_token_hash' => str_repeat('b', 64), 'created_at' => $now, 'updated_at' => $now,
        ]);
        $report = fn (int $project, string $type, ?string $readAt) => DB::table('feedback_reports')->insertGetId([
            'feedback_project_id' => $project, 'public_id' => (string) str()->uuid(), 'reporter_token_hash' => str_repeat('c', 64),
            'creator_type' => $type, 'title' => $type, 'description' => 'd', 'status' => 'new', 'latest_activity_at' => $now,
            'client_last_read_at' => $readAt, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $clientReport = $report($projectId, 'client', '2026-10-19 09:00:00');
        $developerReport = $report($projectId, 'developer', null);
        $publicReport = $report($noAccountProjectId, 'public', $now);

        $message = fn (int $reportId, string $type) => DB::table('feedback_messages')->insertGetId([
            'feedback_report_id' => $reportId, 'author_type' => $type, 'author_name' => '老師', 'body' => 'b', 'created_at' => $now, 'updated_at' => $now,
        ]);
        $clientMessage = $message($clientReport, 'reporter');
        $ownerMessage = $message($clientReport, 'owner');
        $publicMessage = $message($publicReport, 'reporter');

        $attachment = fn (int $reportId, ?int $messageId, string $kind) => DB::table('feedback_attachments')->insertGetId([
            'feedback_report_id' => $reportId, 'feedback_message_id' => $messageId, 'kind' => $kind, 'disk' => 'local', 'path' => 'p',
            'original_name' => 'a.png', 'mime_type' => 'image/png', 'size' => 1, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $reportImage = $attachment($clientReport, null, 'feedback');
        $messageImage = $attachment($clientReport, $clientMessage, 'feedback');
        $adjustmentImage = $attachment($clientReport, null, 'adjustment');

        Artisan::call('migrate', ['--force' => true]);

        $account = DB::table('feedback_client_accounts')->sole();
        $this->assertSame($projectId, (int) $account->feedback_project_id);
        $this->assertSame('teacher', $account->username);
        $this->assertSame('陳老師', $account->name);
        $this->assertSame($hash, $account->password_hash);
        $this->assertTrue(Hash::check('teacher-original-password', $account->password_hash));
        $this->assertSame(0, (int) $account->password_set_by_self);
        $this->assertNull(DB::table('feedback_projects')->where('id', $projectId)->value('client_password_hash'));
        $this->assertSame('teacher', DB::table('feedback_projects')->where('id', $projectId)->value('client_username'));

        $this->assertSame($account->id, DB::table('feedback_reports')->where('id', $clientReport)->value('creator_client_account_id'));
        $this->assertNull(DB::table('feedback_reports')->where('id', $developerReport)->value('creator_client_account_id'));
        $this->assertSame($account->id, DB::table('feedback_messages')->where('id', $clientMessage)->value('author_client_account_id'));
        $this->assertNull(DB::table('feedback_messages')->where('id', $ownerMessage)->value('author_client_account_id'));
        $this->assertNull(DB::table('feedback_messages')->where('id', $publicMessage)->value('author_client_account_id'));
        $this->assertSame($account->id, DB::table('feedback_attachments')->where('id', $reportImage)->value('uploader_client_account_id'));
        $this->assertSame($account->id, DB::table('feedback_attachments')->where('id', $messageImage)->value('uploader_client_account_id'));
        $this->assertNull(DB::table('feedback_attachments')->where('id', $adjustmentImage)->value('uploader_client_account_id'));

        $read = DB::table('feedback_client_reads')->sole();
        $this->assertSame($clientReport, (int) $read->feedback_report_id);
        $this->assertStringStartsWith('2026-10-19 09:00:00', (string) $read->last_read_at);

        // 實際用原本的帳密登入。
        $this->post('/p/question-bank/login', ['username' => 'teacher', 'password' => 'teacher-original-password'])
            ->assertRedirect('/p/question-bank');

        // 退回舊版時帳密放回專案欄位。
        Artisan::call('migrate:rollback', ['--step' => 5, '--force' => true]);
        $this->assertSame($hash, DB::table('feedback_projects')->where('id', $projectId)->value('client_password_hash'));
    }
}
