<?php

namespace App\Support;

use App\Enums\FeedbackCreatorType;
use App\Models\FeedbackClientAccount;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Contracts\Cookie\QueueingFactory as CookieJar;
use Illuminate\Contracts\Session\Session;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

class FeedbackAccess
{
    public const COOKIE_NAME = 'feedback_access';

    public const COOKIE_DAYS = 30;

    public const PUBLIC_COOKIE_NAME = 'feedback_public_reports';

    public const PUBLIC_COOKIE_DAYS = 180;

    public const PUBLIC_COOKIE_MAX_REPORTS = 15;

    public const ROLE_OWNER = 'owner';

    public const ROLE_CLIENT = 'client';

    public const SOURCE_LINK = 'link';

    /**
     * 共用 owner 帳號的帳密登入。改版前的客戶帳密登入也是這個值，搬到第一個客戶帳號後仍有效。
     */
    public const SOURCE_PASSWORD = 'password';

    public const SOURCE_DEVELOPER = 'developer';

    /**
     * 客戶帳號登入（每位客戶一個帳號）。
     */
    public const SOURCE_CLIENT_ACCOUNT = 'client_account';

    /**
     * @var array<int, FeedbackDeveloper|null>
     */
    private array $developers = [];

    /**
     * @var array<int, FeedbackClientAccount|null>
     */
    private array $clientAccounts = [];

    public function __construct(
        private Session $session,
        private Request $request,
        private CookieJar $cookies,
    ) {}

    public const COOKIE_GLOBAL_KEY = '_global';

    public function grantOwner(FeedbackProject $project, string $source = self::SOURCE_LINK): void
    {
        $this->session->put($this->ownerKey($project), true);
        $this->session->forget([$this->developerKey($project), $this->developerFingerprintKey($project)]);
        $this->rememberRole($project, self::ROLE_OWNER, $source);
    }

    /**
     * 開發者個人帳號登入：權限等同 owner，另外記下是哪位開發者。
     * 工作階段也綁定密碼雜湊，本人改密碼後其他裝置的登入立即失效。
     */
    public function grantDeveloper(FeedbackProject $project, FeedbackDeveloper $developer): void
    {
        $this->session->put($this->ownerKey($project), true);
        $this->session->put($this->developerKey($project), $developer->id);
        $this->session->put($this->developerFingerprintKey($project), $this->accountFingerprint($developer));
        $this->rememberRole($project, self::ROLE_OWNER, self::SOURCE_DEVELOPER, $developer);
    }

    /**
     * 全域管理者授權：開發者個人帳號在所有專案皆通行。
     */
    public function grantGlobalDeveloper(FeedbackDeveloper $developer): void
    {
        $this->session->put('feedback.global_owner', true);
        $this->session->put('feedback.global_developer_id', $developer->id);
        $this->session->put('feedback.global_developer_fp', $this->accountFingerprint($developer));
        $this->session->forget('feedback.global_owner_fp');

        $entries = $this->cookieEntries();
        $entries[self::COOKIE_GLOBAL_KEY][self::ROLE_OWNER] = [
            'source' => self::SOURCE_DEVELOPER,
            'developer_id' => $developer->id,
            'fingerprint' => $this->globalDeveloperFingerprint($developer),
            'expires_at' => now()->addDays(self::COOKIE_DAYS)->getTimestamp(),
        ];
        $this->queueCookie($entries);
    }

    /**
     * 全域管理者授權：共用 owner 帳號在所有專案皆通行。
     */
    public function grantGlobalOwner(string $source = self::SOURCE_PASSWORD): void
    {
        $fingerprint = $this->globalOwnerFingerprint();
        if ($fingerprint === null) {
            return;
        }

        $this->session->put('feedback.global_owner', true);
        $this->session->forget(['feedback.global_developer_id', 'feedback.global_developer_fp']);
        $this->session->put('feedback.global_owner_fp', $fingerprint);

        $entries = $this->cookieEntries();
        $entries[self::COOKIE_GLOBAL_KEY][self::ROLE_OWNER] = [
            'source' => $source,
            'fingerprint' => $fingerprint,
            'expires_at' => now()->addDays(self::COOKIE_DAYS)->getTimestamp(),
        ];
        $this->queueCookie($entries);
    }

    /**
     * 撤銷全域管理者授權。
     */
    public function revokeGlobal(): void
    {
        $this->session->forget([
            'feedback.global_owner',
            'feedback.global_developer_id',
            'feedback.global_developer_fp',
            'feedback.global_owner_fp',
        ]);

        $entries = $this->cookieEntries();
        unset($entries[self::COOKIE_GLOBAL_KEY]);
        $this->queueCookie($entries);
    }

    /**
     * 客戶帳號登入，只對自己的專案有效。
     */
    public function grantClientAccount(FeedbackProject $project, FeedbackClientAccount $account): void
    {
        $this->session->put($this->clientKey($project), true);
        $this->session->put($this->clientSourceKey($project), self::SOURCE_CLIENT_ACCOUNT);
        $this->session->put($this->clientAccountKey($project), $account->id);
        $this->session->put($this->clientAccountFingerprintKey($project), $this->accountFingerprint($account));
        $this->clientAccounts[$account->id] = $account;
        $this->rememberRole($project, self::ROLE_CLIENT, self::SOURCE_CLIENT_ACCOUNT, account: $account);
    }

    /**
     * 客戶專屬連結登入：沒有帳號，單與留言記成客戶端共用身分。
     */
    public function grantClient(FeedbackProject $project): void
    {
        $this->session->put($this->clientKey($project), true);
        $this->session->put($this->clientSourceKey($project), self::SOURCE_LINK);
        $this->session->forget([$this->clientAccountKey($project), $this->clientAccountFingerprintKey($project)]);
        $this->rememberRole($project, self::ROLE_CLIENT, self::SOURCE_LINK);
    }

    /**
     * 本人改密碼後：其他裝置綁著舊雜湊的登入全部失效，這個瀏覽器的登入改綁新雜湊，本人不用重新登入。
     * 團隊個人帳號在每個專案都能登入，所以這個瀏覽器裡每個專案的登入都要重簽。
     */
    public function refreshAccountLogins(FeedbackProject $project, FeedbackDeveloper|FeedbackClientAccount $account): void
    {
        $this->forgetAccountCache();

        if ($account instanceof FeedbackClientAccount) {
            $this->grantClientAccount($project, $account);

            return;
        }

        $this->developers[$account->id] = $account;
        $entries = $this->cookieEntries();
        foreach ($entries as $projectId => $roles) {
            $entry = $roles[self::ROLE_OWNER] ?? null;
            if (! is_array($entry) || ($entry['source'] ?? null) !== self::SOURCE_DEVELOPER || ($entry['developer_id'] ?? null) !== $account->id) {
                continue;
            }
            $other = FeedbackProject::find((int) $projectId);
            if ($other !== null) {
                $entries[$projectId][self::ROLE_OWNER]['fingerprint'] = $this->fingerprint($other, self::ROLE_OWNER, self::SOURCE_DEVELOPER, $account);
            }
        }
        $this->queueCookie($entries);

        foreach ($this->session->all() as $key => $value) {
            if (is_string($key) && preg_match('/^feedback\.developer\.(\d+)$/', $key, $matches) === 1 && $value === $account->id) {
                $this->session->put("feedback.developer_fp.{$matches[1]}", $this->accountFingerprint($account));
            }
        }

        $this->grantDeveloper($project, $account);
    }

    public function grantReporter(FeedbackReport $report): void
    {
        $this->session->put($this->reportKey($report), true);
    }

    /**
     * Remove every owner/client grant for the project from the session and the long-lived cookie.
     */
    public function revoke(FeedbackProject $project): void
    {
        $this->session->forget($this->allSessionKeys($project));

        $entries = $this->cookieEntries();
        unset($entries[(string) $project->id]);
        $this->queueCookie($entries);
    }

    public function isOwner(FeedbackProject $project): bool
    {
        if ($this->hasRole($project, self::ROLE_OWNER, $this->ownerKey($project))) {
            return true;
        }

        if ($this->hasGlobalOwner()) {
            $this->session->put($this->ownerKey($project), true);
            $globalDevId = $this->session->get('feedback.global_developer_id');
            if (is_int($globalDevId)) {
                $this->session->put($this->developerKey($project), $globalDevId);
                $this->session->put($this->developerFingerprintKey($project), $this->session->get('feedback.global_developer_fp'));
            }

            return true;
        }

        return false;
    }

    public function currentDeveloper(?FeedbackProject $project = null): ?FeedbackDeveloper
    {
        if ($project !== null && ! $this->isOwner($project)) {
            return null;
        }

        if ($project !== null) {
            $developerId = $this->session->get($this->developerKey($project));

            return is_int($developerId) ? $this->developer($developerId) : null;
        }

        if ($this->hasGlobalOwner()) {
            $developerId = $this->session->get('feedback.global_developer_id');
            if (is_int($developerId)) {
                return $this->developer($developerId);
            }
        }

        return null;
    }

    /**
     * 這個專案目前登入的客戶帳號；客戶專屬連結、團隊或未登入時為 null。
     */
    public function currentClientAccount(FeedbackProject $project): ?FeedbackClientAccount
    {
        if ($this->isOwner($project) || ! $this->isClient($project)) {
            return null;
        }

        $accountId = $this->session->get($this->clientAccountKey($project));

        return is_int($accountId) ? $this->clientAccount($accountId) : null;
    }

    /**
     * 用帳號登入（不是專屬連結、也不是共用 owner 帳號），才有「我的帳號」可以設定。
     */
    public function currentAccount(FeedbackProject $project): FeedbackDeveloper|FeedbackClientAccount|null
    {
        return $this->currentDeveloper($project) ?? $this->currentClientAccount($project);
    }

    /**
     * 客戶端已讀狀態與未讀數以誰為準：登入的客戶帳號各自計算；團隊、專屬連結與回報者用共用的（null）。
     */
    public function clientViewer(FeedbackProject $project): ?FeedbackClientAccount
    {
        return $this->currentClientAccount($project);
    }

    /**
     * 這個瀏覽器在專案裡寫東西時記錄的身分。
     */
    public function actor(FeedbackProject $project): FeedbackActor
    {
        if ($this->isOwner($project)) {
            $developer = $this->currentDeveloper($project);

            return $developer !== null ? FeedbackActor::developer($developer) : FeedbackActor::sharedOwner();
        }

        $account = $this->currentClientAccount($project);

        return $account !== null ? FeedbackActor::client($account) : FeedbackActor::sharedClient();
    }

    /**
     * 依目前登入身分決定新單的建立者。
     *
     * @return array{creator_type: FeedbackCreatorType, creator_developer_id: int|null, creator_client_account_id: int|null}
     */
    public function creatorFor(FeedbackProject $project): array
    {
        if (! $this->isOwner($project)) {
            return [
                'creator_type' => FeedbackCreatorType::Client,
                'creator_developer_id' => null,
                'creator_client_account_id' => $this->currentClientAccount($project)?->id,
            ];
        }

        $developer = $this->currentDeveloper($project);

        return $developer !== null
            ? ['creator_type' => FeedbackCreatorType::Developer, 'creator_developer_id' => $developer->id, 'creator_client_account_id' => null]
            : ['creator_type' => FeedbackCreatorType::OwnerShared, 'creator_developer_id' => null, 'creator_client_account_id' => null];
    }

    public function isClient(FeedbackProject $project): bool
    {
        return $this->hasRole($project, self::ROLE_CLIENT, $this->clientKey($project));
    }

    public function canManage(FeedbackProject $project): bool
    {
        return $this->isOwner($project) || $this->isClient($project);
    }

    public function canView(FeedbackReport $report): bool
    {
        return $this->canManage($report->feedbackProject)
            || $this->hasReporterGrant($report);
    }

    /**
     * 回報者身分：這個工作階段開過該單的私密網址，或公開回報的 token 還留在瀏覽器 cookie。
     */
    public function hasReporterGrant(FeedbackReport $report): bool
    {
        if ($this->session->get($this->reportKey($report), false)) {
            return true;
        }

        if (! $report->isPublicReport()) {
            return false;
        }

        $token = $this->publicReportTokens()[$report->public_id] ?? null;

        return is_string($token) && $this->validateReporterToken($report, $token);
    }

    /**
     * 公開回報者的單，連同 token 一起記在瀏覽器（加密、HttpOnly cookie），之後回來不必再貼私密網址。
     */
    public function rememberPublicReport(FeedbackReport $report, string $token): void
    {
        $tokens = $this->publicReportTokens();
        unset($tokens[$report->public_id]);
        $tokens[$report->public_id] = $token;
        $tokens = array_slice($tokens, -self::PUBLIC_COOKIE_MAX_REPORTS, null, true);

        $this->cookies->queue($this->cookies->make(
            self::PUBLIC_COOKIE_NAME,
            json_encode($tokens),
            self::PUBLIC_COOKIE_DAYS * 24 * 60,
        ));
    }

    /**
     * 這個瀏覽器記住的公開回報單：只回傳 token 仍有效、屬於該專案的單，新的在前。
     *
     * @return Collection<int, FeedbackReport>
     */
    public function rememberedPublicReports(FeedbackProject $project): Collection
    {
        $tokens = $this->publicReportTokens();
        if ($tokens === []) {
            return collect();
        }

        return FeedbackReport::query()
            ->where('feedback_project_id', $project->id)
            ->where('creator_type', FeedbackCreatorType::Public->value)
            ->whereIn('public_id', array_keys($tokens))
            ->withClientNewReplyCount(null)
            ->latest('created_at')
            ->latest('id')
            ->get()
            ->filter(fn (FeedbackReport $report): bool => $this->validateReporterToken($report, (string) $tokens[$report->public_id]))
            ->values();
    }

    /**
     * A report deleted by the teacher, or created by a developer, no longer exists for anyone but the owner.
     * A public report is visible only to the owner and to the reporter holding its private token.
     */
    public function ensureReportVisible(FeedbackReport $report): true
    {
        $isOwner = $this->isOwner($report->feedbackProject);

        if ($report->isPublicReport()) {
            abort_unless($isOwner || $this->hasReporterGrant($report), 404);

            return true;
        }

        abort_if(! $isOwner && ($report->isDeletedByClient() || ! $report->isCreatedByClient()), 404);

        return true;
    }

    /**
     * Stop the request: a visitor without any project access goes to the login page,
     * while a signed-in visitor lacking a stronger role still gets a 403.
     */
    public function deny(FeedbackProject $project, ?string $intendedUrl = null): never
    {
        if ($this->canManage($project) || $this->request->expectsJson()) {
            abort(403);
        }

        throw new HttpResponseException($this->redirectToLogin($project, $intendedUrl));
    }

    /**
     * Owner-only pages send anyone who is not the owner (guests and teachers alike)
     * to the owner login form so they can sign in with the owner account.
     */
    public function denyOwnerPage(FeedbackProject $project): never
    {
        if ($this->request->expectsJson() || ! $this->request->isMethod('GET')) {
            abort(403);
        }

        throw new HttpResponseException($this->redirectToLogin($project, loginRoute: 'feedback.owner.login'));
    }

    public function redirectToLogin(
        FeedbackProject $project,
        ?string $intendedUrl = null,
        string $loginRoute = 'feedback.login',
    ): RedirectResponse {
        $intendedUrl ??= $this->request->isMethod('GET')
            ? $this->request->fullUrl()
            : route('feedback.portal', $project);

        $this->session->put('url.intended', $intendedUrl);

        return redirect()->route($loginRoute, $project);
    }

    public function validateOwnerToken(FeedbackProject $project, string $token): bool
    {
        return hash_equals($project->owner_token_hash, hash('sha256', $token));
    }

    public function validateReporterToken(FeedbackReport $report, string $token): bool
    {
        return hash_equals($report->reporter_token_hash, hash('sha256', $token));
    }

    public function validateClientToken(FeedbackProject $project, string $token): bool
    {
        return is_string($project->client_token_hash)
            && hash_equals($project->client_token_hash, hash('sha256', $token));
    }

    /**
     * 帳號資料變了（改名、改密碼、停用）時，丟掉這次請求裡的快取。
     */
    public function forgetAccountCache(): void
    {
        $this->developers = [];
        $this->clientAccounts = [];
    }

    public function hasGlobalOwner(): bool
    {
        if ($this->session->get('feedback.global_owner', false) && $this->sessionGrantIsCurrentGlobal()) {
            return true;
        }

        $entries = $this->cookieEntries();
        $entry = $entries[self::COOKIE_GLOBAL_KEY][self::ROLE_OWNER] ?? null;
        if (is_array($entry) && $this->resolveGlobalEntry($entry)) {
            return true;
        }

        // 若工作階段已有任一專案的開發者帳號登入，自動升級為全域管理者工作階段，避免切換專案時被擋
        $developers = $this->session->get('feedback.developer');
        if (is_array($developers)) {
            foreach ($developers as $projectId => $developerId) {
                if (is_int($developerId)) {
                    $dev = $this->developer($developerId);
                    $fp = $this->session->get("feedback.developer_fp.{$projectId}");
                    if ($dev !== null && is_string($fp) && hash_equals($this->accountFingerprint($dev), $fp)) {
                        $this->session->put('feedback.global_owner', true);
                        $this->session->put('feedback.global_developer_id', $dev->id);
                        $this->session->put('feedback.global_developer_fp', $this->accountFingerprint($dev));
                        $this->session->forget('feedback.global_owner_fp');

                        return true;
                    }
                }
            }
        }

        return false;
    }

    private function sessionGrantIsCurrentGlobal(): bool
    {
        $developerId = $this->session->get('feedback.global_developer_id');
        if ($developerId !== null) {
            $developer = is_int($developerId) ? $this->developer($developerId) : null;
            $fingerprint = $this->session->get('feedback.global_developer_fp');
            if ($developer !== null && is_string($fingerprint) && hash_equals($this->accountFingerprint($developer), $fingerprint)) {
                return true;
            }

            $this->session->forget(['feedback.global_owner', 'feedback.global_developer_id', 'feedback.global_developer_fp']);

            return false;
        }

        $ownerFp = $this->session->get('feedback.global_owner_fp');
        $expectedFp = $this->globalOwnerFingerprint();
        if (is_string($ownerFp) && $expectedFp !== null && hash_equals($expectedFp, $ownerFp)) {
            return true;
        }

        $this->session->forget(['feedback.global_owner', 'feedback.global_owner_fp']);

        return false;
    }

    /**
     * @param  array{source?: mixed, fingerprint?: mixed, expires_at?: mixed, developer_id?: mixed}  $entry
     */
    private function resolveGlobalEntry(array $entry): bool
    {
        if (! is_int($entry['expires_at'] ?? null) || $entry['expires_at'] < now()->getTimestamp() || ! is_string($entry['fingerprint'] ?? null)) {
            return false;
        }

        $source = (string) ($entry['source'] ?? '');
        $fingerprint = $entry['fingerprint'];

        if ($source === self::SOURCE_DEVELOPER) {
            $developer = is_int($entry['developer_id'] ?? null) ? $this->developer($entry['developer_id']) : null;
            if ($developer !== null && hash_equals($this->globalDeveloperFingerprint($developer), $fingerprint)) {
                $this->session->put('feedback.global_owner', true);
                $this->session->put('feedback.global_developer_id', $developer->id);
                $this->session->put('feedback.global_developer_fp', $this->accountFingerprint($developer));
                $this->session->forget('feedback.global_owner_fp');

                return true;
            }

            return false;
        }

        if ($source === self::SOURCE_PASSWORD) {
            $expected = $this->globalOwnerFingerprint();
            if ($expected !== null && hash_equals($expected, $fingerprint)) {
                $this->session->put('feedback.global_owner', true);
                $this->session->forget(['feedback.global_developer_id', 'feedback.global_developer_fp']);
                $this->session->put('feedback.global_owner_fp', $expected);

                return true;
            }

            return false;
        }

        return false;
    }

    private function globalDeveloperFingerprint(FeedbackDeveloper $developer): string
    {
        return hash_hmac('sha256', "global|".self::ROLE_OWNER.'|'.self::SOURCE_DEVELOPER."|{$developer->id}|{$developer->password_hash}", (string) config('app.key'));
    }

    private function globalOwnerFingerprint(): ?string
    {
        $hash = config('feedback.accounts.owner.password_hash');
        if (! is_string($hash) || $hash === '') {
            return null;
        }

        return hash_hmac('sha256', "global|".self::ROLE_OWNER.'|'.self::SOURCE_PASSWORD."|{$hash}", (string) config('app.key'));
    }

    private function hasRole(FeedbackProject $project, string $role, string $sessionKey): bool
    {
        if ($this->session->get($sessionKey, false) && $this->sessionGrantIsCurrent($project, $role)) {
            return true;
        }

        $entry = $this->cookieEntries()[(string) $project->id][$role] ?? null;
        if (! is_array($entry)) {
            return false;
        }

        $resolved = $this->resolveEntry($project, $role, $entry);
        if ($resolved === null) {
            return false;
        }

        $this->session->put($sessionKey, true);
        if ($resolved instanceof FeedbackDeveloper) {
            $this->session->put($this->developerKey($project), $resolved->id);
            $this->session->put($this->developerFingerprintKey($project), $this->accountFingerprint($resolved));
        } elseif ($role === self::ROLE_OWNER) {
            $this->session->forget([$this->developerKey($project), $this->developerFingerprintKey($project)]);
        } elseif ($resolved instanceof FeedbackClientAccount) {
            $this->session->put($this->clientSourceKey($project), self::SOURCE_CLIENT_ACCOUNT);
            $this->session->put($this->clientAccountKey($project), $resolved->id);
            $this->session->put($this->clientAccountFingerprintKey($project), $this->accountFingerprint($resolved));
        } else {
            $this->session->put($this->clientSourceKey($project), self::SOURCE_LINK);
            $this->session->forget([$this->clientAccountKey($project), $this->clientAccountFingerprintKey($project)]);
        }

        return true;
    }

    /**
     * 工作階段裡的帳號登入跟著帳號目前的密碼走：本人改了密碼、帳號被停用或刪除，其他裝置的工作階段立即失效。
     * 改版前留下、沒有綁定的工作階段，改用長效 cookie 重新判斷一次。
     */
    private function sessionGrantIsCurrent(FeedbackProject $project, string $role): bool
    {
        if ($role === self::ROLE_OWNER) {
            $developerId = $this->session->get($this->developerKey($project));
            if ($developerId === null) {
                return true;
            }

            $developer = is_int($developerId) ? $this->developer($developerId) : null;
            $fingerprint = $this->session->get($this->developerFingerprintKey($project));
            if ($developer !== null && is_string($fingerprint) && hash_equals($this->accountFingerprint($developer), $fingerprint)) {
                return true;
            }

            $this->session->forget([$this->ownerKey($project), $this->developerKey($project), $this->developerFingerprintKey($project)]);

            return false;
        }

        $source = $this->session->get($this->clientSourceKey($project));
        if ($source === self::SOURCE_LINK) {
            return true;
        }

        $accountId = $this->session->get($this->clientAccountKey($project));
        $account = is_int($accountId) ? $this->clientAccount($accountId) : null;
        $fingerprint = $this->session->get($this->clientAccountFingerprintKey($project));
        if ($source === self::SOURCE_CLIENT_ACCOUNT
            && $account !== null
            && $account->feedback_project_id === $project->id
            && ! $account->isDisabled()
            && is_string($fingerprint)
            && hash_equals($this->accountFingerprint($account), $fingerprint)) {
            return true;
        }

        $this->session->forget([$this->clientKey($project), $this->clientSourceKey($project), $this->clientAccountKey($project), $this->clientAccountFingerprintKey($project)]);

        return false;
    }

    /**
     * 長效 cookie 的一筆登入：有效時回傳登入的帳號（團隊個人帳號、客戶帳號），沒有帳號的登入回傳 true，無效回傳 null。
     *
     * @param  array{source?: mixed, fingerprint?: mixed, expires_at?: mixed, developer_id?: mixed, client_account_id?: mixed}  $entry
     */
    private function resolveEntry(FeedbackProject $project, string $role, array $entry): FeedbackDeveloper|FeedbackClientAccount|true|null
    {
        if (! is_int($entry['expires_at'] ?? null) || $entry['expires_at'] < now()->getTimestamp() || ! is_string($entry['fingerprint'] ?? null)) {
            return null;
        }

        $source = (string) ($entry['source'] ?? '');
        $fingerprint = $entry['fingerprint'];
        $matches = fn (?string $expected): bool => $expected !== null && hash_equals($expected, $fingerprint);

        if ($source === self::SOURCE_DEVELOPER) {
            $developer = is_int($entry['developer_id'] ?? null) ? $this->developer($entry['developer_id']) : null;

            return $developer !== null && $matches($this->fingerprint($project, $role, $source, $developer)) ? $developer : null;
        }

        if ($role === self::ROLE_CLIENT && $source === self::SOURCE_CLIENT_ACCOUNT) {
            $account = is_int($entry['client_account_id'] ?? null) ? $this->clientAccount($entry['client_account_id']) : null;

            return $account !== null
                && $account->feedback_project_id === $project->id
                && ! $account->isDisabled()
                && $matches($this->fingerprint($project, $role, $source, account: $account)) ? $account : null;
        }

        if ($role === self::ROLE_CLIENT && $source === self::SOURCE_PASSWORD) {
            // 改版前的客戶帳密登入：綁的是專案那一組密碼雜湊，現在原封不動在搬過去的客戶帳號裡。
            foreach ($project->clientAccounts()->whereNull('disabled_at')->get() as $account) {
                if ($matches($this->legacyClientPasswordFingerprint($project, $account))) {
                    return $this->clientAccounts[$account->id] = $account;
                }
            }

            return null;
        }

        return $matches($this->fingerprint($project, $role, $source)) ? true : null;
    }

    /**
     * Ties a remembered grant to the credential that produced it, so rotating an entry link
     * or resetting an account password invalidates the long-lived cookies issued from it.
     */
    private function fingerprint(
        FeedbackProject $project,
        string $role,
        string $source,
        ?FeedbackDeveloper $developer = null,
        ?FeedbackClientAccount $account = null,
    ): ?string {
        $credentialHash = match ($source) {
            self::SOURCE_LINK => $role === self::ROLE_OWNER ? $project->owner_token_hash : $project->client_token_hash,
            self::SOURCE_PASSWORD => $role === self::ROLE_OWNER ? config('feedback.accounts.owner.password_hash') : null,
            self::SOURCE_DEVELOPER => $developer !== null && $role === self::ROLE_OWNER
                ? "{$developer->id}|{$developer->password_hash}"
                : null,
            self::SOURCE_CLIENT_ACCOUNT => $account !== null && $role === self::ROLE_CLIENT
                ? "account|{$account->id}|{$account->password_hash}"
                : null,
            default => null,
        };

        if (! is_string($credentialHash) || $credentialHash === '') {
            return null;
        }

        return hash_hmac('sha256', "{$project->id}|{$role}|{$source}|{$credentialHash}", (string) config('app.key'));
    }

    /**
     * 改版前客戶帳密登入的指紋（credential 是專案那一組密碼雜湊）。
     */
    private function legacyClientPasswordFingerprint(FeedbackProject $project, FeedbackClientAccount $account): string
    {
        return hash_hmac('sha256', "{$project->id}|".self::ROLE_CLIENT.'|'.self::SOURCE_PASSWORD."|{$account->password_hash}", (string) config('app.key'));
    }

    /**
     * 工作階段綁定的帳號密碼指紋。
     */
    private function accountFingerprint(FeedbackDeveloper|FeedbackClientAccount $account): string
    {
        $kind = $account instanceof FeedbackDeveloper ? 'developer' : 'client';

        return hash_hmac('sha256', "session|{$kind}|{$account->id}|{$account->password_hash}", (string) config('app.key'));
    }

    private function developer(int $id): ?FeedbackDeveloper
    {
        if (! array_key_exists($id, $this->developers)) {
            $this->developers[$id] = FeedbackDeveloper::find($id);
        }

        return $this->developers[$id];
    }

    private function clientAccount(int $id): ?FeedbackClientAccount
    {
        if (! array_key_exists($id, $this->clientAccounts)) {
            $this->clientAccounts[$id] = FeedbackClientAccount::find($id);
        }

        return $this->clientAccounts[$id];
    }

    private function rememberRole(
        FeedbackProject $project,
        string $role,
        string $source,
        ?FeedbackDeveloper $developer = null,
        ?FeedbackClientAccount $account = null,
    ): void {
        $fingerprint = $this->fingerprint($project, $role, $source, $developer, $account);
        if ($fingerprint === null) {
            return;
        }

        $entries = $this->cookieEntries();
        $entries[(string) $project->id][$role] = [
            'source' => $source,
            'fingerprint' => $fingerprint,
            'expires_at' => now()->addDays(self::COOKIE_DAYS)->getTimestamp(),
            ...($developer !== null ? ['developer_id' => $developer->id] : []),
            ...($account !== null ? ['client_account_id' => $account->id] : []),
        ];

        $this->queueCookie($entries);
    }

    /**
     * Cookie contents, preferring a cookie already queued during this request.
     *
     * @return array<string, array<string, array{source?: mixed, fingerprint?: mixed, expires_at?: mixed}>>
     */
    private function cookieEntries(): array
    {
        $queued = $this->cookies->queued(self::COOKIE_NAME);
        $raw = $queued !== null ? $queued->getValue() : $this->request->cookie(self::COOKIE_NAME);

        if (! is_string($raw) || $raw === '') {
            return [];
        }

        $decoded = json_decode($raw, true);

        return is_array($decoded) ? array_filter($decoded, 'is_array') : [];
    }

    /**
     * 瀏覽器記住的公開回報 token：public_id => token。
     *
     * @return array<string, string>
     */
    private function publicReportTokens(): array
    {
        $queued = $this->cookies->queued(self::PUBLIC_COOKIE_NAME);
        $raw = $queued !== null ? $queued->getValue() : $this->request->cookie(self::PUBLIC_COOKIE_NAME);

        $decoded = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;

        return is_array($decoded) ? array_filter($decoded, 'is_string') : [];
    }

    /**
     * @param  array<string, array<string, array<string, mixed>>>  $entries
     */
    private function queueCookie(array $entries): void
    {
        if ($entries === []) {
            $this->cookies->queue($this->cookies->forget(self::COOKIE_NAME));

            return;
        }

        $this->cookies->queue($this->cookies->make(
            self::COOKIE_NAME,
            json_encode($entries),
            self::COOKIE_DAYS * 24 * 60,
        ));
    }

    private function ownerKey(FeedbackProject $project): string
    {
        return "feedback.owner.{$project->id}";
    }

    private function developerKey(FeedbackProject $project): string
    {
        return "feedback.developer.{$project->id}";
    }

    private function developerFingerprintKey(FeedbackProject $project): string
    {
        return "feedback.developer_fp.{$project->id}";
    }

    private function clientKey(FeedbackProject $project): string
    {
        return "feedback.client.{$project->id}";
    }

    private function clientSourceKey(FeedbackProject $project): string
    {
        return "feedback.client_source.{$project->id}";
    }

    private function clientAccountKey(FeedbackProject $project): string
    {
        return "feedback.client_account.{$project->id}";
    }

    private function clientAccountFingerprintKey(FeedbackProject $project): string
    {
        return "feedback.client_account_fp.{$project->id}";
    }

    /**
     * @return list<string>
     */
    private function allSessionKeys(FeedbackProject $project): array
    {
        return [
            $this->ownerKey($project),
            $this->developerKey($project),
            $this->developerFingerprintKey($project),
            $this->clientKey($project),
            $this->clientSourceKey($project),
            $this->clientAccountKey($project),
            $this->clientAccountFingerprintKey($project),
        ];
    }

    private function reportKey(FeedbackReport $report): string
    {
        return "feedback.reporter.{$report->id}";
    }
}
