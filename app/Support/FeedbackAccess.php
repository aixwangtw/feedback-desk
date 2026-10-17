<?php

namespace App\Support;

use App\Enums\FeedbackCreatorType;
use App\Models\FeedbackDeveloper;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use Illuminate\Contracts\Cookie\QueueingFactory as CookieJar;
use Illuminate\Contracts\Session\Session;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class FeedbackAccess
{
    public const COOKIE_NAME = 'feedback_access';

    public const COOKIE_DAYS = 30;

    public const ROLE_OWNER = 'owner';

    public const ROLE_CLIENT = 'client';

    public const SOURCE_LINK = 'link';

    public const SOURCE_PASSWORD = 'password';

    public const SOURCE_DEVELOPER = 'developer';

    public function __construct(
        private Session $session,
        private Request $request,
        private CookieJar $cookies,
    ) {}

    public function grantOwner(FeedbackProject $project, string $source = self::SOURCE_LINK): void
    {
        $this->session->put($this->ownerKey($project), true);
        $this->session->forget($this->developerKey($project));
        $this->rememberRole($project, self::ROLE_OWNER, $source);
    }

    /**
     * 開發者個人帳號登入：權限等同 owner，另外記下是哪位開發者。
     */
    public function grantDeveloper(FeedbackProject $project, FeedbackDeveloper $developer): void
    {
        $this->session->put($this->ownerKey($project), true);
        $this->session->put($this->developerKey($project), $developer->id);
        $this->rememberRole($project, self::ROLE_OWNER, self::SOURCE_DEVELOPER, $developer);
    }

    public function grantReporter(FeedbackReport $report): void
    {
        $this->session->put($this->reportKey($report), true);
    }

    public function grantClient(FeedbackProject $project, string $source = self::SOURCE_LINK): void
    {
        $this->session->put($this->clientKey($project), true);
        $this->rememberRole($project, self::ROLE_CLIENT, $source);
    }

    /**
     * Remove every owner/client grant for the project from the session and the long-lived cookie.
     */
    public function revoke(FeedbackProject $project): void
    {
        $this->session->forget([$this->ownerKey($project), $this->clientKey($project), $this->developerKey($project)]);

        $entries = $this->cookieEntries();
        unset($entries[(string) $project->id]);
        $this->queueCookie($entries);
    }

    public function isOwner(FeedbackProject $project): bool
    {
        return $this->hasRole($project, self::ROLE_OWNER, $this->ownerKey($project));
    }

    /**
     * 目前登入的開發者個人帳號；共用 admin 或開發者連結登入時為 null。
     */
    public function currentDeveloper(FeedbackProject $project): ?FeedbackDeveloper
    {
        if (! $this->isOwner($project)) {
            return null;
        }

        $developerId = $this->session->get($this->developerKey($project));

        return is_int($developerId) ? FeedbackDeveloper::find($developerId) : null;
    }

    /**
     * 依目前登入身分決定新單的建立者。
     *
     * @return array{creator_type: FeedbackCreatorType, creator_developer_id: int|null}
     */
    public function creatorFor(FeedbackProject $project): array
    {
        if (! $this->isOwner($project)) {
            return ['creator_type' => FeedbackCreatorType::Client, 'creator_developer_id' => null];
        }

        $developer = $this->currentDeveloper($project);

        return $developer !== null
            ? ['creator_type' => FeedbackCreatorType::Developer, 'creator_developer_id' => $developer->id]
            : ['creator_type' => FeedbackCreatorType::OwnerShared, 'creator_developer_id' => null];
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
            || (bool) $this->session->get($this->reportKey($report), false);
    }

    /**
     * A report deleted by the teacher, or created by a developer, no longer exists for anyone but the owner.
     */
    public function ensureReportVisible(FeedbackReport $report): true
    {
        $isOwner = $this->isOwner($report->feedbackProject);

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

    private function hasRole(FeedbackProject $project, string $role, string $sessionKey): bool
    {
        if ($this->session->get($sessionKey, false)) {
            return true;
        }

        $entry = $this->cookieEntries()[(string) $project->id][$role] ?? null;
        if (! is_array($entry) || ! $this->entryIsValid($project, $role, $entry)) {
            return false;
        }

        $this->session->put($sessionKey, true);
        if (($entry['source'] ?? null) === self::SOURCE_DEVELOPER) {
            $this->session->put($this->developerKey($project), (int) $entry['developer_id']);
        }

        return true;
    }

    /**
     * @param  array{source?: mixed, fingerprint?: mixed, expires_at?: mixed, developer_id?: mixed}  $entry
     */
    private function entryIsValid(FeedbackProject $project, string $role, array $entry): bool
    {
        if (! is_int($entry['expires_at'] ?? null) || $entry['expires_at'] < now()->getTimestamp()) {
            return false;
        }

        $developer = null;
        if (($entry['source'] ?? null) === self::SOURCE_DEVELOPER) {
            $developer = is_int($entry['developer_id'] ?? null) ? FeedbackDeveloper::find($entry['developer_id']) : null;
        }

        $expected = $this->fingerprint($project, $role, (string) ($entry['source'] ?? ''), $developer);

        return $expected !== null
            && is_string($entry['fingerprint'] ?? null)
            && hash_equals($expected, $entry['fingerprint']);
    }

    /**
     * Ties a remembered grant to the credential that produced it, so rotating an entry link
     * or resetting an account password invalidates the long-lived cookies issued from it.
     */
    private function fingerprint(FeedbackProject $project, string $role, string $source, ?FeedbackDeveloper $developer = null): ?string
    {
        $credentialHash = match ($source) {
            self::SOURCE_LINK => $role === self::ROLE_OWNER ? $project->owner_token_hash : $project->client_token_hash,
            self::SOURCE_PASSWORD => $role === self::ROLE_OWNER
                ? config('feedback.accounts.owner.password_hash')
                : $project->client_password_hash,
            self::SOURCE_DEVELOPER => $developer !== null && $role === self::ROLE_OWNER
                ? "{$developer->id}|{$developer->password_hash}"
                : null,
            default => null,
        };

        if (! is_string($credentialHash) || $credentialHash === '') {
            return null;
        }

        return hash_hmac('sha256', "{$project->id}|{$role}|{$source}|{$credentialHash}", (string) config('app.key'));
    }

    private function rememberRole(FeedbackProject $project, string $role, string $source, ?FeedbackDeveloper $developer = null): void
    {
        $fingerprint = $this->fingerprint($project, $role, $source, $developer);
        if ($fingerprint === null) {
            return;
        }

        $entries = $this->cookieEntries();
        $entries[(string) $project->id][$role] = [
            'source' => $source,
            'fingerprint' => $fingerprint,
            'expires_at' => now()->addDays(self::COOKIE_DAYS)->getTimestamp(),
            ...($developer !== null ? ['developer_id' => $developer->id] : []),
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

    private function clientKey(FeedbackProject $project): string
    {
        return "feedback.client.{$project->id}";
    }

    private function reportKey(FeedbackReport $report): string
    {
        return "feedback.reporter.{$report->id}";
    }
}
