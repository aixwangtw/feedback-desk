{{-- 附件的一行短標題：檔名去掉副檔名，太長截斷並加省略號，滑鼠移上去看完整檔名（留言、待審留言共用）。 --}}
@props(['name'])

<span {{ $attributes->class(['block truncate text-[11px] leading-4 text-slate-600']) }} title="{{ $name }}" data-attachment-title>{{ \App\Support\FeedbackAttachmentRules::displayTitle($name) }}</span>
