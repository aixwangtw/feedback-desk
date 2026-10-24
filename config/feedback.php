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
        'enabled' => filter_var(env('FEEDBACK_LOGIN_PREFILL_ENABLED', false), FILTER_VALIDATE_BOOL),
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
        'title' => env('FEEDBACK_HOME_TITLE', '問題回報'),
        'eyebrow' => env('FEEDBACK_HOME_EYEBROW', 'Feedback Desk'),
        'heading' => env('FEEDBACK_HOME_HEADING', '問題回報'),
        'body' => env('FEEDBACK_HOME_BODY', "請開啟{$ownerLabel}給你的專案連結，登入後就能回報問題、查看處理進度。"),
    ],

    /*
     * Public reporting: strangers file issues from the home page into one project. It is active
     * only when `home_project` names a project that was switched on with
     * `php artisan feedback:public-reporting {project} on`. The links and the notice stay
     * hidden while their values are empty.
     */
    'public_reporting' => [
        'home_project' => env('FEEDBACK_HOME_PUBLIC_PROJECT'),
        'intro' => env('FEEDBACK_PUBLIC_INTRO'),
        'github_url' => env('FEEDBACK_PUBLIC_GITHUB_URL'),
        'blog_url' => env('FEEDBACK_PUBLIC_BLOG_URL'),
        'notice' => env('FEEDBACK_PUBLIC_NOTICE'),
        'throttle' => [
            'per_minute' => (int) env('FEEDBACK_PUBLIC_THROTTLE_PER_MINUTE', 3),
            'per_hour' => (int) env('FEEDBACK_PUBLIC_THROTTLE_PER_HOUR', 20),
        ],
        'message_throttle' => [
            'per_minute' => (int) env('FEEDBACK_PUBLIC_MESSAGE_THROTTLE_PER_MINUTE', 5),
            'per_hour' => (int) env('FEEDBACK_PUBLIC_MESSAGE_THROTTLE_PER_HOUR', 30),
        ],
        'max_attachments_per_report' => (int) env('FEEDBACK_PUBLIC_MAX_ATTACHMENTS', 15),
        'turnstile' => [
            'site_key' => env('FEEDBACK_TURNSTILE_SITE_KEY'),
            'secret_key' => env('FEEDBACK_TURNSTILE_SECRET_KEY'),
        ],
    ],

    'automation' => [
        'enabled' => filter_var(env('FEEDBACK_AUTOMATION_ENABLED', false), FILTER_VALIDATE_BOOL),
        'workspace_root' => env('FEEDBACK_WORKSPACE_ROOT'),
        'driver' => env('FEEDBACK_AUTOMATION_DRIVER', 'codex'),
        'codex_binary' => env('FEEDBACK_CODEX_BINARY', 'codex'),
        'claude_binary' => env('FEEDBACK_CLAUDE_BINARY', 'claude'),
        'claude_model' => env('FEEDBACK_CLAUDE_MODEL'),
        'claude_max_turns' => (int) env('FEEDBACK_CLAUDE_MAX_TURNS', 60),
        'claude_allowed_tools' => env('FEEDBACK_CLAUDE_ALLOWED_TOOLS', 'Read,Edit,Write,Glob,Grep'),
        'claude_oauth_token' => env('FEEDBACK_CLAUDE_OAUTH_TOKEN'),
        'queue' => env('FEEDBACK_AUTOMATION_QUEUE', 'feedback-automation'),
        'timeout' => (int) env('FEEDBACK_AUTOMATION_TIMEOUT', 3000),
    ],
];
