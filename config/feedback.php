<?php

return [
    'domain' => env('FEEDBACK_DOMAIN'),

    'disk' => env('FEEDBACK_DISK', 'local'),

    'automation' => [
        'enabled' => env('FEEDBACK_AUTOMATION_ENABLED', false),
        'workspace_root' => env('FEEDBACK_WORKSPACE_ROOT'),
        'codex_binary' => env('FEEDBACK_CODEX_BINARY', 'codex'),
        'queue' => env('FEEDBACK_AUTOMATION_QUEUE', 'feedback-automation'),
        'timeout' => (int) env('FEEDBACK_AUTOMATION_TIMEOUT', 3000),
    ],
];
