{{--
    活動時間軸（留言泡泡＋狀態變更），單頁、詳情視窗、右下角對話面板共用。看的人自己這一方的訊息靠右。
    狀態變更是置中的一行；開發團隊端另顯示是誰改的，客戶端只顯示改成什麼狀態。
    「請確認完成」的留言：客戶端（能按完成的一方）在最新一則上看到「通過」按鈕，開發團隊端看不到也按不了。
--}}
@use('App\Enums\FeedbackAuthorType')
@use('App\Enums\FeedbackReportStatus')
@php
    $access = app(\App\Support\FeedbackAccess::class);
    $viewerIsOwner ??= $access->isOwner($project);
    $viewerAccount = $viewerIsOwner ? null : $access->clientViewer($project);
    $compact ??= false;
    $timeline = app(\App\Support\FeedbackTimeline::class)->entries($report);
    $latestCompletionRequestId = $report->feedbackMessages()->withTrashed()->where('is_completion_request', true)->max('id');
    $canApprove = ! $viewerIsOwner && $access->canManage($project) && $report->status !== FeedbackReportStatus::Completed;
@endphp

<ol class="grid grid-cols-[minmax(0,1fr)] gap-4" data-chat-messages>
    @forelse ($timeline as $entry)
        @if ($entry['type'] === 'status')
            @php
                $to = FeedbackReportStatus::tryFrom($entry['to']);
                $who = $viewerIsOwner ? \App\Support\FeedbackAgentName::label((string) $entry['actor'], $entry['agent']).' ' : '';
            @endphp
            <li class="flex justify-center" data-chat-event="status" data-status-to="{{ $entry['to'] }}">
                <p class="max-w-full rounded-full bg-slate-100 px-3 py-1 text-center text-xs text-slate-600">{{ $who }}將狀態改為「<span class="font-semibold text-slate-800">{{ $to?->label() ?? $entry['to'] }}</span>」 <x-feedback.time :at="$entry['at']" relative class="text-slate-400" /></p>
            </li>
            @continue
        @endif
        @php
            $message = $entry['message'];
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
                    @if ($message->isManageableBy($viewerIsOwner, $viewerAccount))
                        <x-feedback.message-menu :$project :$report :$message />
                    @endif
                </div>
                <div @class(['mt-1 min-w-0 max-w-full rounded-2xl px-3.5 py-2.5 ring-1 ring-inset', $bubbleClass, 'rounded-tr-md' => $isMine, 'rounded-tl-md' => ! $isMine])>
                    @if ($message->is_completion_request)
                        <p class="mb-1 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800" data-completion-request-badge>請確認完成</p>
                    @endif
                    <p class="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800" data-chat-body>{{ $message->body }}</p>
                    @if ($message->isManageableBy($viewerIsOwner, $viewerAccount))
                        <x-feedback.message-edit-form :$project :$report :$message />
                    @endif
                    @if ($message->is_completion_request && $canApprove && $message->id === $latestCompletionRequestId)
                        <form method="POST" action="{{ route('feedback.reports.status.update', [$project, $report]) }}" class="mt-2" data-completion-approve-form>
                            @csrf
                            @method('PATCH')
                            <input type="hidden" name="status" value="{{ FeedbackReportStatus::Completed->value }}">
                            <button type="submit" class="inline-flex min-h-9 items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60" data-completion-approve="{{ $report->public_id }}">{{ \App\Support\FeedbackCompletionRequest::APPROVE_LABEL }}</button>
                        </form>
                    @endif
                    @if ($message->feedbackAttachments->isNotEmpty())
                        <div class="mt-2 flex flex-wrap gap-2" data-chat-attachments>
                            @foreach ($message->feedbackAttachments as $attachment)
                                @if ($attachment->isVideo())
                                    <div class="min-w-0 w-full max-w-md">
                                        <video controls playsinline preload="metadata" src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" class="{{ $compact ? 'max-h-48' : 'max-h-72' }} w-full rounded-lg border border-white bg-black shadow-sm" data-chat-video title="{{ $attachment->original_name }}"></video>
                                        <x-feedback.attachment-caption :name="$attachment->original_name" class="mt-0.5" />
                                    </div>
                                    @continue
                                @endif
                                <div class="attachment-tile min-w-0">
                                <a href="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" target="_blank" rel="noreferrer" class="attachment-tile-thumb block overflow-hidden rounded-lg border border-white bg-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt="{{ $attachment->original_name }}" title="放大預覽" data-chat-attachment>
                                    <img src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" alt="{{ $attachment->original_name }}" class="size-full object-cover" loading="lazy">
                                </a>
                                <x-feedback.attachment-caption :name="$attachment->original_name" class="mt-0.5" />
                                </div>
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
