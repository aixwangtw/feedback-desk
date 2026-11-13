<?php

namespace App\Console\Commands\Concerns;

use App\Support\FeedbackAttachmentRules;
use Illuminate\Http\UploadedFile;

/**
 * 指令附件的共用檢查，規則與網頁上傳相同（FeedbackAttachmentRules）：jpg／png／webp 每張 10 MB 內、一次最多 5 個；
 * 留言與待審留言（allowVideo）另收影片（mp4、mov、webm），每支 100 MB 內。
 * 原檔只會被複製到私有儲存，不會移動或刪除。
 */
trait ValidatesFeedbackImageFiles
{
    /**
     * 檢查全部路徑；任何一張不合格就輸出原因並回傳 null（一張都不收）。
     *
     * @param  list<mixed>  $paths
     * @return list<UploadedFile>|null
     */
    protected function validatedImageFiles(array $paths, bool $allowVideo = false): ?array
    {
        $paths = array_values(array_filter($paths, fn ($path) => is_string($path) && $path !== ''));
        if (count($paths) > FeedbackAttachmentRules::MAX_FILES) {
            $this->components->error('一次最多附 '.FeedbackAttachmentRules::MAX_FILES.' 個檔案。');

            return null;
        }

        $images = [];
        foreach ($paths as $path) {
            $image = $this->validatedImageFile($path, $allowVideo);
            if ($image === null) {
                return null;
            }
            $images[] = $image;
        }

        return $images;
    }

    private function validatedImageFile(string $path, bool $allowVideo): ?UploadedFile
    {
        if (! is_file($path) || ! is_readable($path)) {
            $this->components->error("找不到或無法讀取圖片：{$path}");

            return null;
        }

        $mime = mime_content_type($path) ?: '';
        if ($allowVideo && FeedbackAttachmentRules::isVideoMime($mime)) {
            if (filesize($path) > FeedbackAttachmentRules::MAX_VIDEO_BYTES) {
                $this->components->error('影片超過 '.FeedbackAttachmentRules::maxVideoMegabytes()." MB：{$path}");

                return null;
            }

            return new UploadedFile($path, basename($path), $mime, null, true);
        }

        if (! in_array($mime, FeedbackAttachmentRules::IMAGE_MIME_TYPES, true) || @getimagesize($path) === false) {
            $this->components->error($allowVideo
                ? "只接受 jpg／png／webp 圖片或 mp4、mov、webm 影片（PDF 請先轉成圖片）：{$path}"
                : "只接受 jpg／png／webp 圖片（PDF 請先轉成圖片）：{$path}");

            return null;
        }

        if (filesize($path) > FeedbackAttachmentRules::MAX_IMAGE_BYTES) {
            $this->components->error('圖片超過 '.FeedbackAttachmentRules::maxImageMegabytes()." MB：{$path}");

            return null;
        }

        return new UploadedFile($path, basename($path), $mime, null, true);
    }
}
