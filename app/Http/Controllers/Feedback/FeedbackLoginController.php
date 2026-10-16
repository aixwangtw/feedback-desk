<?php

namespace App\Http\Controllers\Feedback;

use App\Http\Controllers\Controller;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Support\FeedbackAccess;
use Illuminate\Contracts\View\View;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
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
            'prefillUsername' => (string) config('feedback.login_prefill.client.username'),
            'prefillPassword' => (string) config('feedback.login_prefill.client.password'),
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

        [$role, $developer] = $this->authenticate($credentials['username'], $credentials['password']);

        if ($role === null) {
            throw ValidationException::withMessages(['username' => '帳號或密碼錯誤。']);
        }

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

    public function destroy(Request $request, FeedbackProject $feedbackProject, FeedbackAccess $access): RedirectResponse
    {
        $access->revoke($feedbackProject);
        $request->session()->regenerate(true);
        $request->session()->regenerateToken();

        return redirect()->route('feedback.login', $feedbackProject)->with('success', '已登出。');
    }

    /**
     * 共用帳號優先比對，其次是開發者個人帳號（登入後同為 owner 身分）。
     *
     * @return array{0: FeedbackAccess::ROLE_*|null, 1: FeedbackDeveloper|null}
     */
    private function authenticate(string $username, string $password): array
    {
        $role = collect([FeedbackAccess::ROLE_OWNER, FeedbackAccess::ROLE_CLIENT])
            ->first(fn (string $role): bool => hash_equals((string) config("feedback.accounts.{$role}.username"), $username));
        $developer = $role === null ? FeedbackDeveloper::where('username', $username)->first() : null;

        $hash = $role !== null ? config("feedback.accounts.{$role}.password_hash") : $developer?->password_hash;
        $hasUsableHash = is_string($hash) && $hash !== '';

        $matches = Hash::check($password, $hasUsableHash ? $hash : self::DUMMY_HASH);

        if (! $hasUsableHash || ! $matches) {
            return [null, null];
        }

        return $developer !== null ? [FeedbackAccess::ROLE_OWNER, $developer] : [$role, null];
    }
}
