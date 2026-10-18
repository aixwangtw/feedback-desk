<x-feedback.layout :title="config('feedback.home.title')">
    <section class="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-12">
        <span class="mx-auto grid size-14 place-items-center rounded-2xl bg-teal-700 text-xl font-bold text-white shadow-sm">回</span>
        <p class="mt-6 text-sm font-semibold text-teal-700">{{ config('feedback.home.eyebrow') }}</p>
        <h1 class="mt-2 text-3xl font-bold tracking-tight text-slate-950">{{ config('feedback.home.heading') }}</h1>
        <p class="mt-4 text-sm leading-7 text-slate-600">{{ config('feedback.home.body') }}</p>
    </section>
</x-feedback.layout>
