<?php

namespace App\Http\Controllers\Feedback;

use App\Http\Controllers\Controller;
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

        return view('feedback.auth.login', [
            'project' => $feedbackProject,
            'isOwnerLogin' => false,
            'prefillUsername' => (string) $feedbackProject->login_prefill_username,
            'prefillPassword' => (string) $feedbackProject->login_prefill_password,
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

        return view('feedback.auth.login', [
            'project' => $feedbackProject,
            'isOwnerLogin' => true,
            'prefillUsername' => (string) config('feedback.login_prefill.owner.username'),
            'prefillPassword' => (string) config('feedback.login_prefill.owner.password'),
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

        [$role, $developer] = $this->authenticate($feedbackProject, $credentials['username'], $credentials['password']);

        if ($role === null) {
            foreach ($limits as $limit) {
                RateLimiter::hit($limit['key'], $limit['decay']);
            }

            throw ValidationException::withMessages(['username' => '帳號或密碼錯誤。']);
        }

        RateLimiter::clear($limits[0]['key']);

        $request->session()->regenerate();

        if ($developer !== null) {
            $access->grantDeveloper($feedbackProject, $developer);
        } elseif ($role === FeedbackAccess::ROLE_OWNER) {
            $access->grantOwner($feedbackProject, FeedbackAccess::SOURCE_PASSWORD);
        } else {
            $access->grantClient($feedbackProject, FeedbackAccess::SOURCE_PASSWORD);
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
     * 共用 owner 帳號優先比對，其次是開發者個人帳號（登入後同為 owner 身分），最後是該專案自己的老師帳號。
     * 老師帳號只認專案本身的設定，不退回全域設定。
     *
     * @return array{0: FeedbackAccess::ROLE_*|null, 1: FeedbackDeveloper|null}
     */
    private function authenticate(FeedbackProject $project, string $username, string $password): array
    {
        $developer = null;
        $role = null;

        if (hash_equals((string) config('feedback.accounts.owner.username'), $username)) {
            $role = FeedbackAccess::ROLE_OWNER;
            $hash = config('feedback.accounts.owner.password_hash');
        } elseif ($developer = FeedbackDeveloper::where('username', $username)->first()) {
            $role = FeedbackAccess::ROLE_OWNER;
            $hash = $developer->password_hash;
        } elseif (filled($project->client_username) && hash_equals($project->client_username, $username)) {
            $role = FeedbackAccess::ROLE_CLIENT;
            $hash = $project->client_password_hash;
        } else {
            $hash = null;
        }

        $hasUsableHash = is_string($hash) && $hash !== '';
        $matches = Hash::check($password, $hasUsableHash ? $hash : self::DUMMY_HASH);

        return $hasUsableHash && $matches ? [$role, $developer] : [null, null];
    }
}
