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
- 清單與看板（2026-11-07 補回改版時多拿掉的欄位）：只拿掉標題旁標籤、每列留言按鈕、調整重點欄；分類、附件（縮圖，影片有播放圖示）、建立日期、操作（編輯、刪除；客戶端另有完成）照改版前順序保留，列表附件由 `routes/web.tsx` 一次載入。操作按鈕、附件縮圖是連結／按鈕／表單，`row-link.js` 本來就不把它們當整列點擊。
- 附件縮圖與名稱：寬度只寫在 `client/app.css` 的 `--attachment-tile-width`（`attachment-tile`／`attachment-tile-thumb`，手機縮小），名稱用 `AttachmentCaption`（拖曳預覽的 JS 版樣式要一致），完整顯示、換行最多 3 行；留言、草稿、相簿、編輯表單、拖曳預覽都用這一份。
- 相簿（附件）：詳情視窗與單頁放在說明下方、活動時間軸上方（`Album`，預設展開、超過一排由 `client/album.js` 顯示「顯示全部」）；右下角面板不放在對話串裡，由標題列相簿鈕切到面板內附件頁（`data-album-force-all`）。對話端點的 JSON 另給 `album_html`、`album_count`，單頁用 `activity?part=album`。草稿附件只有團隊看得到。
- 編輯、收回自己的留言：每則留言旁的「⋯」選單（`MessageMenu`、`MessageEditForm`，單頁、詳情、面板共用，動作在 `client/message-edit.js`）。權限只看 `shared/message-manage.ts` 的 `canManageMessage`（團隊身分的留言任何開發者都可動；老師只能動自己的），網頁、API、MCP（edit_message、withdraw_message）、巡檢 API、CLI（message-edit、message-withdraw）共用 `lib/reports.ts` 的 `editMessage`、`withdrawMessage`。不留痕跡：不顯示「已編輯」，收回用軟刪除（`messages.deleted_at`，migration 0015），所有讀留言的 SQL 都要加 `deleted_at IS NULL`（新增查詢別忘了），附件網址一併 404；兩個動作都只動 `reports.updated_at`，不改狀態、不動「最後更新」。
