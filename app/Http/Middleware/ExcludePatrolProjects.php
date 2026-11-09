<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * 排程巡檢 API：路徑上的專案若在 feedback.patrol_excluded_projects 內，一律回 404（與找不到專案相同）。
 */
class ExcludePatrolProjects
{
    public function handle(Request $request, Closure $next): Response
    {
        $slug = $request->route('project');

        if (is_string($slug) && in_array($slug, config('feedback.patrol_excluded_projects', []), true)) {
            return response()->json(['error' => 'project_not_found', 'message' => '找不到回報專案。'], 404);
        }

        return $next($request);
    }
}
