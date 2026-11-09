{{--
    Jira 式右側「詳細資料」窄欄（詳情視窗與單頁共用，詳情視窗也靠對話端點的 side_html 隨狀態更新）：
    左右兩欄「標籤｜值」每列一行：狀態（左膠囊、右「完成」鈕）、建立者、建立時間、最後更新；標籤灰色小字、值一般字。
    完成鈕是 x-feedback.complete-button（清單、看板共用）：客戶端按了直接把單改成已完成；開發團隊端按了只會跳出確認留言（見 _completion-dialog），單維持等客戶，不會直接結案；說明放在按鈕的提示文字。
    $context：dialog（詳情視窗，另有編輯、完整頁與「⋯」選單）或 page（單頁，只有詳細資料）。
--}}
@php
    $context ??= 'dialog';
    $isCompleted = $report->status === \App\Enums\FeedbackReportStatus::Completed;
    $canManage = $canManage ?? true;
    $detailButton = 'inline-flex min-h-8 shrink-0 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600';
    $menuItem = 'block w-full px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100';
@endphp
<div class="grid gap-4" data-detail-side>
    <dl class="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3 text-xs" data-detail-fields>
        <dt class="text-slate-500">狀態</dt>
        <dd class="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <x-feedback.status-badge :status="$report->status" :$project data-report-status-badge="{{ $report->public_id }}" />
            @if ($canManage && ! $isCompleted)
                <span data-detail-complete><x-feedback.complete-button :$project :$report :is-owner="$isOwner" /></span>
            @endif
        </dd>
        @unless ($report->isPublicReport() && ! $isOwner)
            <dt class="text-slate-500">建立者</dt>
            <dd class="min-w-0 break-words font-medium text-slate-800" data-report-creator>{{ $report->creatorLabel() }}</dd>
        @endunless
        <dt class="text-slate-500">建立時間</dt>
        <dd class="font-medium text-slate-800"><x-feedback.time :at="$report->created_at" /></dd>
        <dt class="text-slate-500">最後更新</dt>
        <dd class="font-medium text-slate-800"><x-feedback.time :at="$report->latest_activity_at" relative /></dd>
        @if ($isOwner && $report->isDeletedByClient())
            <dt class="text-slate-500" data-client-deleted>{{ $project->clientRole() }}已刪除</dt>
            <dd class="font-medium text-slate-800"><x-feedback.time :at="$report->client_deleted_at" /></dd>
        @endif
    </dl>
    @if ($context === 'dialog')
        {{-- 主要操作一列（編輯、完整頁），其他收進「⋯」選單，刪除在選單裡用紅字。 --}}
        <div class="flex items-center gap-2 border-t border-slate-200 pt-3" data-detail-actions>
            <button type="button" class="{{ $detailButton }}" data-dialog-open="edit-report-{{ $report->public_id }}">編輯</button>
            <a href="{{ route('feedback.reports.show', [$project, $report]) }}" class="{{ $detailButton }}">完整頁</a>
            <details class="relative ml-auto" data-action-menu>
                <summary class="{{ $detailButton }} cursor-pointer list-none px-2.5 text-base leading-none [&::-webkit-details-marker]:hidden" aria-label="更多操作" title="更多操作">⋯</summary>
                <div class="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5">
                    <button type="button" class="{{ $menuItem }}" data-chat-open="{{ $report->public_id }}">在對話面板開啟</button>
                    @if ($isOwner && $report->isDeletedByClient())
                        <form method="POST" action="{{ route('feedback.reports.restore', [$project, $report]) }}">
                            @csrf
                            @method('PATCH')
                            <button type="submit" class="{{ $menuItem }} text-teal-800" data-restore-report>還原</button>
                        </form>
                    @endif
                    @if ($isOwner)
                        <button type="button" class="{{ $menuItem }} text-rose-700 hover:bg-rose-50" data-dialog-open="delete-report-{{ $report->public_id }}" data-delete-report>刪除</button>
                    @else
                        <button type="button" class="{{ $menuItem }} text-rose-700 hover:bg-rose-50" data-dialog-open="client-delete-report-{{ $report->public_id }}" data-client-delete-report>刪除</button>
                    @endif
                </div>
            </details>
        </div>
    @endif
</div>
