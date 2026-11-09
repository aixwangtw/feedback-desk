<?php

namespace App\Support;

use App\Enums\FeedbackReportStatus;
use App\Models\FeedbackProject;

/**
 * 「請老師確認完成」：開發團隊（網頁、artisan、MCP、巡檢 API）都不能直接把單結案，
 * 只能發一則確認留言，老師在留言上按「通過」才變成已完成。預設文字與說明只寫在這裡。
 */
final class FeedbackCompletionRequest
{
    /** 確認留言預設文字（網頁上可以改字；CLI、MCP、API 沒給文字時用這個）。 */
    public static function defaultBody(?FeedbackProject $project = null): string
    {
        return '這張已經處理好了，'.FeedbackProject::clientRoleFor($project).'確認沒問題請按『'.self::APPROVE_LABEL.'』；還有問題直接在這裡留言';
    }

    /** 留言上給老師按的按鈕文字。 */
    public const APPROVE_LABEL = '通過';

    /** 給開發端的提醒：發出後單仍在等老師。 */
    public static function sentNotice(?FeedbackProject $project = null): string
    {
        return '已請'.FeedbackProject::clientRoleFor($project).'確認完成：單維持「'.FeedbackReportStatus::NeedsInput->label($project).'」，要等'.FeedbackProject::clientRoleFor($project).'按「'.self::APPROVE_LABEL.'」才會變成已完成。';
    }

    /** 給 CLI、MCP、API 說明文字用。 */
    public const RULE_TEXT = '做完且驗過畫面後用「請老師確認完成」（request_completion）：只會發一則附「通過」按鈕的確認留言，單維持等客戶，由客戶按「通過」才變成已完成；不可以直接改成已完成。';

    /** 網頁上寫調整重點的回應（410）。 */
    public const ADJUSTMENT_WEB_DISABLED = '調整重點已停用，網頁不能再編輯；請改用留言說明改了什麼。';

    /** 已停用的調整重點：舊入口照常寫入，但提醒改用留言。 */
    public const ADJUSTMENT_DEPRECATED = '調整重點已停用，請改用留言說明改了什麼；這次仍照常寫入，但網頁上只會當成「過去的處理說明」唯讀顯示。';
}
