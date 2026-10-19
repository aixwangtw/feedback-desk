<?php

namespace App\Support;

use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * 客戶帳號的新增、重設、停用、刪除，以及主機管理者救回忘記的密碼。artisan 指令與 MCP 共用。
 * 本人自己設定的密碼（password_set_by_self）其他人不能重設，帳號也不能刪除；忘記時只有能進主機的人用 recover 救回。
 */
class FeedbackClientAccountManager
{
    public const GENERATED_PASSWORD_LENGTH = 24;

    public const MAX_USERNAME_LENGTH = 50;

    public const SELF_SET_PASSWORD_LOCKED = '這個帳號的密碼是本人自己設定的，其他人不能重設或改掉。本人登入網頁後可以在「我的帳號」自己改；本人忘記密碼時，請能進主機的管理者執行 php artisan feedback:account-recover。';

    /**
     * 帳號名稱在整個站不可重複（團隊帳號、共用帳號與所有專案的客戶帳號，不分大小寫）。
     * 改版前搬過來的客戶帳號可能跨專案同名，不受影響。
     */
    public function usernameTaken(string $username): bool
    {
        $lower = mb_strtolower($username);
        $reserved = array_filter([
            config('feedback.accounts.owner.username'),
            config('feedback.accounts.client.username'),
        ], fn ($value): bool => is_string($value) && $value !== '');

        foreach ($reserved as $name) {
            if (mb_strtolower($name) === $lower) {
                return true;
            }
        }

        return FeedbackDeveloper::query()->whereRaw('lower(username) = ?', [$lower])->exists()
            || FeedbackClientAccount::query()->whereRaw('lower(username) = ?', [$lower])->exists();
    }

    public function usernameProblem(string $username): ?string
    {
        if ($username === '' || mb_strlen($username) > self::MAX_USERNAME_LENGTH) {
            return '帳號不可為空白，且不可超過 '.self::MAX_USERNAME_LENGTH.' 字。';
        }

        if (preg_match('/[\s\p{C}]/u', $username) === 1) {
            return '帳號不能有空白或控制字元。';
        }

        return null;
    }

    /**
     * 新增客戶帳號，密碼由系統產生（或主機管理者用 --password 指定）。
     *
     * @return array{account: FeedbackClientAccount, password: string}
     */
    public function create(FeedbackProject $project, string $username, ?string $name = null, ?string $password = null, bool $prefill = false): array
    {
        $username = trim($username);
        $problem = $this->usernameProblem($username);
        if ($problem !== null) {
            throw new FeedbackServiceException('invalid_username', $problem);
        }
        if ($this->usernameTaken($username)) {
            throw new FeedbackServiceException('username_taken', '這個帳號名稱已經有人用了（團隊帳號與所有專案的客戶帳號共用，不分大小寫），請換一個。', 409);
        }

        $name = trim((string) $name);
        if (mb_strlen($name) > 100) {
            throw new FeedbackServiceException('invalid_name', '顯示名稱不可超過 100 字。');
        }

        $password ??= $this->generatePassword();
        $account = DB::transaction(function () use ($project, $username, $name, $password, $prefill): FeedbackClientAccount {
            $account = $project->clientAccounts()->create([
                'username' => $username,
                'name' => $name !== '' ? $name : $username,
                'password_hash' => Hash::make($password),
            ]);

            if ($prefill) {
                $project->update(['login_prefill_username' => $username, 'login_prefill_password' => $password]);
            }

            return $account;
        });

        return ['account' => $account, 'password' => $password];
    }

    /**
     * 重設系統產生的密碼；本人自己設定的密碼不能重設。登入與 token 全部失效。
     */
    public function reset(FeedbackClientAccount $account, ?string $password = null, bool $prefill = false): string
    {
        if ($account->password_set_by_self) {
            throw new FeedbackServiceException('password_set_by_self', self::SELF_SET_PASSWORD_LOCKED, 403);
        }

        $password ??= $this->generatePassword();
        DB::transaction(function () use ($account, $password, $prefill): void {
            $account->forceFill(['password_hash' => Hash::make($password)])->save();
            $account->apiTokens()->delete();

            $project = $account->feedbackProject;
            if ($prefill) {
                $project->update(['login_prefill_username' => $account->username, 'login_prefill_password' => $password]);
            } elseif ($project->login_prefill_username === $account->username) {
                $project->update(['login_prefill_username' => null, 'login_prefill_password' => null]);
            }
        });

        return $password;
    }

    /**
     * 停用後立即不能登入，token 也撤銷；寫過的單與留言保留。
     */
    public function setDisabled(FeedbackClientAccount $account, bool $disabled): void
    {
        DB::transaction(function () use ($account, $disabled): void {
            $account->forceFill(['disabled_at' => $disabled ? ($account->disabled_at ?? now()) : null])->save();
            if ($disabled) {
                $account->apiTokens()->delete();
            }
        });
    }

    /**
     * 刪除帳號；寫過的單與留言保留，建立者改顯示客戶稱呼。本人自設密碼的帳號不能刪（請改用停用）。
     */
    public function delete(FeedbackClientAccount $account): void
    {
        if ($account->password_set_by_self) {
            throw new FeedbackServiceException('password_set_by_self', '這個帳號的密碼是本人自己設定的，不能刪除（刪掉再建一個同名的，等於替他改密碼）。不讓他登入請改用停用。', 403);
        }

        $account->delete();
    }

    /**
     * 主機管理者救回忘記的密碼（含本人自設的）：產生新的隨機密碼，回到「系統產生」，登入與 token 全部失效。
     */
    public function recover(FeedbackDeveloper|FeedbackClientAccount $account): string
    {
        $password = $this->generatePassword();
        DB::transaction(function () use ($account, $password): void {
            $account->forceFill(['password_hash' => Hash::make($password), 'password_set_by_self' => false])->save();
            $account->apiTokens()->delete();
        });

        return $password;
    }

    public function generatePassword(): string
    {
        return Str::password(self::GENERATED_PASSWORD_LENGTH, symbols: false);
    }
}
