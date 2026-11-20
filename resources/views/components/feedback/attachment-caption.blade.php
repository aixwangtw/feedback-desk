{{-- 附件的短標題：傳 number 時一律顯示「圖N」／「影片N」（見 FeedbackAttachmentRules::numberedTitle）；沒傳才用檔名去掉副檔名，完整顯示、太長換行（最多 3 行），滑鼠移上去仍可看完整檔名（留言、待審留言、相簿共用；拖曳預覽的 JS 版樣式要一致，見 attachment-composer.js）。 --}}
@props(['name', 'number' => null, 'video' => false])

@php $title = $number === null ? \App\Support\FeedbackAttachmentRules::displayTitle($name) : \App\Support\FeedbackAttachmentRules::numberedTitle((int) $number, (bool) $video); @endphp

<span {{ $attributes->class(['attachment-caption block text-[11px] leading-4 text-slate-600']) }} title="{{ $title }}" data-attachment-title>{{ $title }}</span>
