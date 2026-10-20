<x-feedback.layout :title="config('feedback.home.title')">
    <section class="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-12">
        <span class="mx-auto grid size-14 place-items-center rounded-2xl bg-teal-700 text-xl font-bold text-white shadow-sm">回</span>
        <p class="mt-6 text-sm font-semibold text-teal-700">{{ config('feedback.home.eyebrow') }}</p>
        <h1 class="mt-2 text-3xl font-bold tracking-tight text-slate-950">{{ config('feedback.home.heading') }}</h1>
        <p class="mt-4 text-sm leading-7 text-slate-600">{{ config('feedback.home.body') }}</p>
        <div class="mt-8 flex justify-center">
            <a href="{{ route('feedback.login.unified') }}" class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">管理者登入</a>
        </div>
    </section>
</x-feedback.layout>
