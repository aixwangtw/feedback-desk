<?php

namespace App\Http\Controllers\Feedback;

use App\Http\Controllers\Controller;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Support\FeedbackAccess;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

class FeedbackLoginController extends Controller
{
    /**
     * Placeholder bcrypt hash checked for unknown accounts so response time does not reveal valid usernames.
     */
    private const DUMMY_HASH = '$2y$12$4q4lJEBJ89NNvJEE1NUC3eNTmefz37YEHx304m5r5yB/XP2gCUmV2';

    public function show(FeedbackProject $feedbackProject, FeedbackAccess $access): View|RedirectResponse
    {
        if ($access->canManage($feedbackProject)) {
            return redirect()->intended(route('feedback.portal', $feedbackProject));
        }

        $prefillEnabled = (bool) config('feedback.login_prefill.enabled');

        return view('feedback.auth.login', [
            'project' => $feedbackProject,
            'isOwnerLogin' => false,
            'prefillUsername' => $prefillEnabled ? (string) $feedbackProject->login_prefill_username : '',
            'prefillPassword' => $prefillEnabled ? (string) $feedbackProject->login_prefill_password : '',
        ]);
    }

    /**
     * Owner login form, pre-filled with the owner account; a teacher session
     * still sees the form so it can switch to the owner account.
     */
    public function showOwner(FeedbackProject $feedbackProject, FeedbackAccess $access): View|RedirectResponse
    {
        if ($access->isOwner($feedbackProject)) {
            return redirect()->intended(route('feedback.owner.index', $feedbackProject));
        }

        $prefillEnabled = (bool) config('feedback.login_prefill.enabled');

        return view('feedback.auth.login', [
            'project' => $feedbackProject,
            'isOwnerLogin' => true,
            'prefillUsername' => $prefillEnabled ? (string) config('feedback.login_prefill.owner.username') : '',
            'prefillPassword' => $prefillEnabled ? (string) config('feedback.login_prefill.owner.password') : '',
        ]);
    }

    public function store(Request $request, FeedbackProject $feedbackProject, FeedbackAccess $access): RedirectResponse
    {
        $credentials = $request->validate([
            'username' => ['required', 'string', 'max:50'],
            'password' => ['required', 'string', 'max:200'],
        ], attributes: ['username' => '帳號', 'password' => '密碼']);

        $limits = $this->rateLimits($request);
        $this->ensureNotRateLimited($limits);

        [$role, $account] = $this->authenticate($feedbackProject, $credentials['username'], $credentials['password']);

        if ($role === null) {
            foreach ($limits as $limit) {
                RateLimiter::hit($limit['key'], $limit['decay']);
            }

            throw ValidationException::withMessages(['username' => '帳號或密碼錯誤。']);
        }

        RateLimiter::clear($limits[0]['key']);

        $request->session()->regenerate();

        if ($account instanceof FeedbackDeveloper) {
            $access->grantDeveloper($feedbackProject, $account);
        } elseif ($account instanceof FeedbackClientAccount) {
            $access->grantClientAccount($feedbackProject, $account);
        } else {
            $access->grantOwner($feedbackProject, FeedbackAccess::SOURCE_PASSWORD);
        }

        return redirect()->intended(route('feedback.portal', $feedbackProject));
    }

    /**
     * 只有登入失敗才計次：帳號+IP 每分鐘 5 次、IP 每分鐘 20 次、IP 每小時 50 次。
     *
     * @return list<array{key: string, max: int, decay: int}>
     */
    private function rateLimits(Request $request): array
    {
        $ip = (string) $request->ip();

        return [
            ['key' => 'feedback-login:'.mb_strtolower((string) $request->input('username')).'|'.$ip, 'max' => 5, 'decay' => 60],
            ['key' => 'feedback-login-ip:'.$ip, 'max' => 20, 'decay' => 60],
            ['key' => 'feedback-login-ip-hourly:'.$ip, 'max' => 50, 'decay' => 3600],
        ];
    }

    /**
     * 超過上限時回 429（與原 throttle middleware 相同的例外與 Retry-After 標頭）。
     *
     * @param  list<array{key: string, max: int, decay: int}>  $limits
     */
    private function ensureNotRateLimited(array $limits): void
    {
        foreach ($limits as $limit) {
            if (RateLimiter::tooManyAttempts($limit['key'], $limit['max'])) {
                $retryAfter = RateLimiter::availableIn($limit['key']);

                throw new ThrottleRequestsException('Too Many Attempts.', headers: [
                    'Retry-After' => $retryAfter,
                    'X-RateLimit-Limit' => $limit['max'],
                    'X-RateLimit-Remaining' => 0,
                ]);
            }
        }
    }

    public function destroy(Request $request, FeedbackProject $feedbackProject, FeedbackAccess $access): RedirectResponse
    {
        $access->revoke($feedbackProject);
        $request->session()->regenerate(true);
        $request->session()->regenerateToken();

        return redirect()->route('feedback.login', $feedbackProject)->with('success', '已登出。');
    }

    /**
     * 共用 owner 帳號優先比對，其次是開發者個人帳號（登入後同為 owner 身分），最後是這個專案的客戶帳號
     * （每位客戶一個，只對自己的專案有效）。停用的客戶帳號跟不存在的帳號一樣處理，花的時間與錯誤訊息都相同。
     *
     * @return array{0: FeedbackAccess::ROLE_*|null, 1: FeedbackDeveloper|FeedbackClientAccount|null}
     */
    private function authenticate(FeedbackProject $project, string $username, string $password): array
    {
        $account = null;
        $role = null;
        $hash = null;

        $sharedOwnerUsername = (string) config('feedback.accounts.owner.username');

        if ($sharedOwnerUsername !== '' && hash_equals($sharedOwnerUsername, $username)) {
            $role = FeedbackAccess::ROLE_OWNER;
            $hash = config('feedback.accounts.owner.password_hash');
        } elseif ($account = FeedbackDeveloper::where('username', $username)->first()) {
            $role = FeedbackAccess::ROLE_OWNER;
            $hash = $account->password_hash;
        } elseif ($account = $project->clientAccounts()->where('username', $username)->whereNull('disabled_at')->first()) {
            $role = FeedbackAccess::ROLE_CLIENT;
            $hash = $account->password_hash;
        }

        $hasUsableHash = is_string($hash) && $hash !== '';
        $matches = Hash::check($password, $hasUsableHash ? $hash : self::DUMMY_HASH);

        return $hasUsableHash && $matches ? [$role, $account] : [null, null];
    }
}
