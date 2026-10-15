<?php

return [
    'domain' => env('FEEDBACK_DOMAIN'),

    'disk' => env('FEEDBACK_DISK', 'local'),

    /*
     * Shared sign-in accounts, keyed by role. Only bcrypt hashes are stored; reset them with
     * `php artisan feedback:account-password {owner|client}`.
     */
    'accounts' => [
        'owner' => [
            'username' => env('FEEDBACK_OWNER_USERNAME', 'admin'),
            'password_hash' => env('FEEDBACK_OWNER_PASSWORD_HASH'),
        ],
        'client' => [
            'username' => env('FEEDBACK_CLIENT_USERNAME', 'test'),
            'password_hash' => env('FEEDBACK_CLIENT_PASSWORD_HASH'),
        ],
    ],

    /*
     * Values pre-filled on the login forms so users only have to press「登入」.
     * `client` is used on /p/{slug}/login, `owner` on /owner/{slug}/login.
     */
    'login_prefill' => [
        'client' => [
            'username' => env('FEEDBACK_LOGIN_PREFILL_USERNAME', 'test'),
            'password' => env('FEEDBACK_LOGIN_PREFILL_PASSWORD', 'change-me'),
        ],
        'owner' => [
            'username' => env('FEEDBACK_OWNER_LOGIN_PREFILL_USERNAME', 'admin'),
            'password' => env('FEEDBACK_OWNER_LOGIN_PREFILL_PASSWORD', 'change-me'),
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
