<?php

use League\Flysystem\GoogleCloudStorage\UniformBucketLevelAccessVisibility;

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same driver. Examples for
    | most supported storage drivers are configured here for reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
            'report' => false,
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => rtrim(env('APP_URL', 'http://localhost'), '/').'/storage',
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],

        's3' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET'),
            'url' => env('AWS_URL'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'throw' => false,
            'report' => false,
        ],

        /*
         * 回饋系統附件用的 Google Cloud Storage（FEEDBACK_DISK=gcs）。專案的組織政策禁止建立服務帳戶金鑰，
         * 所以不用金鑰檔：主機的預設身分（Metadata 伺服器）去「模擬」各站自己的服務帳戶
         * （GOOGLE_CLOUD_IMPERSONATE_SERVICE_ACCOUNT），該帳戶只能讀寫 bucket 內自己的前綴（feedback/ 或 liff/）。
         * 沒設模擬帳戶時就走預設身分。
         */
        'gcs' => [
            'driver' => 'gcs-impersonated',
            'project_id' => env('GOOGLE_CLOUD_PROJECT_ID'),
            'bucket' => env('GOOGLE_CLOUD_STORAGE_BUCKET'),
            'path_prefix' => env('GOOGLE_CLOUD_STORAGE_PATH_PREFIX', ''),
            'impersonate_service_account' => env('GOOGLE_CLOUD_IMPERSONATE_SERVICE_ACCOUNT'),
            'visibility_handler' => UniformBucketLevelAccessVisibility::class,
            'throw' => true,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
