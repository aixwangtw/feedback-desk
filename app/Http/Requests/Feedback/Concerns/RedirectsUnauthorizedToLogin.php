<?php

namespace App\Http\Requests\Feedback\Concerns;

use App\Models\FeedbackProject;
use App\Support\FeedbackAccess;

trait RedirectsUnauthorizedToLogin
{
    /**
     * Send visitors without project access to the login page instead of a bare 403.
     */
    protected function failedAuthorization(): void
    {
        $project = $this->route('feedbackProject');

        if ($project instanceof FeedbackProject) {
            app(FeedbackAccess::class)->deny($project);
        }

        parent::failedAuthorization();
    }
}
