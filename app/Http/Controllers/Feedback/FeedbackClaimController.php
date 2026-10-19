<?php

namespace App\Http\Controllers\Feedback;

use App\Http\Controllers\Controller;
use App\Models\FeedbackProject;
use App\Models\FeedbackReport;
use App\Support\FeedbackAccess;
use App\Support\FeedbackReportWork;
use App\Support\FeedbackServiceException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * 單頁右側「誰在處理」：認領、釋放、接手與交接紀錄。只有用個人帳號登入的團隊成員能操作。
 */
class FeedbackClaimController extends Controller
{
    public function update(Request $request, FeedbackProject $feedbackProject, FeedbackReport $feedbackReport, FeedbackAccess $access, FeedbackReportWork $work): RedirectResponse
    {
        $this->ensureTeamAccount($feedbackProject, $feedbackReport, $access, '認領');
        $action = $request->string('action')->toString();
        $actor = $access->actor($feedbackProject);

        try {
            if ($action === 'release') {
                $work->release($feedbackReport, $actor);
                $message = '已釋放認領。';
            } else {
                $result = $work->claim($feedbackReport, $actor, force: $action === 'takeover');
                $message = $result['took_over_from'] !== null ? "已接手（原本是 {$result['took_over_from']}）。" : '已認領，其他人會看到你正在處理。';
            }
        } catch (FeedbackServiceException $exception) {
            // 這頁載入後有人認領或接手了：回到單頁顯示最新狀態。
            return $this->backToReport($feedbackProject, $feedbackReport)->withErrors(['claim' => $exception->getMessage()], 'work');
        }

        return $this->backToReport($feedbackProject, $feedbackReport)->with('success', $message);
    }

    public function handoff(Request $request, FeedbackProject $feedbackProject, FeedbackReport $feedbackReport, FeedbackAccess $access, FeedbackReportWork $work): RedirectResponse
    {
        $this->ensureTeamAccount($feedbackProject, $feedbackReport, $access, '寫交接紀錄');

        try {
            $result = $work->handoff($feedbackReport, $access->actor($feedbackProject), (string) $request->input('note', ''), $request->boolean('release'));
        } catch (FeedbackServiceException $exception) {
            return $this->backToReport($feedbackProject, $feedbackReport)->withErrors(['note' => $exception->getMessage()], 'work')->withInput();
        }

        return $this->backToReport($feedbackProject, $feedbackReport)
            ->with('success', $result['released'] ? '已儲存交接紀錄並釋放認領。' : '已儲存交接紀錄。');
    }

    private function ensureTeamAccount(FeedbackProject $project, FeedbackReport $report, FeedbackAccess $access, string $action): void
    {
        abort_unless($report->feedback_project_id === $project->id, 404);
        if (! $access->isOwner($project)) {
            $access->deny($project);
        }
        abort_if($access->currentDeveloper($project) === null, 403, "用個人帳號登入才能{$action}。");
    }

    private function backToReport(FeedbackProject $project, FeedbackReport $report): RedirectResponse
    {
        return redirect()->to(route('feedback.reports.show', [$project, $report]).'#work');
    }
}
