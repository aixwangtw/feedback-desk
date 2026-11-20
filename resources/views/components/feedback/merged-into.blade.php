@props(['project', 'report'])

{{-- 團隊端：重複的單合併到哪一張（單頁標題下與詳情窄欄共用）；編號是團隊端清單編號，連到保留的單。 --}}

@php $mergedInto = $report->mergedInto; @endphp
@if ($mergedInto !== null)
    <a href="{{ route('feedback.reports.show', [$project, $mergedInto]) }}" {{ $attributes->merge(['class' => 'font-semibold text-teal-700 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600']) }} data-merged-into="{{ $mergedInto->public_id }}">已合併到編號 {{ $mergedInto->sequenceNumber() }}</a>
@else
    <span {{ $attributes }} data-merged-into>已合併（原單已刪除）</span>
@endif
