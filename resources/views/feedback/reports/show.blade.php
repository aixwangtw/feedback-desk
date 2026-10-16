<x-feedback.layout :title="$report->title.'｜'.$project->name" :$project>
    <x-slot:headerAction>
        <a href="{{ route('feedback.portal', $project) }}" class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">返回問題清單</a>
    </x-slot:headerAction>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div class="grid gap-6">
            <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                <div class="flex flex-wrap items-start justify-between gap-4">
                    <div class="min-w-0">
                        <h1 class="text-2xl font-bold tracking-tight text-slate-950"><span class="mr-1 text-slate-400">編號 <span data-report-number>{{ $sequenceNumber }}</span>｜</span>{{ $report->title }}</h1>
                        @if ($isOwner && $report->isDeletedByClient())
                            <div class="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500" data-client-deleted>
                                <span class="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 font-semibold text-slate-600 ring-1 ring-inset ring-slate-300">老師已刪除</span>
                                <x-feedback.time :at="$report->client_deleted_at" />
                                <form method="POST" action="{{ route('feedback.reports.restore', [$project, $report]) }}">
                                    @csrf
                                    @method('PATCH')
                                    <button type="submit" class="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 font-semibold text-teal-800 transition hover:bg-teal-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-restore-report>還原</button>
                                </form>
                            </div>
                        @endif
                    </div>
                    <x-feedback.status-badge :status="$report->status" />
                </div>

                <p class="mt-5 whitespace-pre-wrap text-sm leading-7 text-slate-700">{{ $report->description }}</p>

                @if ($report->feedbackAttachments->isNotEmpty())
                    <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                        @foreach ($report->feedbackAttachments as $attachment)
                            <a href="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" target="_blank" rel="noreferrer" class="group relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600" data-lightbox-trigger data-lightbox-alt="{{ $attachment->original_name }}">
                                <img src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" alt="{{ $attachment->original_name }}" class="aspect-video w-full object-cover transition group-hover:scale-[1.02]" loading="lazy">
                                <span class="absolute inset-x-2 bottom-2 rounded-md bg-slate-950/75 px-2 py-1 text-center text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">放大預覽</span>
                            </a>
                        @endforeach
                    </div>
                @endif
            </section>

            @if ($isOwner || $report->hasAdjustment())
                <section id="adjustment" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                    @include('feedback.reports._adjustment', ['project' => $project, 'report' => $report])

                    @if ($isOwner)
                        @php $adjustmentErrors = $errors->getBag('adjustment'); @endphp
                        <details class="mt-5 border-t border-slate-100 pt-4" @if ($adjustmentErrors->any()) open @endif data-adjustment-editor>
                            <summary class="cursor-pointer text-sm font-semibold text-teal-800">編輯調整說明（僅開發者）</summary>
                            <form method="POST" action="{{ route('feedback.reports.adjustment.update', [$project, $report]) }}" enctype="multipart/form-data" class="mt-4 grid gap-4">
                                @csrf
                                @method('PUT')
                                @if ($adjustmentErrors->any())
                                    <div role="alert" class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                                        <ul class="list-disc space-y-1 pl-5">@foreach ($adjustmentErrors->all() as $error)<li>{{ $error }}</li>@endforeach</ul>
                                    </div>
                                @endif
                                <div>
                                    <label for="adjustment_note" class="mb-2 block text-xs font-semibold text-slate-600">說明文字（再次調整時請接在原內容後面補寫）</label>
                                    <textarea id="adjustment_note" name="adjustment_note" maxlength="{{ \App\Actions\UpdateFeedbackReportAdjustmentAction::MAX_NOTE_LENGTH }}" rows="6" class="block w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">{{ $adjustmentErrors->any() ? old('adjustment_note') : $report->adjustment_note }}</textarea>
                                </div>

                                @if ($report->adjustmentAttachments->isNotEmpty())
                                    <fieldset>
                                        <legend class="mb-2 text-xs font-semibold text-slate-600">目前調整圖片 <span class="font-normal text-slate-500">（勾選要刪除的）</span></legend>
                                        <div class="grid grid-cols-3 gap-3 sm:grid-cols-5">
                                            @foreach ($report->adjustmentAttachments as $attachment)
                                                <label class="group relative block cursor-pointer overflow-hidden rounded-lg border border-slate-200 bg-slate-50 has-[:checked]:border-rose-400 has-[:checked]:opacity-50">
                                                    <img src="{{ route('feedback.attachments.show', [$project, $report, $attachment]) }}" alt="{{ $attachment->original_name }}" class="aspect-video w-full object-cover" loading="lazy">
                                                    <span class="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-rose-700">
                                                        <input type="checkbox" name="remove_adjustment_attachments[]" value="{{ $attachment->id }}" class="rounded border-slate-300 text-rose-600 focus:ring-rose-600">
                                                        刪除
                                                    </span>
                                                </label>
                                            @endforeach
                                        </div>
                                    </fieldset>
                                @endif

                                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <label for="adjustment-images" class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">
                                        加入調整圖片
                                        <input id="adjustment-images" name="adjustment_images[]" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target="adjustment-preview">
                                    </label>
                                    <button type="submit" class="inline-flex min-h-10 items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">儲存調整說明</button>
                                </div>
                                <div id="adjustment-preview" class="grid grid-cols-3 gap-3 sm:grid-cols-5" aria-live="polite"></div>
                            </form>
                        </details>
                    @endif
                </section>
            @endif

            <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" data-activity data-refresh-url="{{ route('feedback.reports.activity', [$project, $report]) }}">
                @include('feedback.reports._activity', ['project' => $project, 'report' => $report])
            </section>

            <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
                <h2 class="text-base font-semibold text-slate-950">補充訊息</h2>
                <form method="POST" action="{{ route('feedback.messages.store', [$project, $report]) }}" enctype="multipart/form-data" class="mt-4 grid gap-4">
                    @csrf
                    <div>
                        <label for="body" class="sr-only">訊息內容</label>
                        <textarea id="body" name="body" required maxlength="10000" rows="4" placeholder="補充操作步驟、回答開發者問題，或提供新的發現…" class="block w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm leading-6 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">{{ old('body') }}</textarea>
                        @error('body')<p class="mt-2 text-xs text-rose-700">{{ $message }}</p>@enderror
                    </div>
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <label for="message-screenshots" class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">
                            加入截圖
                            <input id="message-screenshots" name="screenshots[]" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target="message-preview">
                        </label>
                        <button type="submit" class="inline-flex min-h-10 items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">送出訊息</button>
                    </div>
                    <div id="message-preview" class="grid grid-cols-3 gap-3 sm:grid-cols-5" aria-live="polite"></div>
                </form>
            </section>
        </div>

        <aside class="grid gap-4 lg:sticky lg:top-6">
            @if ($canManage)
                <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <h2 class="text-sm font-semibold text-slate-950">更新狀態</h2>
                    <form method="POST" action="{{ route('feedback.reports.status.update', [$project, $report]) }}" class="mt-4 grid gap-3">
                        @csrf
                        @method('PATCH')
                        <label for="status" class="sr-only">處理狀態</label>
                        <x-feedback.status-select id="status" :status="$report->status" class="w-full" />
                        <button type="submit" class="rounded-lg bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-700 focus-visible:ring-offset-2">儲存狀態</button>
                    </form>
                </section>
            @endif

            <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 class="text-sm font-semibold text-slate-950">回報資訊</h2>
                <dl class="mt-4 grid gap-4 text-xs">
                    <div><dt class="text-slate-500">建立時間</dt><dd class="mt-1 font-medium text-slate-800"><x-feedback.time :at="$report->created_at" /></dd></div>
                    <div><dt class="text-slate-500">最後更新</dt><dd class="mt-1 font-medium text-slate-800"><x-feedback.time :at="$report->latest_activity_at" relative /></dd></div>
                </dl>
            </section>
        </aside>
    </div>
</x-feedback.layout>
