@php
    $input = 'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-3 text-sm shadow-sm outline-none transition focus:border-teal-600 focus:ring-4 focus:ring-teal-600/10';
    $primary = 'inline-flex min-h-11 items-center justify-center rounded-xl bg-teal-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2';
    $nameErrors = $errors->getBag('name');
    $passwordErrors = $errors->getBag('password');
    $tokenErrors = $errors->getBag('token');
    $categoryErrors = $errors->getBag('categories');
@endphp
<x-feedback.layout :title="'我的帳號｜'.$project->name" :$project>
    <x-slot:headerAction>
        <a href="{{ route('feedback.portal', $project) }}" class="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600">返回問題清單</a>
    </x-slot:headerAction>

    <div class="mx-auto grid max-w-md gap-6" data-account-page>
        <section class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <p class="text-sm font-semibold text-teal-700">{{ $project->name }}</p>
            <h1 class="mt-1 text-2xl font-bold tracking-tight text-slate-950">我的帳號</h1>
            @if (! $account)
                <p class="mt-4 text-sm leading-6 text-slate-600" data-account-no-account>你是用專屬連結或共用帳號登入的，沒有個人帳號可以設定。要用個人帳號登入，請先登出，再用帳號密碼登入後回到這一頁。</p>
            @else
                <p class="mt-2 text-sm leading-6 text-slate-600">
                    登入帳號：<span class="font-semibold text-slate-900" data-account-username>{{ $account->username }}</span>{{ $isDeveloper ? '（'.config('feedback.labels.owner').'個人帳號，所有專案共用）' : '（這個專案的'.config('feedback.labels.client').'帳號）' }}。登入帳號不能改。
                </p>
                <form method="POST" action="{{ route('feedback.account.name', $project) }}" class="mt-5 grid gap-3" data-account-name-form>
                    @csrf
                    @if ($nameErrors->any())
                        <div role="alert" class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">@foreach ($nameErrors->all() as $error)<p>{{ $error }}</p>@endforeach</div>
                    @endif
                    <div>
                        <label for="name" class="mb-2 block text-sm font-semibold text-slate-800">顯示名稱</label>
                        <input id="name" name="name" value="{{ $nameErrors->any() ? old('name') : $account->name }}" required maxlength="{{ \App\Http\Controllers\Feedback\FeedbackAccountController::MAX_NAME_LENGTH }}" autocomplete="name" class="{{ $input }}">
                        <p class="mt-1.5 text-xs text-slate-500">回報單、留言與對話面板上顯示的名字。</p>
                    </div>
                    <button type="submit" class="{{ $primary }}">儲存名稱</button>
                </form>
            @endif
        </section>

        @if ($account)
            <section id="password" class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" data-password-section>
                <h2 class="text-lg font-bold text-slate-950">改密碼</h2>
                <p class="mt-1 text-sm text-slate-600" data-password-state>目前的密碼：{{ $account->password_set_by_self ? '你自己設定的（其他成員不能重設）' : '系統產生的' }}</p>
                <ul class="mt-4 grid gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700" data-password-rules>
                    <li>建議用密碼管理器（例如 1Password、Bitwarden 或瀏覽器內建的）產生一組新密碼，再貼到這裡。</li>
                    <li>至少 {{ \App\Support\FeedbackPasswordRules::MIN_LENGTH }} 個字；不能全是同一個字、不能是連續字元，也不能包含登入帳號。</li>
                    <li>改好後，其他裝置上的登入都會登出，AI 工具（MCP）用的 token 也會撤銷，要重新建立。</li>
                    <li>自己設定的密碼，其他成員不能重設或改掉。忘記時只有能進主機的管理者能救回。</li>
                </ul>
                @if ($passwordErrors->any())
                    <div role="alert" class="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" data-password-errors>@foreach ($passwordErrors->all() as $error)<p>{{ $error }}</p>@endforeach</div>
                @endif
                @if ($isPrefilled)
                    <p class="mt-5 text-sm text-slate-600">這是登入頁公開預填的示範帳號，不能改密碼。</p>
                @else
                    <form method="POST" action="{{ route('feedback.account.password', $project) }}" class="mt-6 grid gap-5" data-password-form>
                        @csrf
                        <input type="text" name="username" value="{{ $account->username }}" autocomplete="username" readonly hidden>
                        <div>
                            <label for="current_password" class="mb-2 block text-sm font-semibold text-slate-800">目前的密碼</label>
                            <input id="current_password" name="current_password" type="password" required maxlength="{{ \App\Support\FeedbackPasswordRules::MAX_LENGTH }}" autocomplete="current-password" class="{{ $input }}">
                        </div>
                        <div>
                            <label for="new_password" class="mb-2 block text-sm font-semibold text-slate-800">新密碼</label>
                            <input id="new_password" name="new_password" type="password" required minlength="{{ \App\Support\FeedbackPasswordRules::MIN_LENGTH }}" maxlength="{{ \App\Support\FeedbackPasswordRules::MAX_LENGTH }}" autocomplete="new-password" class="{{ $input }}">
                        </div>
                        <div>
                            <label for="new_password_confirmation" class="mb-2 block text-sm font-semibold text-slate-800">再輸入一次新密碼</label>
                            <input id="new_password_confirmation" name="new_password_confirmation" type="password" required minlength="{{ \App\Support\FeedbackPasswordRules::MIN_LENGTH }}" maxlength="{{ \App\Support\FeedbackPasswordRules::MAX_LENGTH }}" autocomplete="new-password" class="{{ $input }}">
                        </div>
                        <button type="submit" class="{{ $primary }}">更新密碼</button>
                    </form>
                @endif
            </section>

            <section id="tokens" class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" data-token-section>
                <h2 class="text-lg font-bold text-slate-950">AI 工具連線（MCP）</h2>
                <p class="mt-1 text-sm leading-6 text-slate-600">
                    給 Claude Code、Codex 或其他支援 MCP 的 AI 工具用。AI 做的事會記在你名下，{{ $isDeveloper ? '畫面只顯示「'.$account->name.'」。' : '畫面顯示「'.$account->name.'（工具名稱）」。' }}
                    {{ $isDeveloper ? '團隊帳號可以處理所有專案的單。' : '客戶帳號只能看這個專案的單、開單與留言。' }}
                </p>
                @if ($newToken)
                    <div class="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" data-new-token>
                        <p class="font-semibold">token 只顯示這一次，請立刻存進密碼管理器。</p>
                        <input readonly value="{{ $newToken }}" onfocus="this.select()" aria-label="新的 token" class="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-slate-900" data-copy-source>
                        <p class="mt-3 text-xs leading-5">MCP 網址：<span class="font-mono">{{ route('feedback.mcp') }}</span>，標頭 <span class="font-mono">Authorization: Bearer &lt;token&gt;</span>。</p>
                        <p class="mt-1 text-xs leading-5">Codex 範例（先 <span class="font-mono">export FEEDBACK_DESK_MCP_TOKEN=&lt;token&gt;</span>）：<span class="break-all font-mono">codex mcp add feedback-desk --url {{ route('feedback.mcp') }} --bearer-token-env-var FEEDBACK_DESK_MCP_TOKEN</span></p>
                        <p class="mt-1 text-xs leading-5">Claude Code 範例：<span class="break-all font-mono">claude mcp add --transport http feedback-desk {{ route('feedback.mcp') }} --header "Authorization: Bearer $FEEDBACK_DESK_MCP_TOKEN"</span></p>
                    </div>
                @endif
                @if ($tokenErrors->any())
                    <div role="alert" class="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">@foreach ($tokenErrors->all() as $error)<p>{{ $error }}</p>@endforeach</div>
                @endif
                <form method="POST" action="{{ route('feedback.account.tokens.store', $project) }}" class="mt-5 grid gap-3" data-token-form>
                    @csrf
                    <div>
                        <label for="agent" class="mb-2 block text-sm font-semibold text-slate-800">AI 工具名稱（選填）</label>
                        <input id="agent" name="agent" maxlength="{{ \App\Support\FeedbackAgentName::MAX_LENGTH }}" placeholder="例如 Claude Code、Codex" class="{{ $input }}">
                        <p class="mt-1.5 text-xs text-slate-500">沒填的話，用 AI 工具連線時自報的名稱。名稱是自報的標籤，身分以你的帳號為準。</p>
                    </div>
                    <button type="submit" class="{{ $primary }}">建立 token</button>
                </form>
                @if ($tokens->isNotEmpty())
                    <ul class="mt-5 grid gap-2 text-sm" data-token-list>
                        @foreach ($tokens as $token)
                            <li class="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2">
                                <span class="min-w-0">
                                    <span class="block truncate font-semibold text-slate-800">{{ $token->agentName() ?? $token->name }}</span>
                                    <span class="block text-xs text-slate-500">建立 <x-feedback.time :at="$token->created_at" />@if ($token->last_used_at) · 最後使用 <x-feedback.time :at="$token->last_used_at" relative />@endif</span>
                                </span>
                                <form method="POST" action="{{ route('feedback.account.tokens.destroy', [$project, $token]) }}">
                                    @csrf
                                    @method('DELETE')
                                    <button type="submit" class="shrink-0 rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50" data-token-revoke>撤銷</button>
                                </form>
                            </li>
                        @endforeach
                    </ul>
                @endif
            </section>
        @endif
        @if ($isOwner)
            <section id="project-settings" class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" data-project-settings>
                <h2 class="text-lg font-bold text-slate-950">專案設定</h2>
                <p class="mt-1 text-sm text-slate-600">只有開發者看得到。改動會套用到「{{ $project->name }}」的所有人。</p>
                @if ($categoryErrors->any())
                    <p class="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{{ $categoryErrors->first() }}</p>
                @endif
                <form method="POST" action="{{ route('feedback.project.categories', $project) }}" class="mt-5 grid gap-3" data-categories-form>
                    @csrf
                    @method('PUT')
                    <label for="report-categories" class="text-sm font-semibold text-slate-800">開單分類</label>
                    <input id="report-categories" name="categories" type="text" maxlength="{{ \App\Http\Controllers\Feedback\FeedbackProjectSettingsController::MAX_INPUT_LENGTH }}" value="{{ old('categories', implode(',', $project->reportCategories())) }}" placeholder="例如：程式使用問題,版面排版,其他" class="{{ $input }}" data-categories-input>
                    <p class="text-xs leading-5 text-slate-500">用逗號分隔，依序顯示在下拉選單。留空就不分類，開單與清單都不顯示分類欄位。已經分好類的單不會被改掉。</p>
                    <button type="submit" class="{{ $primary }}">儲存分類</button>
                </form>
            </section>
        @endif
    </div>
</x-feedback.layout>
