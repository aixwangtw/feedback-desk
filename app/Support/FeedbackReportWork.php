<?php

namespace App\Support;

use App\Models\FeedbackDeveloper;
use App\Models\FeedbackHandoffNote;
use App\Models\FeedbackReport;
use App\Models\FeedbackReportEvent;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * 多人、多個 AI 接手同一張單：認領、釋放、接手、交接紀錄與最近動態。網頁、MCP 與 artisan 指令共用。
 * 認領不是鎖：別人認領中的單仍看得到；MCP 與指令要改狀態、寫調整重點時先停下說明是誰在處理，
 * 確定要接手才加 force，系統記錄「接手」。網頁不擋，只提示並提供「接手」按鈕。
 */
class FeedbackReportWork
{
    public const MAX_HANDOFF_NOTE = 5000;

    private const HANDOFF_NOTES_SHOWN = 5;

    private const EVENTS_SHOWN = 20;

    /**
     * 認領：讓其他人知道誰在處理。別人認領中要 force（記錄為接手）。
     *
     * @return array{claimed_by: string, took_over_from: string|null}
     */
    public function claim(FeedbackReport $report, FeedbackActor $actor, bool $force = false): array
    {
        $developer = $this->requireDeveloper($actor, '認領');

        $takenOver = DB::transaction(function () use ($report, $actor, $developer, $force): ?string {
            $locked = $this->lock($report);
            $holder = $this->holderOf($locked);

            if ($holder !== null && $this->isMine($holder, $actor)) {
                return null;
            }

            if ($holder !== null && ! $force) {
                throw $this->claimedByOther($holder);
            }

            $this->setClaim($locked, $developer, $actor->agent);
            $locked->recordEvent($holder === null ? 'claim' : 'takeover', $actor, $holder?->label());

            return $holder?->describe();
        });

        $report->refresh();

        return ['claimed_by' => $actor->label(), 'took_over_from' => $takenOver];
    }

    /**
     * 釋放認領。替別人釋放要 force，並記錄原本是誰。
     */
    public function release(FeedbackReport $report, FeedbackActor $actor, bool $force = false): bool
    {
        $this->requireDeveloper($actor, '釋放認領');

        $released = DB::transaction(function () use ($report, $actor, $force): bool {
            $locked = $this->lock($report);
            $holder = $this->holderOf($locked);
            if ($holder === null) {
                return false;
            }

            $mine = $this->isMine($holder, $actor);
            if (! $mine && ! $force) {
                throw new FeedbackServiceException('claimed_by_other', "這張單由 {$holder->describe()} 認領，不是你。確定要替他釋放請加 force（會記錄）。", 409);
            }

            $this->clearClaim($locked);
            $locked->recordEvent('release', $actor, $mine ? null : $holder->label());

            return true;
        });

        $report->refresh();

        return $released;
    }

    /**
     * 改狀態、寫調整重點前的檢查（MCP 與 artisan 指令）：別人認領中時，沒加 force 就停下並說明是誰；
     * 加了 force 就由這個帳號接手（沒有個人帳號時只釋放），記錄接手。回傳原本的認領者。
     */
    public function guard(FeedbackReport $report, FeedbackActor $actor, bool $force): ?string
    {
        $takenOver = DB::transaction(function () use ($report, $actor, $force): ?string {
            $locked = $this->lock($report);
            $holder = $this->holderOf($locked);
            if ($holder === null || $this->isMine($holder, $actor)) {
                return null;
            }

            if (! $force) {
                throw $this->claimedByOther($holder);
            }

            $actor->developer !== null ? $this->setClaim($locked, $actor->developer, $actor->agent) : $this->clearClaim($locked);
            $locked->recordEvent('takeover', $actor, $holder->label());

            return $holder->describe();
        });

        $report->refresh();

        return $takenOver;
    }

    /**
     * 交接紀錄：做到哪、下一步。可一併釋放自己的認領。
     *
     * @return array{saved: true, released: bool}
     */
    public function handoff(FeedbackReport $report, FeedbackActor $actor, string $note, bool $release = false): array
    {
        $developer = $this->requireDeveloper($actor, '寫交接紀錄');
        $note = trim($note);
        if ($note === '') {
            throw new FeedbackServiceException('note_required', '交接紀錄不可為空白：寫下做到哪、下一步是什麼。');
        }
        if (mb_strlen($note) > self::MAX_HANDOFF_NOTE) {
            throw new FeedbackServiceException('note_too_long', '交接紀錄不能超過 '.self::MAX_HANDOFF_NOTE.' 字。');
        }

        $released = DB::transaction(function () use ($report, $actor, $developer, $note, $release): bool {
            $locked = $this->lock($report);
            $locked->handoffNotes()->create([
                'feedback_developer_id' => $developer->id,
                'author_name' => mb_substr($developer->name, 0, 100),
                'agent' => $actor->agent,
                'body' => $note,
            ]);
            $locked->recordEvent('handoff', $actor);

            $holder = $this->holderOf($locked);
            if (! $release || $holder === null || ! $this->isMine($holder, $actor)) {
                return false;
            }

            $this->clearClaim($locked);
            $locked->recordEvent('release', $actor);

            return true;
        });

        $report->refresh();

        return ['saved' => true, 'released' => $released];
    }

    /**
     * 認領、最新的交接紀錄與最近動態；只給團隊看。
     *
     * @return array{claim: array{by: string, since: Carbon, yours: bool}|null, handoff_notes: list<array{author: string, created_at: Carbon, note: string}>, recent_activity: list<array{kind: string, label: string, by: string, detail: string|null, at: Carbon}>}
     */
    public function state(FeedbackReport $report, ?FeedbackDeveloper $viewer, ?string $viewerAgent = null): array
    {
        $holder = $this->holderOf($report);

        return [
            'claim' => $holder === null ? null : [
                'by' => $holder->label(),
                'since' => $holder->since,
                'yours' => $viewer !== null && $holder->developerId === $viewer->id && $holder->agent === $viewerAgent,
            ],
            'handoff_notes' => $report->handoffNotes()
                ->with('feedbackDeveloper')
                ->orderByDesc('id')
                ->limit(self::HANDOFF_NOTES_SHOWN)
                ->get()
                ->map(fn (FeedbackHandoffNote $note): array => [
                    'author' => FeedbackAgentName::label($note->feedbackDeveloper?->name ?? $note->author_name, $note->agent, true),
                    'created_at' => $note->created_at,
                    'note' => $note->body,
                ])
                ->all(),
            'recent_activity' => $report->events()
                ->with(['feedbackDeveloper', 'feedbackClientAccount'])
                ->orderByDesc('id')
                ->limit(self::EVENTS_SHOWN)
                ->get()
                ->map(fn (FeedbackReportEvent $event): array => [
                    'kind' => $event->kind,
                    'label' => FeedbackReportEvent::LABELS[$event->kind] ?? $event->kind,
                    'by' => FeedbackAgentName::label($event->feedbackDeveloper?->name ?? $event->feedbackClientAccount?->name ?? $event->actor_name, $event->agent, $event->feedback_client_account_id === null && ($event->feedback_developer_id !== null || $event->actor_name === (string) config('feedback.labels.owner'))),
                    'detail' => $event->detail,
                    'at' => $event->created_at,
                ])
                ->all(),
        ];
    }

    /**
     * 給 MCP 與指令輸出的版本（時間轉成 ISO 8601）。
     *
     * @return array{claim: array{by: string, since: string, yours: bool}|null, handoff_notes: list<array{author: string, created_at: string, note: string}>, recent_activity: list<array{kind: string, by: string, detail: string|null, at: string}>}
     */
    public function stateForOutput(FeedbackReport $report, ?FeedbackDeveloper $viewer, ?string $viewerAgent = null): array
    {
        $state = $this->state($report, $viewer, $viewerAgent);

        return [
            'claim' => $state['claim'] === null ? null : [...$state['claim'], 'since' => $state['claim']['since']->toIso8601String()],
            'handoff_notes' => array_map(fn (array $note): array => [...$note, 'created_at' => $note['created_at']->toIso8601String()], $state['handoff_notes']),
            'recent_activity' => array_map(fn (array $event): array => [
                'kind' => $event['kind'],
                'by' => $event['by'],
                'detail' => $event['detail'],
                'at' => $event['at']->toIso8601String(),
            ], $state['recent_activity']),
        ];
    }

    private function lock(FeedbackReport $report): FeedbackReport
    {
        return FeedbackReport::query()->whereKey($report->id)->lockForUpdate()->firstOrFail();
    }

    private function holderOf(FeedbackReport $report): ?FeedbackClaimHolder
    {
        if ($report->claimed_by_developer_id === null || $report->claimed_at === null) {
            return null;
        }

        return new FeedbackClaimHolder(
            $report->claimed_by_developer_id,
            FeedbackDeveloper::query()->whereKey($report->claimed_by_developer_id)->value('name') ?? '（已刪除的帳號）',
            $report->claimed_agent,
            $report->claimed_at,
        );
    }

    private function isMine(FeedbackClaimHolder $holder, FeedbackActor $actor): bool
    {
        return $actor->developer !== null && $holder->developerId === $actor->developer->id && $holder->agent === $actor->agent;
    }

    private function setClaim(FeedbackReport $report, FeedbackDeveloper $developer, ?string $agent): void
    {
        $report->forceFill([
            'claimed_by_developer_id' => $developer->id,
            'claimed_agent' => $agent,
            'claimed_at' => now(),
        ])->saveQuietly();
    }

    private function clearClaim(FeedbackReport $report): void
    {
        $report->forceFill(['claimed_by_developer_id' => null, 'claimed_agent' => null, 'claimed_at' => null])->saveQuietly();
    }

    private function claimedByOther(FeedbackClaimHolder $holder): FeedbackServiceException
    {
        return new FeedbackServiceException(
            'claimed_by_other',
            "這張單由 {$holder->describe()} 認領處理中。先看最新交接紀錄；確定要接手，請加 force（artisan 指令：--force），系統會記錄你接手。",
            409,
        );
    }

    private function requireDeveloper(FeedbackActor $actor, string $action): FeedbackDeveloper
    {
        if ($actor->developer === null) {
            throw new FeedbackServiceException('account_required', "用{$this->ownerLabel()}個人帳號才能{$action}（artisan 指令請加 --as=帳號）。", 403);
        }

        return $actor->developer;
    }

    private function ownerLabel(): string
    {
        return (string) config('feedback.labels.owner');
    }
}
