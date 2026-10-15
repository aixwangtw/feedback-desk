<?php

return [
    'domain' => env('FEEDBACK_DOMAIN'),

    'disk' => env('FEEDBACK_DISK', 'local'),

    /*
     * Shared sign-in accounts. Only bcrypt hashes are stored; reset them with
     * `php artisan feedback:account-password {owner|client}`.
     */
    'accounts' => [
        'owner' => [
            'password_hash' => env('FEEDBACK_OWNER_PASSWORD_HASH'),
        ],
        'client' => [
            'password_hash' => env('FEEDBACK_CLIENT_PASSWORD_HASH'),
        ],
    ],

    'automation' => [
        'enabled' => env('FEEDBACK_AUTOMATION_ENABLED', false),
        'workspace_root' => env('FEEDBACK_WORKSPACE_ROOT'),
        'codex_binary' => env('FEEDBACK_CODEX_BINARY', 'codex'),
        'queue' => env('FEEDBACK_AUTOMATION_QUEUE', 'feedback-automation'),
        'timeout' => (int) env('FEEDBACK_AUTOMATION_TIMEOUT', 3000),
    ],
];
