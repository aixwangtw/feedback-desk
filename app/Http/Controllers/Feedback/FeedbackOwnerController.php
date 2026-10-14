<?php

namespace App\Http\Controllers\Feedback;

use App\Http\Controllers\Controller;
use App\Models\FeedbackProject;
use App\Support\FeedbackAccess;
use Illuminate\Http\RedirectResponse;

class FeedbackOwnerController extends Controller
{
    public function authenticate(FeedbackProject $feedbackProject, FeedbackAccess $access): RedirectResponse
    {
        $token = request()->string('token')->toString();
        abort_unless($token !== '' && $access->validateOwnerToken($feedbackProject, $token), 403);

        $access->grantOwner($feedbackProject);

        return redirect()->route('feedback.portal', $feedbackProject);
    }

    /**
     * The owner dashboard now shares the project portal page; keep the old URL working.
     */
    public function index(FeedbackProject $feedbackProject, FeedbackAccess $access): RedirectResponse
    {
        abort_unless($access->isOwner($feedbackProject), 403);

        return redirect()->route('feedback.portal', [
            $feedbackProject,
            ...request()->only('status'),
        ]);
    }
}
