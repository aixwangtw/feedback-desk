# 回饋系統專案規則

## 介面

- 按鈕文字一律不換行。全站共用樣式（`app.css` 的 base 層）已對 `button`、`summary`、`[role=tab]`、`.inline-flex` 加上 `white-space: nowrap`；
  放不下時縮小左右內距（例如 `px-3 sm:px-5`）、加 `shrink-0`，或改成只顯示圖示並保留 `aria-label`，不要讓字斷成兩行。
  真的需要換行的地方明確寫 `whitespace-normal`。
- 改按鈕樣式後，用 375px、768px、1280px 三種寬度各看一次。
- 待審留言（草稿）、拖曳上傳預覽、附件名稱標題各只寫一份，單頁、詳情視窗、右下角面板共用：
  草稿畫面是 Laravel 的 `resources/views/feedback/reports/_drafts.blade.php`（CF 版 `src/worker/views/report.tsx` 的 `DraftsSection`），
  按鈕行為是 `message-drafts.js`；拖曳預覽是 `attachment-composer.js`；附件標題是 `attachment-caption` 元件。改一處，三處一起變。
- 清單與看板（2026-11-07 使用者原話「列表縮得太精簡 我沒有這樣說」）：只拿掉標題旁標籤、每列留言按鈕、調整重點欄；附件（縮圖，影片有播放圖示）、分類、建立日期、操作（編輯、刪除）照原順序保留。
  操作按鈕與縮圖點下去不能觸發整列點擊（row-link.js 以連結、按鈕等互動元件排除）。以後要拿掉或新增欄位，先問使用者。
- 附件縮圖與名稱：寬度只在 `resources/css/app.css` 的 `--attachment-tile-width`（桌面 10rem、手機 7rem）改，留言、待審留言、相簿、拖曳預覽共用 `.attachment-tile`、`.attachment-tile-thumb`、`.attachment-caption`（名稱完整顯示、換行最多 3 行，不用省略號）。
- 相簿（附件）位置照主流產品：詳情視窗與單頁在說明下方、活動時間軸上方，標題「附件（N）」、預設展開、超過一排顯示「顯示全部」（`album.js`）；右下角面板在對話標題列放相簿鈕，切到面板內的附件頁（可返回對話），不放在對話串裡。草稿附件只有團隊看得到。
- 留言的編輯與收回（使用者原話「每則對話都要編輯、收回功能 不用留痕跡」）：每則自己發的留言旁有「⋯」選單（`x-feedback.message-menu`、`x-feedback.message-edit-form`，單頁、詳情、面板共用，邏輯 `message-edit.js`）。
  團隊身分的留言任何開發者可動，老師只能動自己的（`FeedbackMessage::isManageableBy`）。不留痕跡：不顯示「已編輯」，收回用軟刪除、畫面與 API 都當它不存在（附件網址也 404），不改單的狀態。
  網頁、CLI（`feedback:message-edit`、`feedback:message-withdraw`）、MCP（`edit_message`、`withdraw_message`）、巡檢 API（PUT／DELETE `.../messages/{id}`）都走 `ManageFeedbackMessageAction`，不要另寫。新增查詢留言的地方一律走 Eloquent 關聯（預設排除已收回），不要用 DB::table 直接查 feedback_messages。
