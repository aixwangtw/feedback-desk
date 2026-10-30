<?php

use App\Http\Controllers\Feedback\FeedbackAccountController;
use App\Http\Controllers\Feedback\FeedbackAdjustmentController;
use App\Http\Controllers\Feedback\FeedbackAttachmentController;
use App\Http\Controllers\Feedback\FeedbackClaimController;
use App\Http\Controllers\Feedback\FeedbackClientController;
use App\Http\Controllers\Feedback\FeedbackConversationController;
use App\Http\Controllers\Feedback\FeedbackLoginController;
use App\Http\Controllers\Feedback\FeedbackMcpController;
use App\Http\Controllers\Feedback\FeedbackMessageController;
use App\Http\Controllers\Feedback\FeedbackOwnerController;
use App\Http\Controllers\Feedback\FeedbackPatrolController;
use App\Http\Controllers\Feedback\FeedbackPortalController;
use App\Http\Controllers\Feedback\FeedbackProjectSettingsController;
use App\Http\Controllers\Feedback\FeedbackPublicReportController;
use App\Http\Controllers\Feedback\FeedbackReportController;
use App\Http\Controllers\Feedback\FeedbackStatusController;
use Illuminate\Cookie\Middleware\AddQueuedCookiesToResponse;
use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\Route;
use Illuminate\View\Middleware\ShareErrorsFromSession;

// MCP 與簽章下載網址不用登入狀態：不開 session、不發 cookie，避免每個請求都寫一筆 session。
$statelessMiddleware = [EncryptCookies::class, AddQueuedCookiesToResponse::class, StartSession::class, ShareErrorsFromSession::class];

$feedbackRoutes = function () use ($statelessMiddleware): void {
    Route::get('/login', [FeedbackLoginController::class, 'showUnified'])
        ->name('feedback.login.unified');
    Route::post('/login', [FeedbackLoginController::class, 'storeUnified'])
        ->name('feedback.login.unified.store');
    Route::post('/logout', [FeedbackLoginController::class, 'destroyUnified'])
        ->name('feedback.logout.unified');

    Route::get('/p/{feedbackProject:slug}/access', [FeedbackClientController::class, 'authenticate'])
        ->middleware('throttle:10,1')
        ->name('feedback.client.authenticate');
    Route::get('/p/{feedbackProject:slug}/login', [FeedbackLoginController::class, 'show'])
        ->name('feedback.login');
    Route::post('/p/{feedbackProject:slug}/login', [FeedbackLoginController::class, 'store'])
        ->name('feedback.login.store');
    Route::post('/p/{feedbackProject:slug}/logout', [FeedbackLoginController::class, 'destroy'])
        ->name('feedback.logout');
    Route::get('/p/{feedbackProject:slug}', [FeedbackPortalController::class, 'show'])
        ->name('feedback.portal');
    Route::get('/p/{feedbackProject:slug}/account', [FeedbackAccountController::class, 'show'])
        ->name('feedback.account');
    Route::post('/p/{feedbackProject:slug}/account/name', [FeedbackAccountController::class, 'updateName'])
        ->middleware('throttle:30,1')
        ->name('feedback.account.name');
    Route::post('/p/{feedbackProject:slug}/account/password', [FeedbackAccountController::class, 'updatePassword'])
        ->middleware('throttle:10,1')
        ->name('feedback.account.password');
    Route::post('/p/{feedbackProject:slug}/account/tokens', [FeedbackAccountController::class, 'storeToken'])
        ->middleware('throttle:10,1')
        ->name('feedback.account.tokens.store');
    Route::delete('/p/{feedbackProject:slug}/account/tokens/{token}', [FeedbackAccountController::class, 'destroyToken'])
        ->name('feedback.account.tokens.destroy');
    Route::put('/p/{feedbackProject:slug}/settings/categories', [FeedbackProjectSettingsController::class, 'updateCategories'])
        ->middleware('throttle:30,1')
        ->name('feedback.project.categories');
    Route::get('/p/{feedbackProject:slug}/conversations', [FeedbackConversationController::class, 'index'])
        ->middleware('throttle:120,1')
        ->name('feedback.conversations.index');
    Route::get('/p/{feedbackProject:slug}/conversations/{feedbackReport:public_id}', [FeedbackConversationController::class, 'show'])
        ->middleware('throttle:120,1')
        ->name('feedback.conversations.show');
    Route::post('/p/{feedbackProject:slug}/reports', [FeedbackReportController::class, 'store'])
        ->middleware(['throttle:10,1', 'throttle:feedback-guest-submit'])
        ->name('feedback.reports.store');

    Route::get('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}', [FeedbackReportController::class, 'show'])
        ->name('feedback.reports.show');
    Route::put('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}', [FeedbackReportController::class, 'update'])
        ->middleware('throttle:30,1')
        ->name('feedback.reports.update');
    Route::patch('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/category', [FeedbackReportController::class, 'updateCategory'])
        ->middleware('throttle:60,1')
        ->name('feedback.reports.category.update');
    Route::delete('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}', [FeedbackReportController::class, 'destroy'])
        ->name('feedback.reports.destroy');
    Route::delete('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/client', [FeedbackReportController::class, 'clientDestroy'])
        ->name('feedback.reports.client-destroy');
    Route::patch('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/restore', [FeedbackReportController::class, 'restore'])
        ->name('feedback.reports.restore');
    Route::patch('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/status', [FeedbackStatusController::class, 'update'])
        ->name('feedback.reports.status.update');
    Route::get('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/activity', [FeedbackReportController::class, 'activity'])
        ->name('feedback.reports.activity');
    Route::post('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/messages', [FeedbackMessageController::class, 'store'])
        ->middleware(['throttle:30,1', 'throttle:feedback-public-message', 'throttle:feedback-guest-message'])
        ->name('feedback.messages.store');
    Route::post('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/claim', [FeedbackClaimController::class, 'update'])
        ->middleware('throttle:30,1')
        ->name('feedback.reports.claim');
    Route::post('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/handoff', [FeedbackClaimController::class, 'handoff'])
        ->middleware('throttle:30,1')
        ->name('feedback.reports.handoff');
    Route::put('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/adjustment', [FeedbackAdjustmentController::class, 'update'])
        ->middleware('throttle:30,1')
        ->name('feedback.reports.adjustment.update');
    Route::get('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/attachments/{feedbackAttachment}', [FeedbackAttachmentController::class, 'show'])
        ->name('feedback.attachments.show');
    // MCP 回傳的附件下載網址：一小時內有效的簽章網址，不需要登入。
    Route::get('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/attachments/{feedbackAttachment}/download', [FeedbackAttachmentController::class, 'download'])
        ->withoutMiddleware([PreventRequestForgery::class, ...$statelessMiddleware])
        ->middleware(['signed:relative', 'throttle:120,1'])
        ->name('feedback.attachments.download');

    // MCP（Streamable HTTP，無狀態）：團隊與客戶帳號用「我的帳號」建立的 token 連線。
    Route::post('/mcp', [FeedbackMcpController::class, 'handle'])
        ->withoutMiddleware([PreventRequestForgery::class, ...$statelessMiddleware])
        ->middleware('throttle:240,1')
        ->name('feedback.mcp');
    Route::match(['get', 'delete'], '/mcp', [FeedbackMcpController::class, 'methodNotAllowed'])
        ->withoutMiddleware([PreventRequestForgery::class, ...$statelessMiddleware]);

    // 排程（雲端例行巡檢）專用 API：Bearer token（feedback:patrol-token 建立），只能讀單、留言、寫調整重點、改成待審核。
    Route::prefix('/api/patrol')
        ->withoutMiddleware([PreventRequestForgery::class, ...$statelessMiddleware])
        ->middleware('throttle:feedback-patrol')
        ->name('feedback.patrol.')
        ->group(function (): void {
            Route::get('/projects', [FeedbackPatrolController::class, 'projects'])->name('projects');
            Route::get('/projects/{project}/attention', [FeedbackPatrolController::class, 'attention'])->name('attention');
            Route::get('/projects/{project}/reports/{report}', [FeedbackPatrolController::class, 'show'])->name('show');
            Route::post('/projects/{project}/reports/{report}/messages', [FeedbackPatrolController::class, 'message'])->name('message');
            Route::put('/projects/{project}/reports/{report}/adjustment', [FeedbackPatrolController::class, 'adjustment'])->name('adjustment');
            Route::post('/projects/{project}/reports/{report}/needs-input', [FeedbackPatrolController::class, 'needsInput'])->name('needs-input');
        });

    Route::post('/public-reports', [FeedbackPublicReportController::class, 'store'])
        ->middleware('throttle:feedback-public-submit')
        ->name('feedback.public.store');

    Route::get('/owner/{feedbackProject:slug}/access', [FeedbackOwnerController::class, 'authenticate'])
        ->middleware('throttle:10,1')
        ->name('feedback.owner.authenticate');
    Route::get('/owner/{feedbackProject:slug}/login', [FeedbackLoginController::class, 'showOwner'])
        ->name('feedback.owner.login');
    Route::get('/owner/{feedbackProject:slug}', [FeedbackOwnerController::class, 'index'])
        ->name('feedback.owner.index');
    Route::patch('/owner/{feedbackProject:slug}/reports/{feedbackReport:public_id}/status', [FeedbackStatusController::class, 'update'])
        ->name('feedback.owner.status.update');
};

if (config('feedback.domain')) {
    Route::domain(config('feedback.domain'))->group(function () use ($feedbackRoutes): void {
        Route::get('/', [FeedbackPortalController::class, 'index'])->name('feedback.home');
        $feedbackRoutes();
    });
} else {
    Route::get('/', [FeedbackPortalController::class, 'index'])->name('feedback.home');
    Route::group([], $feedbackRoutes);
}
