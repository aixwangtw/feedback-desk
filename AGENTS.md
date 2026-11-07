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
- 附件即時更新（2026-11-07 使用者原話「留言內的新附件 要更新附件欄位 方便隨時從列表查看」「不要只是置頂對話」）：列表、看板、詳情相簿、面板相簿的附件都來自 `FeedbackAlbum`（單張單用 `items`，列表用 `listItemsForReports`，同一套規則：原始附件＋未收回留言的附件，草稿只進團隊的相簿），前端縮圖用 `feedback.reports._attachment-thumbs`（列表、看板、輪詢端點共用）。
  列表縮圖最新的排最前、最多 3 張＋「+N」，點了直接開附件燈箱（見下方規則，不開詳情）；`attachment-thumbs.js` 每 8 秒輪詢 `feedback.attachment-thumbs.index`（也聽 `feedback:album-changed`）。面板相簿鈕固定在標題列、徽章顯示數量、有新附件時變色提示（`data-album-new`），返回對話還原原本的捲動位置。不要把相簿做回置頂在對話串裡。
- 「完成」鈕只有一個元件 `x-feedback.complete-button`（列表、看板、詳情窄欄共用）：客戶端確認後直接完成；團隊端開確認留言視窗（`_completion-dialog`），單維持等客戶，已完成不顯示。
- 詳情窄欄（`_detail-side`）是左右兩欄「標籤｜值」：狀態（左膠囊、右完成鈕）、建立者、建立時間、最後更新；編輯、完整頁一列，其他收進「⋯」選單（`data-action-menu`），刪除紅字。「留言」區標題文字只寫在 `config('feedback.labels.thread')`（原本叫「活動」）。
- 留言區不列狀態變更紀錄（`FeedbackTimeline` 只回留言）。團隊一律顯示人名：個人帳號顯示帳號 `name`，共用身分（含 AI 代發）顯示 `FeedbackTeamName::shared()`（`FEEDBACK_SHARED_OWNER_NAME`，兩站都設 Alex）；畫面不顯示「開發者」或「（Claude Code）」，agent 只存資料庫。公開回報單維持團隊稱呼（不讓陌生人知道團隊是誰）。狀態名稱「等工程師」不改。
- 列表與看板的操作按鈕一律並排不換行（2026-11-07 使用者原話「操作按鈕要並排 不要換行 附件點開只看附件 規則 可用現有欄位的寬度縮小空格」）：放不下就縮其他欄位的寬度與左右內距（編號、狀態、建立者、建立日期、最後更新，日期用短格式 `<x-feedback.time short>`），不准讓操作欄換行或把按鈕上下堆疊。標題欄要保留足夠寬度，1280 寬整張表不可出現橫向捲軸（表格不設 `min-w`）。看板卡片的操作按鈕同樣並排。改完用 375 與 1280 各看一次。
- 附件縮圖點開只開附件燈箱：列表、看板縮圖與「+N」不開詳情、不捲相簿，一律開 `<dialog data-image-lightbox>`（`resources/js/attachment-lightbox.js`），只顯示這張單的附件，可左右切換、影片直接播放、下方顯示名稱／來自哪則留言／時間，Esc 或點背景關閉。燈箱與詳情、面板相簿共用同一個元件；清單縮圖的資料由 `_attachment-thumbs` 以 `data-lightbox-gallery` 帶入（來源仍是 `FeedbackAlbum`，客戶端拿不到草稿附件）。
- 確認視窗（2026-11-07 使用者原話「點完成跟刪除都要彈出確認視窗」，後更正「通過、完成不跳」）：只有「刪除單」與「收回留言」（含捨棄待審留言）先跳確認視窗，用網站自己的元件 `x-feedback.confirm-dialog`＋`confirm-dialog.js`，不用瀏覽器 `confirm()`；文字只寫在 `App\Support\FeedbackConfirmText`，要寫明刪的是哪張單或哪則留言。客戶端「完成」「通過」直接執行不跳；團隊端「完成」維持可改字的確認留言視窗。
