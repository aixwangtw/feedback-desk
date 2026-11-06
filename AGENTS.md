# 回饋系統專案規則

## 介面

- 按鈕文字一律不換行。全站共用樣式（`app.css` 的 base 層）已對 `button`、`summary`、`[role=tab]`、`.inline-flex` 加上 `white-space: nowrap`；
  放不下時縮小左右內距（例如 `px-3 sm:px-5`）、加 `shrink-0`，或改成只顯示圖示並保留 `aria-label`，不要讓字斷成兩行。
  真的需要換行的地方明確寫 `whitespace-normal`。
- 改按鈕樣式後，用 375px、768px、1280px 三種寬度各看一次。
- 待審留言（草稿）、拖曳上傳預覽、附件名稱標題各只寫一份，單頁、詳情視窗、右下角面板共用：
  草稿畫面是 Laravel 的 `resources/views/feedback/reports/_drafts.blade.php`（CF 版 `src/worker/views/report.tsx` 的 `DraftsSection`），
  按鈕行為是 `message-drafts.js`；拖曳預覽是 `attachment-composer.js`；附件標題是 `attachment-caption` 元件。改一處，三處一起變。
