{{-- 附件的短標題：檔名去掉副檔名，完整顯示、太長換行（最多 3 行），滑鼠移上去仍可看完整檔名（留言、待審留言、相簿共用；拖曳預覽的 JS 版樣式要一致，見 attachment-composer.js）。 --}}
@props(['name'])

<span {{ $attributes->class(['attachment-caption block text-[11px] leading-4 text-slate-600']) }} title="{{ $name }}" data-attachment-title>{{ \App\Support\FeedbackAttachmentRules::displayTitle($name) }}</span>
