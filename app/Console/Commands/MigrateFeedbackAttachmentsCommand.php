<?php

namespace App\Console\Commands;

use App\Models\FeedbackAttachment;
use App\Models\FeedbackMessageDraft;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Help;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Throwable;

#[Signature('feedback:migrate-attachments-to-gcs
    {--dry-run : 只列出會搬的檔案，不上傳、不改資料庫}
    {--from=local : 來源磁碟}
    {--to=gcs : 目的磁碟}')]
#[Description('把附件（留言、原始附件、待審留言）從本機磁碟搬到 GCS，逐檔比對大小與 md5，全部通過才改資料庫的 disk 欄位')]
#[Help(<<<'HELP'
  php artisan feedback:migrate-attachments-to-gcs --dry-run
  php artisan feedback:migrate-attachments-to-gcs

說明：
  - 先逐檔上傳並比對大小與 md5；任何一個檔失敗就不改資料庫（已上傳的檔留在目的磁碟，重跑會跳過已相同的檔）。
  - 全部通過後，在同一個交易裡把 feedback_attachments.disk 與待審留言附件 JSON 裡的 disk 改成目的磁碟。
  - 來源檔不會刪除。
  - 改資料庫前請先備份 feedback_attachments、feedback_message_drafts 兩張表。
HELP)]
class MigrateFeedbackAttachmentsCommand extends Command
{
    public function handle(): int
    {
        $from = (string) $this->option('from');
        $to = (string) $this->option('to');
        $dryRun = (bool) $this->option('dry-run');

        if ($from === $to) {
            $this->components->error('來源與目的磁碟相同。');

            return self::FAILURE;
        }

        /** @var array<string, int> $files path => 預期大小 */
        $files = [];
        FeedbackAttachment::query()->where('disk', $from)->get(['id', 'path', 'size'])
            ->each(function (FeedbackAttachment $attachment) use (&$files): void {
                $files[$attachment->path] = (int) $attachment->size;
            });
        $drafts = FeedbackMessageDraft::query()->whereNotNull('attachments')->get()
            ->filter(fn (FeedbackMessageDraft $draft): bool => collect($draft->attachmentList())->contains(fn (array $file): bool => $file['disk'] === $from));
        foreach ($drafts as $draft) {
            foreach ($draft->attachmentList() as $file) {
                if ($file['disk'] === $from) {
                    $files[$file['path']] = (int) ($file['size'] ?? 0);
                }
            }
        }

        $this->components->info(sprintf('要搬的檔案 %d 個（附件紀錄 %d 筆、待審留言 %d 則）。', count($files), FeedbackAttachment::where('disk', $from)->count(), $drafts->count()));
        if ($dryRun) {
            foreach ($files as $path => $size) {
                $this->line(sprintf('  %s  %s  %s', Storage::disk($from)->exists($path) ? 'OK  ' : '缺檔', number_format($size), $path));
            }
            $this->components->info('dry-run：沒有上傳、沒有改資料庫。');

            return self::SUCCESS;
        }

        $source = Storage::disk($from);
        $target = Storage::disk($to);
        $verified = 0;
        $skipped = 0;
        $failed = [];
        foreach ($files as $path => $expectedSize) {
            try {
                if (! $source->exists($path)) {
                    throw new \RuntimeException('來源檔不存在');
                }
                $sourceSize = $source->size($path);
                $sourceMd5 = $this->md5Of($source, $path);

                if ($target->exists($path) && $target->size($path) === $sourceSize && $this->md5Of($target, $path) === $sourceMd5) {
                    $skipped++;
                } else {
                    $stream = $source->readStream($path);
                    $target->writeStream($path, $stream);
                    if (is_resource($stream)) {
                        fclose($stream);
                    }
                }

                if ($target->size($path) !== $sourceSize) {
                    throw new \RuntimeException('大小不符');
                }
                if ($this->md5Of($target, $path) !== $sourceMd5) {
                    throw new \RuntimeException('md5 不符');
                }
                $verified++;
            } catch (Throwable $e) {
                $failed[$path] = $e->getMessage();
            }
        }

        $this->line(sprintf('逐檔驗證：通過 %d（其中已存在而跳過上傳 %d），失敗 %d。', $verified, $skipped, count($failed)));
        if ($failed !== []) {
            foreach ($failed as $path => $reason) {
                $this->components->error("{$path}：{$reason}");
            }
            $this->components->error('有檔案驗證失敗，資料庫沒有改。');

            return self::FAILURE;
        }

        DB::transaction(function () use ($from, $to, $drafts): void {
            $changed = FeedbackAttachment::where('disk', $from)->update(['disk' => $to]);
            $this->line("feedback_attachments 改 disk：{$changed} 筆。");
            foreach ($drafts as $draft) {
                $draft->attachments = collect($draft->attachmentList())
                    ->map(fn (array $file): array => $file['disk'] === $from ? [...$file, 'disk' => $to] : $file)
                    ->all();
                $draft->save();
            }
            $this->line("待審留言附件 JSON 改 disk：{$drafts->count()} 則。");
        });

        $this->components->info('完成。來源檔沒有刪除。');

        return self::SUCCESS;
    }

    private function md5Of(mixed $disk, string $path): string
    {
        $stream = $disk->readStream($path);
        $context = hash_init('md5');
        hash_update_stream($context, $stream);
        if (is_resource($stream)) {
            fclose($stream);
        }

        return hash_final($context);
    }
}
