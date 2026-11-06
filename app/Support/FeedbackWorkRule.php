<?php

namespace App\Support;

/**
 * 處理回饋單的共用工作規則：MCP server instructions、set_status 工具說明、內建自動處理的提示詞都引用這裡，
 * 讓不論用哪個 AI 工具處理單都看到同一條規則。
 */
final class FeedbackWorkRule
{
    public const TEXT = '工作規則：使用者只給回饋看板網址並說「修」，就代表授權直接處理：逐張修好、自己檢查確認 OK 後，把狀態改成等客戶（needs_input）。不可以直接改成已完成（completed），已完成要等提出的人或負責人確認。驗證沒過或需要人決定的單，不要改狀態，寫交接紀錄或留言說明原因。';

    /** 開發團隊（含 AI、CLI、MCP、API）改成已完成時的拒絕說明。 */
    public const COMPLETED_BY_CLIENT_ONLY = '已完成只由客戶按完成：請改成 needs_input（等客戶），由客戶在網頁上按「完成」結單。';
}
