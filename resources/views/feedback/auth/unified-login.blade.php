<x-feedback.layout :title="'管理者登入｜'.config('feedback.portal_title')">
    <section class="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p class="text-sm font-semibold text-teal-700">{{ config('feedback.labels.owner') }}</p>
        <h1 class="mt-1 text-2xl font-bold tracking-tight text-slate-950">管理者統一登入</h1>
        <p class="mt-2 text-sm leading-6 text-slate-600">請輸入{{ config('feedback.labels.owner') }}帳號密碼，登入後即可在各專案間直接切換管理，無須重複登入。</p>

        <form method="POST" action="{{ route('feedback.login.unified.store') }}" class="mt-6 grid gap-5">
            @csrf
            @error('username')
                <div role="alert" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{{ $message }}</div>
            @enderror
            @error('password')
                <div role="alert" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{{ $message }}</div>
            @enderror
            <div>
                <label for="username" class="mb-2 block text-sm font-semibold text-slate-800">帳號</label>
                <input id="username" name="username" value="{{ old('username', $prefillUsername) }}" required maxlength="50" autocomplete="username" autocapitalize="none" autofocus class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">
            </div>
            <div>
                <label for="password" class="mb-2 block text-sm font-semibold text-slate-800">密碼</label>
                <input id="password" name="password" type="password" value="{{ $prefillPassword }}" required maxlength="200" autocomplete="current-password" class="block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10">
            </div>
            <button type="submit" class="inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2">登入管理中心</button>
        </form>

        <div class="mt-6 border-t border-slate-100 pt-4 text-center">
            <p class="text-xs text-slate-500">客戶端或個別專案使用者，請使用專屬連結直接進入專案。</p>
        </div>
    </section>
</x-feedback.layout>
