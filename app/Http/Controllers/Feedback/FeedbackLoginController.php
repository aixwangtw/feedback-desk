<?php

namespace App\Http\Controllers\Feedback;

use App\Http\Controllers\Controller;
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

        return view('feedback.auth.login', ['project' => $feedbackProject]);
    }

    public function store(Request $request, FeedbackProject $feedbackProject, FeedbackAccess $access): RedirectResponse
    {
        $credentials = $request->validate([
            'username' => ['required', 'string', 'max:50'],
            'password' => ['required', 'string', 'max:200'],
        ], attributes: ['username' => '帳號', 'password' => '密碼']);

        $role = $this->authenticate($credentials['username'], $credentials['password']);

        if ($role === null) {
            throw ValidationException::withMessages(['username' => '帳號或密碼錯誤。']);
        }

        $request->session()->regenerate();

        $role === FeedbackAccess::ROLE_OWNER
            ? $access->grantOwner($feedbackProject, FeedbackAccess::SOURCE_PASSWORD)
            : $access->grantClient($feedbackProject, FeedbackAccess::SOURCE_PASSWORD);

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
     * @return FeedbackAccess::ROLE_*|null
     */
    private function authenticate(string $username, string $password): ?string
    {
        $role = in_array($username, [FeedbackAccess::ROLE_OWNER, FeedbackAccess::ROLE_CLIENT], true) ? $username : null;
        $hash = $role !== null ? config("feedback.accounts.{$role}.password_hash") : null;
        $hasUsableHash = is_string($hash) && $hash !== '';

        $matches = Hash::check($password, $hasUsableHash ? $hash : self::DUMMY_HASH);

        return $hasUsableHash && $matches ? $role : null;
    }
}
