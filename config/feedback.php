<?php

$clientLabel = env('FEEDBACK_LABEL_CLIENT', '客戶');
$ownerLabel = env('FEEDBACK_LABEL_OWNER', '開發團隊');

return [
    'domain' => env('FEEDBACK_DOMAIN'),

    'disk' => env('FEEDBACK_DISK', 'local'),

    /*
     * Shared sign-in accounts, keyed by role. Only bcrypt hashes are stored; reset them with
     * `php artisan feedback:account-password {owner|client}`.
     */
    'accounts' => [
        'owner' => [
            'username' => env('FEEDBACK_OWNER_USERNAME'),
            'password_hash' => env('FEEDBACK_OWNER_PASSWORD_HASH'),
        ],
        'client' => [
            'username' => env('FEEDBACK_CLIENT_USERNAME'),
            'password_hash' => env('FEEDBACK_CLIENT_PASSWORD_HASH'),
        ],
    ],

    /*
     * Pre-fills the login forms. Disabled by default: when false, no username or password is
     * ever rendered into a login page (including per-project values saved with
     * `feedback:client-account --prefill`). `client` is used on /p/{slug}/login, `owner` on
     * /owner/{slug}/login.
     */
    'login_prefill' => [
        'enabled' => (bool) env('FEEDBACK_LOGIN_PREFILL_ENABLED', false),
        'owner' => [
            'username' => env('FEEDBACK_OWNER_LOGIN_PREFILL_USERNAME'),
            'password' => env('FEEDBACK_OWNER_LOGIN_PREFILL_PASSWORD'),
        ],
    ],

    /*
     * Wording shown in the UI. `client` is the person reporting problems, `owner` the team
     * resolving them.
     */
    'labels' => [
        'client' => $clientLabel,
        'owner' => $ownerLabel,
    ],

    'portal_title' => env('FEEDBACK_PORTAL_TITLE', '問題回報追蹤'),

    'home' => [
        'title' => env('FEEDBACK_HOME_TITLE', '問題回報中心'),
        'eyebrow' => env('FEEDBACK_HOME_EYEBROW', '跨產品問題回報'),
        'heading' => env('FEEDBACK_HOME_HEADING', '把問題留在正確的專案'),
        'body' => env('FEEDBACK_HOME_BODY', "請使用{$ownerLabel}提供的{$clientLabel}專屬連結。每個專案的內容、截圖與處理工作區彼此隔離。"),
    ],

    'automation' => [
        'enabled' => env('FEEDBACK_AUTOMATION_ENABLED', false),
        'workspace_root' => env('FEEDBACK_WORKSPACE_ROOT'),
        'codex_binary' => env('FEEDBACK_CODEX_BINARY', 'codex'),
        'queue' => env('FEEDBACK_AUTOMATION_QUEUE', 'feedback-automation'),
        'timeout' => (int) env('FEEDBACK_AUTOMATION_TIMEOUT', 3000),
    ],
];
