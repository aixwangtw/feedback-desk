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
@php
    $access = app(\App\Support\FeedbackAccess::class);
    $canManage = $project && $access->canManage($project);
    $showChatPanel = $canManage;
    $isOwner = $project ? $access->isOwner($project) : $access->hasGlobalOwner();
    $allProjects = $isOwner ? \App\Models\FeedbackProject::orderBy('name')->get() : collect();
@endphp
<body class="min-h-screen bg-slate-50 font-sans text-slate-950 antialiased">
    <div class="pointer-events-none fixed inset-x-0 top-0 h-72 bg-gradient-to-b from-teal-50 to-transparent"></div>

    <header class="relative z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur">
        <div class="mx-auto flex {{ $maxWidth }} items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
            <div class="flex min-w-0 items-center gap-3">
                <a href="{{ $project ? route('feedback.portal', $project, false) : route('feedback.home', [], false) }}" class="flex min-w-0 items-center gap-3 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">
                    <span class="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-700 text-sm font-bold text-white shadow-sm">回</span>
                    <span class="min-w-0">
                        <span class="block truncate text-sm font-semibold text-slate-950">{{ $project?->name ?? config('feedback.home.title') }}</span>
                    </span>
                </a>

                @if ($isOwner && $allProjects->isNotEmpty())
                    <details class="relative shrink-0" data-project-switcher>
                        <summary class="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 [&::-webkit-details-marker]:hidden" title="切換專案">
                            <svg class="size-3.5 text-teal-700" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                            </svg>
                            <span class="hidden sm:inline">切換專案</span>
                            <svg class="size-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                            </svg>
                        </summary>
                        <div class="absolute left-0 mt-2 w-64 origin-top-left rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg ring-1 ring-black/5 z-50">
                            <div class="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">專案切換</div>
                            <div class="max-h-64 overflow-y-auto">
                                @foreach ($allProjects as $p)
                                    <a href="{{ route('feedback.portal', $p, false) }}"
                                       class="flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-slate-700 transition hover:bg-teal-50 hover:text-teal-900 active:bg-teal-100 @if ($project && $project->id === $p->id) bg-teal-50/60 font-semibold text-teal-800 @endif"
                                       @if ($project && $project->id === $p->id) aria-current="page" @endif
                                       data-project-link>
                                        <span class="pointer-events-none truncate">{{ $p->name }}</span>
                                        @if ($project && $project->id === $p->id)
                                            <span class="pointer-events-none shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-800">目前</span>
                                        @endif
                                    </a>
                                @endforeach
                            </div>
                            <div class="border-t border-slate-100 mt-1 pt-1">
                                <a href="{{ route('feedback.home', [], false) }}" class="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100" data-project-link>
                                    <svg class="size-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
                                    </svg>
                                    <span>專案總覽</span>
                                </a>
                            </div>
                        </div>
                    </details>
                @endif
            </div>

            <div class="flex shrink-0 items-center gap-2">
                @isset($headerAction)
                    {{ $headerAction }}
                @endisset
                @if ($project && $access->currentAccount($project))
                    <a href="{{ route('feedback.account', $project, false) }}" class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-account-link>我的帳號</a>
                @elseif (! $project && $access->hasGlobalOwner() && $access->currentDeveloper())
                    @if ($allProjects->isNotEmpty())
                        <a href="{{ route('feedback.account', $allProjects->first(), false) }}" class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-account-link>我的帳號</a>
                    @endif
                @endif

                @if ($canManage)
                    <form method="POST" action="{{ route('feedback.logout', $project, false) }}">
                        @csrf
                        <button type="submit" class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-logout>登出</button>
                    </form>
                @elseif ($access->hasGlobalOwner())
                    <form method="POST" action="{{ route('feedback.logout.unified', [], false) }}">
                        @csrf
                        <button type="submit" class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-logout>登出</button>
                    </form>
                @elseif (! request()->routeIs('feedback.login*'))
                    <a href="{{ route('feedback.login.unified', [], false) }}" class="rounded-lg px-3 py-2 text-sm font-semibold text-teal-700 transition hover:bg-teal-50 hover:text-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">管理者登入</a>
                @endif
            </div>
        </div>
    </header>

    <main @class(['relative mx-auto w-full px-4 py-8 sm:px-6 sm:py-12 lg:px-8', $maxWidth, 'pb-28 sm:pb-28' => $showChatPanel])>
        @if (session('success'))
            <div role="status" class="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
                {{ session('success') }}
            </div>
        @endif

        {{ $slot }}
    </main>

    @if ($showChatPanel)
        <x-feedback.chat-panel :$project />
    @endif

    <x-feedback.image-lightbox />
</body>
</html>
