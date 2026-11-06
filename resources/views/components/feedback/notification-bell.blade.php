{{-- 頁首通知鈴鐺：只列對方發的、自己還沒讀的留言；點了開啟該單留言處（開啟即標已讀）。團隊端另列待審留言。 --}}
@props(['notifications'])

@php $total = $notifications['total']; @endphp
<details class="relative" data-notification-bell data-bell-count="{{ $total }}">
    <summary class="relative grid size-10 cursor-pointer list-none place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 [&::-webkit-details-marker]:hidden" aria-label="通知（{{ $total }} 則新留言）" title="通知">
        <svg class="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        @if ($total > 0)
            <span class="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-600 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white" data-bell-badge>{{ $total > 99 ? '99+' : $total }}</span>
        @endif
    </summary>
    <div class="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg ring-1 ring-black/5">
        <p class="border-b border-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-500">{{ $notifications['is_owner'] ? config('feedback.labels.client').'的新留言' : config('feedback.labels.owner').'的新留言' }}</p>
        <div class="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain">
            @forelse ($notifications['items'] as $item)
                <a href="{{ $item['url'] }}" class="block border-b border-slate-100 px-4 py-3 transition hover:bg-teal-50" data-bell-item="{{ $item['public_id'] }}">
                    <span class="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span class="truncate">{{ $item['project'] }}</span>
                        <x-feedback.time :at="$item['at']" relative class="shrink-0" />
                    </span>
                    <span class="mt-0.5 flex items-center gap-2">
                        <span class="min-w-0 flex-1 truncate text-sm font-semibold text-slate-950">{{ $item['title'] }}</span>
                        <span class="shrink-0 rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">{{ $item['unread'] }}</span>
                    </span>
                    <span class="mt-1 block text-xs leading-5 text-slate-600">{{ $item['excerpt'] }}</span>
                </a>
            @empty
                <p class="px-4 py-6 text-center text-sm text-slate-500">目前沒有新留言</p>
            @endforelse
        </div>
        @if ($notifications['drafts'] !== [])
            <div class="border-t border-amber-200 bg-amber-50/70">
                <p class="px-4 pt-2.5 text-xs font-semibold text-amber-900">待審留言（只有{{ config('feedback.labels.owner') }}看得到）</p>
                @foreach ($notifications['drafts'] as $draft)
                    <a href="{{ $draft['url'] }}" class="flex items-center justify-between gap-2 px-4 py-2 text-sm hover:bg-amber-100" data-bell-draft="{{ $draft['public_id'] }}">
                        <span class="min-w-0 truncate"><span class="text-[11px] text-amber-800">{{ $draft['project'] }}｜</span>{{ $draft['title'] }}</span>
                        <span class="shrink-0 rounded-full border border-amber-400 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900">待審留言 {{ $draft['count'] }}</span>
                    </a>
                @endforeach
            </div>
        @endif
    </div>
</details>
