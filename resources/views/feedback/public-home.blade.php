@php
    $publicConfig = config('feedback.public_reporting');
    $inputClasses = 'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10';
@endphp
<x-feedback.layout :title="config('feedback.home.title')" max-width="max-w-3xl">
    <div class="grid gap-6">
        <section class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <p class="text-sm font-semibold text-teal-700">{{ config('feedback.home.eyebrow') }}</p>
            <h1 class="mt-2 text-3xl font-bold tracking-tight text-slate-950">{{ config('feedback.home.heading') }}</h1>
            @if (filled($publicConfig['intro']))
                <p class="mt-4 whitespace-pre-line text-sm leading-7 text-slate-600" data-public-intro>{{ $publicConfig['intro'] }}</p>
            @endif
            <p class="mt-4 text-sm leading-7 text-slate-600">送出後會得到一個私密網址，用它可以回來查看處理進度、補充說明。不需要註冊，也不用留 email。</p>
            @if (filled($publicConfig['github_url']) || filled($publicConfig['blog_url']))
                <p class="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
                    @if (filled($publicConfig['github_url']))
                        <a href="{{ $publicConfig['github_url'] }}" target="_blank" rel="noopener" class="text-teal-800 underline decoration-teal-300 underline-offset-4 hover:text-teal-950" data-public-github>GitHub</a>
                    @endif
                    @if (filled($publicConfig['blog_url']))
                        <a href="{{ $publicConfig['blog_url'] }}" target="_blank" rel="noopener" class="text-teal-800 underline decoration-teal-300 underline-offset-4 hover:text-teal-950" data-public-blog>部落格文章</a>
                    @endif
                </p>
            @endif
            @if (filled($publicConfig['notice']))
                <p class="mt-4 text-sm text-slate-600" data-public-notice>{{ $publicConfig['notice'] }}</p>
            @endif
        </section>

        @if ($myReports->isNotEmpty())
            <section class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" data-my-reports>
                <h2 class="text-base font-semibold text-slate-950">你送出的單</h2>
                <p class="mt-1 text-xs text-slate-500">只有這個瀏覽器看得到這份清單。換瀏覽器請用當初存下的私密網址。</p>
                <ul class="mt-4 divide-y divide-slate-100">
                    @foreach ($myReports as $myReport)
                        <li class="flex flex-wrap items-center justify-between gap-3 py-3">
                            <div class="min-w-0">
                                <a href="{{ route('feedback.reports.show', [$project, $myReport]) }}" class="block truncate text-sm font-semibold text-teal-800 hover:underline" data-my-report-link>{{ $myReport->title }}</a>
                                <x-feedback.time :at="$myReport->created_at" class="text-xs text-slate-500" />
                            </div>
                            <x-feedback.status-badge :status="$myReport->status" />
                        </li>
                    @endforeach
                </ul>
            </section>
        @endif

        <section class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 class="text-base font-semibold text-slate-950">回報問題</h2>

            @if ($errors->any())
                <div role="alert" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
                    <ul class="list-disc space-y-1 pl-5">@foreach ($errors->all() as $error)<li>{{ $error }}</li>@endforeach</ul>
                </div>
            @endif

            <form method="POST" action="{{ route('feedback.public.store') }}" enctype="multipart/form-data" class="mt-5 grid gap-5" data-public-report-form>
                @csrf
                <div>
                    <label for="title" class="mb-2 block text-sm font-semibold text-slate-800">標題 <span class="text-rose-600">*</span></label>
                    <input id="title" name="title" value="{{ old('title') }}" required maxlength="160" class="{{ $inputClasses }}">
                </div>
                <div>
                    <label for="description" class="mb-2 block text-sm font-semibold text-slate-800">說明 <span class="text-rose-600">*</span></label>
                    <textarea id="description" name="description" required maxlength="10000" rows="6" placeholder="請說明操作步驟、預期結果與實際結果。" class="{{ $inputClasses }} resize-y leading-6">{{ old('description') }}</textarea>
                </div>
                <div>
                    <label for="reporter_name" class="mb-2 block text-sm font-semibold text-slate-800">怎麼稱呼你 <span class="font-normal text-slate-500">（選填）</span></label>
                    <input id="reporter_name" name="reporter_name" value="{{ old('reporter_name') }}" maxlength="50" class="{{ $inputClasses }}">
                </div>
                <div>
                    <label for="screenshots" class="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 focus-within:ring-2 focus-within:ring-teal-600">＋ 上傳截圖<input id="screenshots" name="screenshots[]" type="file" accept="image/jpeg,image/png,image/webp" multiple class="sr-only" data-image-input data-preview-target="public-preview"></label>
                    <span class="ml-2 text-xs text-slate-500">選填，最多 {{ \App\Support\PublicReporting::MAX_SCREENSHOTS }} 張，每張 5 MB，jpg、png、webp。</span>
                    <div id="public-preview" class="mt-3 grid grid-cols-3 gap-3" aria-live="polite"></div>
                </div>

                <div aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden">
                    <label for="{{ \App\Http\Requests\Feedback\StorePublicFeedbackReportRequest::HONEYPOT_FIELD }}">Website</label>
                    <input id="{{ \App\Http\Requests\Feedback\StorePublicFeedbackReportRequest::HONEYPOT_FIELD }}" name="{{ \App\Http\Requests\Feedback\StorePublicFeedbackReportRequest::HONEYPOT_FIELD }}" type="text" tabindex="-1" autocomplete="off">
                </div>

                @if ($turnstileSiteKey)
                    <div class="cf-turnstile" data-sitekey="{{ $turnstileSiteKey }}" data-turnstile></div>
                    <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
                @endif

                <div>
                    <button type="submit" class="inline-flex min-h-10 items-center justify-center rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">送出回報</button>
                </div>
            </form>
        </section>
    </div>
</x-feedback.layout>
