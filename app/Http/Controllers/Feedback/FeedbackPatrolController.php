<?php

namespace App\Http\Controllers\Feedback;

use App\Actions\ManageFeedbackMessageDraftAction;
use App\Enums\FeedbackAuthorType;
use App\Enums\FeedbackReportStatus;
use App\Http\Controllers\Controller;
use App\Models\FeedbackPatrolLog;
use App\Models\FeedbackPatrolToken;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackActor;
use App\Support\FeedbackMcpTools;
use App\Support\FeedbackServiceException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * 排程（雲端例行巡檢）專用 REST API。用 Authorization: Bearer fdp_... 驗證，以 token 綁定的團隊個人帳號身分操作。
 * 只能：列專案、列要處理的單、讀單、留言、寫待審留言（草稿）、請客戶確認完成、改成等客戶（needs_input）；寫調整重點已停用（照常寫入，回應附 warning）。不能改成已完成、不能刪除。
 * 讀單與寫入共用 MCP 工具的邏輯；寫入動作另記在 feedback_patrol_logs。
 */
class FeedbackPatrolController extends Controller
{
    private const AGENT = 'Claude Code';

    private const MAX_ATTENTION_REPORTS = 30;

    /**
     * 已完成的單，客戶後來的留言含這些字才當成新問題；只是道謝之類的留言不列出。
     */
    private const QUESTION_MARKERS = ['?', '？', '嗎', '還是', '沒有', '錯', '不行', '不對', '不能', '無法', '怎麼', '為什麼', '問題'];

    public function projects(Request $request): JsonResponse
    {
        if ($this->authenticate($request) === null) {
            return $this->unauthorized();
        }

        return response()->json([
            'projects' => FeedbackProject::query()->whereNotIn('slug', config('feedback.patrol_excluded_projects', []))->orderBy('id')->get()->map(fn (FeedbackProject $project): array => [
                'slug' => $project->slug,
                'name' => $project->name,
                'url' => route('feedback.portal', $project),
            ])->all(),
        ]);
    }

    /**
     * 需要處理的單：等工程師（new）、有開發者還沒在網頁看過的客戶留言、或最後一則客戶留言晚於最後一次調整重點與團隊留言。
     * 已完成的單只有在客戶的新留言看起來是新問題（含問號、「還是」「沒有」「錯」「不行」「怎麼」等字）時才列出；
     * 客戶重新打開的單狀態已不是已完成，照一般規則列出。
     * 每張單附完整內容、留言與附件下載網址（一小時有效）。
     */
    public function attention(Request $request, string $project, FeedbackMcpTools $tools): JsonResponse
    {
        $token = $this->authenticate($request);
        if ($token === null) {
            return $this->unauthorized();
        }

        $feedbackProject = FeedbackProject::query()->where('slug', $project)->first();
        if ($feedbackProject === null) {
            return response()->json(['error' => 'project_not_found', 'message' => '找不到回報專案。'], 404);
        }

        $candidates = $feedbackProject->feedbackReports()
            ->whereNull('client_deleted_at')
            ->withCount(['feedbackMessages as unread_messages_count' => fn (Builder $query) => FeedbackReport::constrainToUnreadByOwner($query)])
            ->withMax(['feedbackMessages as latest_reporter_message_at' => fn (Builder $query) => $query->where('author_type', FeedbackAuthorType::Reporter->value)], 'created_at')
            ->withMax(['feedbackMessages as latest_team_message_at' => fn (Builder $query) => $query->whereIn('author_type', [FeedbackAuthorType::Owner->value, FeedbackAuthorType::Agent->value])], 'created_at')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->get();

        $reasons = [];
        foreach ($candidates as $report) {
            $why = [];
            if ($report->status === FeedbackReportStatus::New) {
                $why[] = 'status_new';
            }
            if ((int) $report->unread_messages_count > 0) {
                $why[] = 'unread_messages';
            }
            $reporterAt = $report->latest_reporter_message_at !== null ? strtotime((string) $report->latest_reporter_message_at) : null;
            $handledAt = max(
                $report->adjustment_updated_at?->getTimestamp() ?? 0,
                $report->latest_team_message_at !== null ? (int) strtotime((string) $report->latest_team_message_at) : 0,
            );
            if ($reporterAt !== null && $reporterAt > $handledAt) {
                $why[] = 'reporter_message_after_last_reply';
            }
            if ($why !== [] && $report->status === FeedbackReportStatus::Completed && ! $this->hasNewQuestion($report, $handledAt)) {
                $why = [];
            }
            if ($why !== []) {
                $reasons[$report->public_id] = $why;
            }
        }

        $actor = $this->actor($token);
        $reports = [];
        foreach (array_slice($reasons, 0, self::MAX_ATTENTION_REPORTS, true) as $publicId => $why) {
            $detail = $this->decode($tools->call($actor, 'get_report', ['project' => $feedbackProject->slug, 'report' => (string) $publicId]));
            $reports[] = ['attention_reasons' => $why, ...$detail['body']];
        }

        return response()->json([
            'project' => $feedbackProject->slug,
            'total' => count($reasons),
            'returned' => count($reports),
            'reports' => $reports,
        ]);
    }

    /**
     * 最後一次團隊回覆之後的客戶留言（沒有就看最後一則客戶留言）是否含新問題的字眼。
     */
    private function hasNewQuestion(FeedbackReport $report, int $handledAt): bool
    {
        $reporterMessages = $report->feedbackMessages()->where('author_type', FeedbackAuthorType::Reporter->value);
        $bodies = (clone $reporterMessages)->where('created_at', '>', date('Y-m-d H:i:s', $handledAt))->pluck('body');
        if ($bodies->isEmpty()) {
            $bodies = $reporterMessages->latest('created_at')->latest('id')->limit(1)->pluck('body');
        }

        foreach ($bodies as $body) {
            foreach (self::QUESTION_MARKERS as $marker) {
                if (str_contains((string) $body, $marker)) {
                    return true;
                }
            }
        }

        return false;
    }

    public function show(Request $request, string $project, string $report, FeedbackMcpTools $tools): JsonResponse
    {
        $token = $this->authenticate($request);
        if ($token === null) {
            return $this->unauthorized();
        }

        $result = $this->decode($tools->call($this->actor($token), 'get_report', ['project' => $project, 'report' => $report]));

        return response()->json($result['body'], $result['status']);
    }

    public function message(Request $request, string $project, string $report, FeedbackMcpTools $tools): JsonResponse
    {
        return $this->write($request, 'message', $project, $report, $tools, 'add_message', fn (): array => ['body' => (string) $request->input('body', '')],
            fn (): array => ['body_length' => mb_strlen((string) $request->input('body', ''))]);
    }

    /**
     * 編輯團隊留言（巡檢身分）：不顯示「已編輯」、不改狀態。body 必填；remove_attachment_ids 可移除附件。
     */
    public function editMessage(Request $request, string $project, string $report, int $message, FeedbackMcpTools $tools): JsonResponse
    {
        return $this->write($request, 'edit_message', $project, $report, $tools, 'edit_message', fn (): array => [
            'message_id' => $message,
            'body' => (string) $request->input('body', ''),
            'remove_attachment_ids' => (array) $request->input('remove_attachment_ids', []),
        ], fn (): array => ['message_id' => $message, 'body_length' => mb_strlen((string) $request->input('body', ''))]);
    }

    /**
     * 收回團隊留言（巡檢身分）：客戶端完全看不到痕跡。
     */
    public function withdrawMessage(Request $request, string $project, string $report, int $message, FeedbackMcpTools $tools): JsonResponse
    {
        return $this->write($request, 'withdraw_message', $project, $report, $tools, 'withdraw_message', fn (): array => ['message_id' => $message], fn (): array => ['message_id' => $message]);
    }

    /**
     * 寫待審留言（草稿）：客戶端看不到，團隊在單頁審過按「送出」才發出。body 必填；replace_message_id 指定要修改的團隊留言。
     */
    public function draft(Request $request, string $project, string $report, ManageFeedbackMessageDraftAction $drafts): JsonResponse
    {
        $token = $this->authenticate($request);
        if ($token === null) {
            return $this->unauthorized();
        }

        $body = (string) $request->input('body', '');
        $replace = $request->input('replace_message_id');
        $feedbackReport = FeedbackReport::query()
            ->where('public_id', $report)
            ->whereHas('feedbackProject', fn (Builder $query) => $query->where('slug', $project))
            ->first();

        try {
            if ($feedbackReport === null) {
                throw new FeedbackServiceException('report_not_found', '找不到回饋單。', 404);
            }
            if ($replace !== null && ! (is_int($replace) || (is_string($replace) && ctype_digit($replace)))) {
                throw new FeedbackServiceException('message_not_replaceable', 'replace_message_id 要填留言 id（數字）。');
            }
            $draft = $drafts->create($feedbackReport, $this->actor($token), $body, $replace !== null ? (int) $replace : null);
            $result = ['status' => 201, 'body' => ['draft' => [
                'id' => $draft->id,
                'body' => $draft->body,
                'replaces_message_id' => $draft->replaces_message_id,
                'report_url' => route('feedback.reports.show', [$feedbackReport->feedbackProject, $feedbackReport]),
            ]]];
        } catch (FeedbackServiceException $exception) {
            $result = ['status' => $exception->status, 'body' => ['error' => $exception->errorCode, 'message' => $exception->getMessage()]];
        }

        FeedbackPatrolLog::create([
            'feedback_patrol_token_id' => $token->id,
            'action' => 'draft',
            'project_slug' => mb_substr($project, 0, 100),
            'report_public_id' => mb_substr($report, 0, 64),
            'succeeded' => $result['status'] < 300,
            'detail' => ['body_length' => mb_strlen($body), 'replace_message_id' => $replace, ...($result['status'] < 300 ? [] : ['error' => $result['body']['error']])],
            'ip' => $request->ip(),
        ]);

        return response()->json($result['body'], $result['status']);
    }

    /**
     * 已停用（改用留言）：照常寫入，MCP 工具的回應已附 warning。
     */
    public function adjustment(Request $request, string $project, string $report, FeedbackMcpTools $tools): JsonResponse
    {
        return $this->write($request, 'adjustment', $project, $report, $tools, 'write_adjustment', fn (): array => [
            'note' => (string) $request->input('note', ''),
            'append' => $request->boolean('append'),
        ], fn (): array => ['note_length' => mb_strlen((string) $request->input('note', '')), 'append' => $request->boolean('append')]);
    }

    /**
     * 請客戶確認完成：只發一則附「通過」按鈕的確認留言，單維持等客戶；不能直接結案。body 省略時用預設文字。
     * 只在已修好且驗過畫面時使用（巡檢 prompt 規定）。
     */
    public function requestCompletion(Request $request, string $project, string $report, FeedbackMcpTools $tools): JsonResponse
    {
        return $this->write($request, 'request_completion', $project, $report, $tools, 'request_completion', fn (): array => array_filter(['body' => $request->input('body')], fn ($value) => $value !== null),
            fn (): array => ['body_length' => mb_strlen((string) $request->input('body', ''))]);
    }

    /**
     * 只能改成等客戶（needs_input）；已完成由客戶在網頁上按「完成」或「通過」。
     */
    public function needsInput(Request $request, string $project, string $report, FeedbackMcpTools $tools): JsonResponse
    {
        return $this->write($request, 'needs_input', $project, $report, $tools, 'set_status',
            fn (): array => ['status' => FeedbackReportStatus::NeedsInput->value], fn (): array => []);
    }

    /**
     * @param  callable(): array<string, mixed>  $arguments
     * @param  callable(): array<string, mixed>  $summary
     */
    private function write(Request $request, string $action, string $project, string $report, FeedbackMcpTools $tools, string $tool, callable $arguments, callable $summary): JsonResponse
    {
        $token = $this->authenticate($request);
        if ($token === null) {
            return $this->unauthorized();
        }

        $result = $this->decode($tools->call($this->actor($token), $tool, ['project' => $project, 'report' => $report, ...$arguments()]));

        FeedbackPatrolLog::create([
            'feedback_patrol_token_id' => $token->id,
            'action' => $action,
            'project_slug' => mb_substr($project, 0, 100),
            'report_public_id' => mb_substr($report, 0, 64),
            'succeeded' => $result['status'] < 300,
            'detail' => [...$summary(), ...($result['status'] < 300 ? array_filter(['previous' => $result['body']['previous']['status'] ?? null]) : ['error' => $result['body']['error'] ?? null])],
            'ip' => $request->ip(),
        ]);

        return response()->json($result['body'], $result['status']);
    }

    /**
     * MCP 工具的回傳（JSON 文字）轉成 HTTP 回應內容與狀態碼。
     *
     * @param  array<string, mixed>|null  $result
     * @return array{body: array<string, mixed>, status: int}
     */
    private function decode(?array $result): array
    {
        $body = json_decode((string) ($result['content'][0]['text'] ?? ''), true);
        $body = is_array($body) ? $body : ['error' => 'unknown', 'message' => '無法處理這個請求。'];
        if (($result['isError'] ?? false) !== true) {
            return ['body' => $body, 'status' => 200];
        }

        $status = match ($body['error'] ?? null) {
            'project_not_found', 'report_not_found', 'message_not_found' => 404,
            'claimed_by_other' => 409,
            default => 422,
        };

        return ['body' => $body, 'status' => $status];
    }

    private function authenticate(Request $request): ?FeedbackPatrolToken
    {
        $token = FeedbackPatrolToken::findActiveByPlain((string) $request->bearerToken());
        if ($token !== null && ($token->last_used_at === null || $token->last_used_at->lt(now()->subMinute()))) {
            $token->forceFill(['last_used_at' => now()])->saveQuietly();
        }

        return $token;
    }

    private function actor(FeedbackPatrolToken $token): FeedbackActor
    {
        return FeedbackActor::developer($token->feedbackDeveloper, self::AGENT);
    }

    private function unauthorized(): JsonResponse
    {
        return response()->json(['error' => 'unauthorized', 'message' => 'token 無效或已撤銷。'], 401, ['WWW-Authenticate' => 'Bearer realm="feedback-patrol"']);
    }
}
