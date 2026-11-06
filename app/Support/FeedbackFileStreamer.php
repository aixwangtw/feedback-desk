<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use League\Flysystem\Local\LocalFilesystemAdapter;
use Spatie\GoogleCloudStorage\GoogleCloudStorageAdapter;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * 附件一律經由 Laravel 路由串流（權限檢查在呼叫端），不給磁碟的公開網址。
 * 本機磁碟的影片交給 BinaryFileResponse 處理 Range；其他磁碟（例如 GCS）的影片在這裡自己回 206。
 */
class FeedbackFileStreamer
{
    public function respond(Request $request, string $diskName, string $path, string $mimeType, string $originalName, bool $isVideo): Response
    {
        $disk = Storage::disk($diskName);
        $headers = [
            'Content-Type' => $mimeType,
            'Content-Disposition' => 'inline',
            'X-Content-Type-Options' => 'nosniff',
        ];

        if ($isVideo && $disk->getAdapter() instanceof LocalFilesystemAdapter) {
            return response()->file($disk->path($path), $headers);
        }

        if (! $isVideo) {
            return $disk->response($path, $originalName, $headers);
        }

        $size = $disk->size($path);
        $headers['Accept-Ranges'] = 'bytes';
        $range = $this->parseRange((string) $request->header('Range'), $size);

        if ($range === false) {
            return response('', 416, $headers + ['Content-Range' => "bytes */{$size}"]);
        }

        if ($range === null) {
            return $disk->response($path, $originalName, $headers);
        }

        [$start, $end] = $range;
        $length = $end - $start + 1;

        return new StreamedResponse(function () use ($disk, $diskName, $path, $start, $end, $length): void {
            $stream = $this->openRange($disk, $diskName, $path, $start, $end);
            $remaining = $length;
            while ($remaining > 0 && ! feof($stream)) {
                $chunk = fread($stream, min(1024 * 1024, $remaining));
                if ($chunk === false || $chunk === '') {
                    break;
                }
                echo $chunk;
                $remaining -= strlen($chunk);
                flush();
            }
            fclose($stream);
        }, 206, $headers + [
            'Content-Range' => "bytes {$start}-{$end}/{$size}",
            'Content-Length' => (string) $length,
        ]);
    }

    /**
     * 只處理單一區間。回傳 [起, 迄]；沒有 Range 或格式不支援（多區間）回 null；超出範圍回 false（416）。
     *
     * @return array{0: int, 1: int}|false|null
     */
    private function parseRange(string $header, int $size): array|false|null
    {
        if ($header === '' || ! str_starts_with($header, 'bytes=') || str_contains($header, ',')) {
            return null;
        }
        if (! preg_match('/^bytes=(\d*)-(\d*)$/', trim($header), $m) || ($m[1] === '' && $m[2] === '')) {
            return null;
        }

        if ($m[1] === '') {
            $suffix = (int) $m[2];
            if ($suffix <= 0 || $size === 0) {
                return false;
            }

            return [max(0, $size - $suffix), $size - 1];
        }

        $start = (int) $m[1];
        $end = $m[2] === '' ? $size - 1 : min((int) $m[2], $size - 1);
        if ($start >= $size || $start > $end) {
            return false;
        }

        return [$start, $end];
    }

    /**
     * @return resource
     */
    private function openRange(mixed $disk, string $diskName, string $path, int $start, int $end)
    {
        if ($disk instanceof GoogleCloudStorageAdapter) {
            $config = (array) config("filesystems.disks.{$diskName}");
            $object = $disk->getClient()
                ->bucket((string) $config['bucket'])
                ->object(trim((string) ($config['path_prefix'] ?? ''), '/') === '' ? $path : trim((string) $config['path_prefix'], '/').'/'.$path);
            $stream = $object->downloadAsStream(['restOptions' => ['headers' => ['Range' => "bytes={$start}-{$end}"]]])->detach();
            if (is_resource($stream)) {
                return $stream;
            }
        }

        $stream = $disk->readStream($path);
        $seekable = (bool) (stream_get_meta_data($stream)['seekable'] ?? false);
        if ($start > 0 && $seekable) {
            fseek($stream, $start);
        } elseif ($start > 0) {
            stream_copy_to_stream($stream, fopen('php://memory', 'w'), $start);
        }

        return $stream;
    }
}
