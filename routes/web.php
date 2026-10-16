<?php

use App\Http\Controllers\Feedback\FeedbackAdjustmentController;
use App\Http\Controllers\Feedback\FeedbackAttachmentController;
use App\Http\Controllers\Feedback\FeedbackClientController;
use App\Http\Controllers\Feedback\FeedbackLoginController;
use App\Http\Controllers\Feedback\FeedbackMessageController;
use App\Http\Controllers\Feedback\FeedbackOwnerController;
use App\Http\Controllers\Feedback\FeedbackPortalController;
use App\Http\Controllers\Feedback\FeedbackReportController;
use App\Http\Controllers\Feedback\FeedbackStatusController;
use Illuminate\Support\Facades\Route;

$feedbackRoutes = function (): void {
    Route::get('/p/{feedbackProject:slug}/access', [FeedbackClientController::class, 'authenticate'])
        ->middleware('throttle:10,1')
        ->name('feedback.client.authenticate');
    Route::get('/p/{feedbackProject:slug}/login', [FeedbackLoginController::class, 'show'])
        ->name('feedback.login');
    Route::post('/p/{feedbackProject:slug}/login', [FeedbackLoginController::class, 'store'])
        ->middleware('throttle:feedback-login')
        ->name('feedback.login.store');
    Route::post('/p/{feedbackProject:slug}/logout', [FeedbackLoginController::class, 'destroy'])
        ->name('feedback.logout');
    Route::get('/p/{feedbackProject:slug}', [FeedbackPortalController::class, 'show'])
        ->name('feedback.portal');
    Route::post('/p/{feedbackProject:slug}/reports', [FeedbackReportController::class, 'store'])
        ->middleware('throttle:10,1')
        ->name('feedback.reports.store');

    Route::get('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}', [FeedbackReportController::class, 'show'])
        ->name('feedback.reports.show');
    Route::put('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}', [FeedbackReportController::class, 'update'])
        ->middleware('throttle:30,1')
        ->name('feedback.reports.update');
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
        ->middleware('throttle:30,1')
        ->name('feedback.messages.store');
    Route::put('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/adjustment', [FeedbackAdjustmentController::class, 'update'])
        ->middleware('throttle:30,1')
        ->name('feedback.reports.adjustment.update');
    Route::get('/p/{feedbackProject:slug}/reports/{feedbackReport:public_id}/attachments/{feedbackAttachment}', [FeedbackAttachmentController::class, 'show'])
        ->name('feedback.attachments.show');

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
