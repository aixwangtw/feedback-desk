# 回饋系統專案規則

## 介面

- 按鈕文字一律不換行。全站共用樣式（`app.css` 的 base 層）已對 `button`、`summary`、`[role=tab]`、`.inline-flex` 加上 `white-space: nowrap`；
  放不下時縮小左右內距（例如 `px-3 sm:px-5`）、加 `shrink-0`，或改成只顯示圖示並保留 `aria-label`，不要讓字斷成兩行。
  真的需要換行的地方明確寫 `whitespace-normal`。
- 改按鈕樣式後，用 375px、768px、1280px 三種寬度各看一次。
- 待審留言（草稿）、拖曳上傳預覽、附件名稱標題各只寫一份，單頁、詳情視窗、右下角面板共用：
  草稿畫面是 Laravel 的 `resources/views/feedback/reports/_drafts.blade.php`（CF 版 `src/worker/views/report.tsx` 的 `DraftsSection`），
  按鈕行為是 `message-drafts.js`；拖曳預覽是 `attachment-composer.js`；附件標題是 `attachment-caption` 元件。改一處，三處一起變。
- Jira 式清單與詳情（2026-11-07 同步 Laravel 版）：以下各自只寫一份，清單、看板、詳情、單頁、右下角面板共用，改一處就是全部：
  編號與標題的連結樣式 `REPORT_LINK_CLASS`、未讀小圓點 `UNREAD_DOT_CLASS`（`src/worker/views/chat-classes.ts`）；
  相簿 `Album`（`lib/album.ts` 組清單）、活動時間軸 `Activity`（`shared/timeline.ts` 排序）、右側窄欄 `DetailSide`、確認完成視窗 `RequestCompletionDialog`（都在 `views/report.tsx`）；
  確認留言預設文字、「通過」文字、調整重點停用提示、狀態改變提示都在 `src/shared/completion.ts`，請客戶確認完成的動作只有 `lib/completion.ts` 的 `requestCompletion` 一個，網頁、CLI、MCP、API、巡檢 API 共用。
- 待審留言（草稿）的附件只有團隊拿得到：相簿的草稿項目只在 `viewerIsOwner` 時組出，客戶端的 HTML 與 JSON 不含，草稿檔網址對客戶回 403（`test/worker/jira-redesign.test.ts` 有測）。
- 改清單列／看板卡片要同時改 `rows.ts`（字串版，正式用）與 `rows-reference.tsx`（JSX 參考版），`test/worker/rows.test.tsx` 逐位元比對。
