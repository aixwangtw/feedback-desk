@props(['title', 'project' => null, 'maxWidth' => 'max-w-5xl'])

<!DOCTYPE html>
<html lang="zh-Hant">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="referrer" content="no-referrer">
    <title>{{ $title }}</title>
    @vite(['resources/css/app.css', 'resources/js/app.js'])
</head>
<body class="min-h-screen bg-slate-50 font-sans text-slate-950 antialiased">
    <div class="pointer-events-none fixed inset-x-0 top-0 h-72 bg-gradient-to-b from-teal-50 to-transparent"></div>

    <header class="relative border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div class="mx-auto flex {{ $maxWidth }} items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <a href="{{ $project ? route('feedback.portal', $project) : '/' }}" class="flex min-w-0 items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">
                <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-700 text-sm font-bold text-white shadow-sm">回</span>
                <span class="min-w-0">
                    <span class="block truncate text-sm font-semibold text-slate-950">{{ $project?->name ?? '問題回報中心' }}</span>
                    <span class="block text-xs text-slate-500">登記、排序、追蹤處理進度</span>
                </span>
            </a>
            <div class="flex shrink-0 items-center gap-2">
                @isset($headerAction)
                    {{ $headerAction }}
                @endisset
                @if ($project && app(\App\Support\FeedbackAccess::class)->canManage($project))
                    <form method="POST" action="{{ route('feedback.logout', $project) }}">
                        @csrf
                        <button type="submit" class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-logout>登出</button>
                    </form>
                @endif
            </div>
        </div>
    </header>

    <main class="relative mx-auto w-full {{ $maxWidth }} px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        @if (session('success'))
            <div role="status" class="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
                {{ session('success') }}
            </div>
        @endif

        {{ $slot }}
    </main>

    <x-feedback.image-lightbox />
</body>
</html>
