{{-- 單頁右側：誰在處理（認領）、交接紀錄與最近動態，只有團隊看得到。 --}}
@php
    $workErrors = $errors->getBag('work');
    $smallButton = 'rounded-lg border px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600';
    $statusLabel = fn (string $value): string => \App\Enums\FeedbackReportStatus::tryFrom($value)?->label() ?? $value;
@endphp
<section id="work" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-work-panel>
    <h2 class="text-sm font-semibold text-slate-950">誰在處理</h2>
    @if ($workErrors->any())
        <div role="alert" class="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800">
            @foreach ($workErrors->all() as $error)<p>{{ $error }}</p>@endforeach
        </div>
    @endif
    @if ($work['claim'])
        <p class="mt-2 text-sm text-slate-700" data-claim>
            <span class="font-semibold text-slate-900">{{ $work['claim']['by'] }}</span> 認領中（<x-feedback.time :at="$work['claim']['since']" /> 開始）
        </p>
    @else
        <p class="mt-2 text-sm text-slate-500" data-claim-none>目前沒有人認領。</p>
    @endif
    @if ($work['claim'] && ! $work['claim']['yours'])
        <p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900" data-claim-warning>
            已有人認領。改狀態或調整說明前先看下方交接紀錄；要接手請按「接手」，會留下紀錄。
        </p>
    @endif
    @if ($canClaim)
        <form method="POST" action="{{ route('feedback.reports.claim', [$project, $report]) }}" class="mt-3 flex flex-wrap gap-2">
            @csrf
            @if (! $work['claim'])
                <button type="submit" name="action" value="claim" class="{{ $smallButton }} border-teal-200 bg-teal-50 text-teal-800 hover:bg-teal-100" data-claim-button>認領</button>
            @elseif ($work['claim']['yours'])
                <button type="submit" name="action" value="release" class="{{ $smallButton }} border-slate-300 bg-white text-slate-700 hover:bg-slate-50" data-release-button>釋放</button>
            @else
                <button type="submit" name="action" value="takeover" class="{{ $smallButton }} border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100" data-takeover-button>接手</button>
            @endif
        </form>
    @else
        <p class="mt-3 text-xs text-slate-500">用個人帳號登入才能認領與寫交接紀錄。</p>
    @endif

    <h3 class="mt-5 text-sm font-semibold text-slate-950">交接紀錄</h3>
    @if ($work['handoff_notes'] === [])
        <p class="mt-2 text-xs text-slate-500">還沒有交接紀錄。工作中斷時寫下做到哪、下一步，下一個人（或 AI）讀單時會先看到。</p>
    @else
        <ol class="mt-2 grid gap-3" data-handoff-notes>
            @foreach ($work['handoff_notes'] as $note)
                <li class="rounded-lg bg-slate-50 px-3 py-2">
                    <p class="text-[11px] text-slate-500"><span class="font-semibold text-slate-700">{{ $note['author'] }}</span> · <x-feedback.time :at="$note['created_at']" relative /></p>
                    <p class="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-slate-800">{{ $note['note'] }}</p>
                </li>
            @endforeach
        </ol>
    @endif
    @if ($canClaim)
        <form method="POST" action="{{ route('feedback.reports.handoff', [$project, $report]) }}" class="mt-3 grid gap-2" data-handoff-form>
            @csrf
            <label for="handoff-note" class="sr-only">交接紀錄</label>
            <textarea id="handoff-note" name="note" required maxlength="{{ \App\Support\FeedbackReportWork::MAX_HANDOFF_NOTE }}" rows="3" placeholder="做到哪、下一步、注意事項" class="block w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs leading-5 shadow-sm outline-none focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">{{ $workErrors->any() ? old('note') : '' }}</textarea>
            <label class="flex items-center gap-2 text-xs text-slate-600">
                <input type="checkbox" name="release" value="1" class="rounded border-slate-300 text-teal-700">
                同時釋放我的認領
            </label>
            <button type="submit" class="{{ $smallButton }} border-slate-300 bg-white text-slate-700 hover:bg-slate-50">儲存交接紀錄</button>
        </form>
    @endif

    @if ($work['recent_activity'] !== [])
        <details class="mt-5" data-activity-log>
            <summary class="cursor-pointer text-sm font-semibold text-slate-950">最近動態</summary>
            <ol class="mt-2 grid gap-1.5 text-xs text-slate-600">
                @foreach ($work['recent_activity'] as $event)
                    <li>
                        <x-feedback.time :at="$event['at']" relative class="text-slate-400" /> <span class="font-semibold text-slate-800">{{ $event['by'] }}</span> {{ $event['label'] }}@if ($event['kind'] === 'status' && $event['detail'] && str_contains($event['detail'], '>'))：{{ $statusLabel(explode('>', $event['detail'])[0]) }} → {{ $statusLabel(explode('>', $event['detail'])[1]) }}@elseif (in_array($event['kind'], ['takeover', 'release'], true) && $event['detail'])（原本是 {{ $event['detail'] }}）@endif
                    </li>
                @endforeach
            </ol>
        </details>
    @endif
</section>
