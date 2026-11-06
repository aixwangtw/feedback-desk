{{--
    清單、看板上的編號與標題：一律用藍色連結色，滑鼠移上去出現底線與手指游標（照 Jira）。
    點了開詳情視窗（沒有 JS 時照連結去單頁）；整列／整張卡片的點擊由 resources/js/row-link.js 處理，這裡只管連結本身。
    清單、看板各處編號與標題都用這一個，樣式只寫這一份。
--}}
@props(['project', 'report'])

<a href="{{ route('feedback.reports.show', [$project, $report]) }}" {{ $attributes->class(['cursor-pointer text-blue-700 underline-offset-2 hover:text-blue-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600']) }} data-dialog-open="detail-report-{{ $report->public_id }}" data-report-detail-open>{{ $slot }}</a>
