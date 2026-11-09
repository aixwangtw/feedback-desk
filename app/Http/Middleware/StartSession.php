<?php

namespace App\Http\Middleware;

use Illuminate\Contracts\Session\Session;
use Illuminate\Http\Request;
use Illuminate\Session\Middleware\StartSession as BaseStartSession;

/**
 * 全站設了 no-referrer，表單送出後的 back() 只能靠 session 記的「上一頁」。
 * 附件圖片、影片、草稿檔案是頁面載入後瀏覽器自己抓的 GET，若也記成上一頁，
 * 按「完成」等一般表單送出後會被導到最後載入的那張圖片（2026-11-09 手機回報「按完成會跑出圖片」）。
 * 這些檔案路由一律不更新上一頁。
 */
class StartSession extends BaseStartSession
{
    /**
     * 只回傳檔案、不是頁面的路由名稱。
     *
     * @var list<string>
     */
    public const FILE_ROUTES = [
        'feedback.attachments.show',
        'feedback.attachments.download',
        'feedback.drafts.file',
    ];

    /**
     * @param  Session  $session
     */
    protected function storeCurrentUrl(Request $request, $session): void
    {
        if (in_array($request->route()?->getName(), self::FILE_ROUTES, true)) {
            return;
        }

        parent::storeCurrentUrl($request, $session);
    }
}
