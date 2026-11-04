<?php

namespace App\Console\Commands\Concerns;

use Illuminate\Http\UploadedFile;

/**
 * 指令附圖的共用檢查，規則與網頁上傳相同：jpg／png／webp、每張 10 MB 內、一次最多 5 張。
 * 原檔只會被複製到私有儲存，不會移動或刪除。
 */
trait ValidatesFeedbackImageFiles
{
    protected const MAX_ATTACHED_IMAGES = 5;

    protected const MAX_ATTACHED_IMAGE_BYTES = 10 * 1024 * 1024;

    /** @var list<string> */
    protected const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    /**
     * 檢查全部路徑；任何一張不合格就輸出原因並回傳 null（一張都不收）。
     *
     * @param  list<mixed>  $paths
     * @return list<UploadedFile>|null
     */
    protected function validatedImageFiles(array $paths): ?array
    {
        $paths = array_values(array_filter($paths, fn ($path) => is_string($path) && $path !== ''));
        if (count($paths) > self::MAX_ATTACHED_IMAGES) {
            $this->components->error('一次最多附 '.self::MAX_ATTACHED_IMAGES.' 張圖。');

            return null;
        }

        $images = [];
        foreach ($paths as $path) {
            $image = $this->validatedImageFile($path);
            if ($image === null) {
                return null;
            }
            $images[] = $image;
        }

        return $images;
    }

    private function validatedImageFile(string $path): ?UploadedFile
    {
        if (! is_file($path) || ! is_readable($path)) {
            $this->components->error("找不到或無法讀取圖片：{$path}");

            return null;
        }

        $mime = mime_content_type($path) ?: '';
        if (! in_array($mime, self::ALLOWED_IMAGE_MIME_TYPES, true) || @getimagesize($path) === false) {
            $this->components->error("只接受 jpg／png／webp 圖片（PDF 請先轉成圖片）：{$path}");

            return null;
        }

        if (filesize($path) > self::MAX_ATTACHED_IMAGE_BYTES) {
            $this->components->error("圖片超過 10 MB：{$path}");

            return null;
        }

        return new UploadedFile($path, basename($path), $mime, null, true);
    }
}
