<?php

namespace App\Http\Controllers\Feedback;

use App\Http\Controllers\Controller;
use App\Models\FeedbackProject;
use App\Support\FeedbackAccess;
use Illuminate\Http\RedirectResponse;

class FeedbackClientController extends Controller
{
    public function authenticate(FeedbackProject $feedbackProject, FeedbackAccess $access): RedirectResponse
    {
        $token = request()->string('token')->toString();
        abort_unless($token !== '' && $access->validateClientToken($feedbackProject, $token), 403);

        $access->grantClient($feedbackProject);

        return redirect()->route('feedback.portal', $feedbackProject);
    }
}
