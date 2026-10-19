{{-- 留言串（聊天泡泡）：回饋單頁與右下角對話面板共用。看的人自己這一方的訊息靠右。 --}}
@use('App\Enums\FeedbackAuthorType')
@php
    $viewerIsOwner ??= app(\App\Support\FeedbackAccess::class)->isOwner($project);
    $compact ??= false;
@endphp

<ol class="grid gap-4" data-chat-messages>
    @forelse ($report->feedbackMessages as $message)
        @php
            $isTeamSide = $message->author_type !== FeedbackAuthorType::Reporter;
            $isMine = $viewerIsOwner === $isTeamSide;
            [$bubbleClass, $nameClass] = match ($message->author_type) {
                FeedbackAuthorType::Agent => ['bg-violet-50 ring-violet-200', 'text-violet-800'],
                FeedbackAuthorType::Owner => ['bg-teal-50 ring-teal-200', 'text-teal-800'],
                FeedbackAuthorType::Reporter => ['bg-amber-50 ring-amber-200', 'text-amber-800'],
            };
        @endphp
        <li @class(['flex', 'justify-end' => $isMine, 'justify-start' => ! $isMine]) data-chat-message data-author="{{ $message->author_type->value }}" data-side="{{ $isMine ? 'mine' : 'theirs' }}">
            <div @class(['flex min-w-0 max-w-[88%] flex-col sm:max-w-[80%]', 'items-end' => $isMine, 'items-start' => ! $isMine])>
                <div @class(['flex flex-wrap items-baseline gap-x-2 px-1 text-xs', 'flex-row-reverse' => $isMine])>
                    <span class="font-semibold {{ $nameClass }}" data-chat-author>{{ $message->displayAuthor($report, $viewerIsOwner) }}</span>
                    <x-feedback.time :at="$message->created_at" relative class="text-slate-500" />
                </div>
                <div @class(['mt-1 min-w-0 max-w-full rounded-2xl px-3.5 py-2.5 ring-1 ring-inset', $bubbleClass, 'rounded-tr-md' => $isMine, 'rounded-tl-md' => ! $isMine])>
                    <p class="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800" data-chat-body>{{ $message->body }}</p>
                    @if ($message->feedbackAttachments->isNotEmpty())
                        <div class="mt-2 flex flex-wrap gap-2">
                            @foreach ($message->feedbackAttachments as $attachment)
                                <a href="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" target="_blank" rel="noreferrer" class="block {{ $compact ? 'size-20' : 'size-24 sm:size-28' }} overflow-hidden rounded-lg border border-white bg-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt="{{ $attachment->original_name }}" title="放大預覽" data-chat-attachment>
                                    <img src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" alt="{{ $attachment->original_name }}" class="size-full object-cover" loading="lazy">
                                </a>
                            @endforeach
                        </div>
                    @endif
                </div>
            </div>
        </li>
    @empty
        <li class="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500" data-chat-empty>還沒有留言，新的處理進度會顯示在這裡。</li>
    @endforelse
</ol>
