<?php

namespace App\Http\Controllers\Feedback;

use App\Http\Controllers\Controller;
use App\Models\FeedbackApiToken;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Support\FeedbackAccess;
use App\Support\FeedbackAgentName;
use App\Support\FeedbackPasswordRules;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;

/**
 * 「我的帳號」：用帳號登入的人（團隊個人帳號、這個專案的客戶帳號）改自己的顯示名稱與密碼，
 * 以及建立給 AI 工具（MCP）用的 token。登入帳號不能改。
 */
class FeedbackAccountController extends Controller
{
    public const MAX_NAME_LENGTH = 100;

    private const PREFILLED = '這是登入頁公開預填的示範帳號，不能改密碼。';

    public function show(FeedbackProject $feedbackProject, FeedbackAccess $access): View
    {
        $this->ensureSignedIn($feedbackProject, $access);

        return $this->page($feedbackProject, $access);
    }

    public function updateName(Request $request, FeedbackProject $feedbackProject, FeedbackAccess $access): RedirectResponse
    {
        $account = $this->accountOrForbidden($feedbackProject, $access);
        $validated = $request->validateWithBag('name', [
            'name' => ['required', 'string', 'max:'.self::MAX_NAME_LENGTH],
        ], attributes: ['name' => '顯示名稱']);

        $name = trim($validated['name']);
        $account->forceFill(['name' => $name])->save();

        return redirect()->route('feedback.account', $feedbackProject)->with('success', "顯示名稱已改為「{$name}」。");
    }

    /**
     * 改密碼：輸入目前的密碼與新密碼。目前密碼輸錯跟登入一樣有次數限制。
     * 改好後其他裝置的網頁登入都登出，這個帳號的 API token 全部撤銷。
     */
    public function updatePassword(Request $request, FeedbackProject $feedbackProject, FeedbackAccess $access): RedirectResponse
    {
        $account = $this->accountOrForbidden($feedbackProject, $access);
        $back = redirect()->to(route('feedback.account', $feedbackProject).'#password');

        if ($this->isPrefilled($feedbackProject, $account)) {
            return $back->withErrors(['current_password' => self::PREFILLED], 'password');
        }

        $validated = $request->validateWithBag('password', [
            'current_password' => ['required', 'string', 'max:'.FeedbackPasswordRules::MAX_LENGTH],
            'new_password' => ['required', 'string', 'max:'.FeedbackPasswordRules::MAX_LENGTH],
            'new_password_confirmation' => ['required', 'string'],
        ], attributes: ['current_password' => '目前的密碼', 'new_password' => '新密碼', 'new_password_confirmation' => '再輸入一次新密碼']);

        $limits = $this->rateLimits($request, $account->username);
        foreach ($limits as $limit) {
            if (RateLimiter::tooManyAttempts($limit['key'], $limit['max'])) {
                throw new ThrottleRequestsException('Too Many Attempts.', headers: ['Retry-After' => RateLimiter::availableIn($limit['key'])]);
            }
        }

        if (! Hash::check($validated['current_password'], $account->password_hash)) {
            foreach ($limits as $limit) {
                RateLimiter::hit($limit['key'], $limit['decay']);
            }

            return $back->withErrors(['current_password' => '目前的密碼不正確。'], 'password');
        }
        RateLimiter::clear($limits[0]['key']);

        $problems = FeedbackPasswordRules::problems($validated['new_password'], $account->username);
        if ($problems === [] && $validated['new_password'] !== $validated['new_password_confirmation']) {
            $problems[] = '兩次輸入的新密碼不一樣。';
        }
        if ($problems !== []) {
            return $back->withErrors(['new_password' => $problems], 'password');
        }

        $oldHash = $account->password_hash;
        $newHash = Hash::make($validated['new_password']);

        $revoked = DB::transaction(function () use ($account, $oldHash, $newHash, $feedbackProject): ?int {
            // 只有密碼還是剛才確認過的那一個才換（同時有兩個請求在改時，後到的那個失敗）。
            $updated = $account->newQuery()
                ->whereKey($account->id)
                ->where('password_hash', $oldHash)
                ->update(['password_hash' => $newHash, 'password_set_by_self' => true, 'updated_at' => now()]);
            if ($updated === 0) {
                return null;
            }

            if ($account instanceof FeedbackClientAccount) {
                // 本人自己設定的密碼不會留在登入頁的預填裡。
                $feedbackProject->newQuery()
                    ->whereKey($account->feedback_project_id)
                    ->where('login_prefill_username', $account->username)
                    ->update(['login_prefill_username' => null, 'login_prefill_password' => null]);
            }

            return $account->apiTokens()->delete();
        });

        if ($revoked === null) {
            return $back->withErrors(['current_password' => '密碼剛剛已被改過，請重新操作。'], 'password');
        }

        $access->refreshAccountLogins($feedbackProject, $account->refresh());

        return redirect()->route('feedback.account', $feedbackProject)->with(
            'success',
            '已更新密碼。其他裝置上用這個帳號的登入都已登出'.($revoked > 0 ? "，{$revoked} 個 AI 工具（MCP）用的 token 也已撤銷，請重新建立" : '').'。',
        );
    }

    /**
     * 建立給 AI 工具用的 token。明文只在這個回應顯示一次。
     */
    public function storeToken(Request $request, FeedbackProject $feedbackProject, FeedbackAccess $access): Response
    {
        $account = $this->accountOrForbidden($feedbackProject, $access);
        $validated = $request->validateWithBag('token', [
            'agent' => ['nullable', 'string', 'max:'.FeedbackAgentName::MAX_LENGTH],
        ], attributes: ['agent' => 'AI 工具名稱']);

        $agent = FeedbackAgentName::normalize($validated['agent'] ?? null);
        abort_if($account->apiTokens()->count() >= 20, 422, '這個帳號的 token 已達 20 個，請先撤銷不用的。');
        $issued = FeedbackApiToken::issue($account, $agent !== null ? "{$agent} MCP" : 'MCP', $agent);

        return response($this->page($feedbackProject, $access, newToken: $issued['plain']))->header('Cache-Control', 'no-store');
    }

    public function destroyToken(FeedbackProject $feedbackProject, FeedbackApiToken $token, FeedbackAccess $access): RedirectResponse
    {
        $account = $this->accountOrForbidden($feedbackProject, $access);
        $ownsToken = $account instanceof FeedbackDeveloper
            ? $token->feedback_developer_id === $account->id
            : $token->feedback_client_account_id === $account->id;
        abort_unless($ownsToken, 404);

        $token->delete();

        return redirect()->to(route('feedback.account', $feedbackProject).'#tokens')->with('success', '已撤銷這個 token，用它連線的 AI 工具會立即失去權限。');
    }

    private function page(FeedbackProject $project, FeedbackAccess $access, ?string $newToken = null): View
    {
        $account = $access->currentAccount($project);

        return view('feedback.account', [
            'project' => $project,
            'account' => $account,
            'isDeveloper' => $account instanceof FeedbackDeveloper,
            'isOwner' => $access->isOwner($project),
            'isPrefilled' => $account !== null && $this->isPrefilled($project, $account),
            'tokens' => $account?->apiTokens()->latest('id')->get() ?? collect(),
            'newToken' => $newToken,
        ]);
    }

    private function ensureSignedIn(FeedbackProject $project, FeedbackAccess $access): void
    {
        if (! $access->canManage($project)) {
            $access->deny($project);
        }
    }

    private function accountOrForbidden(FeedbackProject $project, FeedbackAccess $access): FeedbackDeveloper|FeedbackClientAccount
    {
        $this->ensureSignedIn($project, $access);

        return $access->currentAccount($project) ?? abort(403, '用專屬連結或共用帳號登入時沒有帳號可以設定。');
    }

    /**
     * 登入頁把密碼公開預填的示範帳號：讓一個訪客改成自己的密碼，其他人就都進不來了。
     */
    private function isPrefilled(FeedbackProject $project, FeedbackDeveloper|FeedbackClientAccount $account): bool
    {
        if (! config('feedback.login_prefill.enabled')) {
            return false;
        }

        return $account instanceof FeedbackDeveloper
            ? filled(config('feedback.login_prefill.owner.username')) && config('feedback.login_prefill.owner.username') === $account->username
            : filled($project->login_prefill_username) && $project->login_prefill_username === $account->username;
    }

    /**
     * 與登入表單同一組失敗次數限制。
     *
     * @return list<array{key: string, max: int, decay: int}>
     */
    private function rateLimits(Request $request, string $username): array
    {
        $ip = (string) $request->ip();

        return [
            ['key' => 'feedback-login:'.mb_strtolower($username).'|'.$ip, 'max' => 5, 'decay' => 60],
            ['key' => 'feedback-login-ip:'.$ip, 'max' => 20, 'decay' => 60],
            ['key' => 'feedback-login-ip-hourly:'.$ip, 'max' => 50, 'decay' => 3600],
        ];
    }
}
