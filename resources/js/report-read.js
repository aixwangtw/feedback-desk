// 某張單讀過之後，清單、看板上這張單的未讀標示（標題右邊的紅色小圓點數字、舊的留言按鈕數字、「重點已更新」）一併拿掉。
// 詳情視窗與右下角面板共用這一份，不各寫一份選擇器。

export const readMarkerSelector = (reportId) => {
    const id = CSS.escape(reportId);

    return [
        `[data-unread-slot="${id}"] [data-unread-dot]`,
        `[data-chat-open="${id}"] [data-unread-badge]`,
        `[data-adjustment-updated="${id}"]`,
    ].join(', ');
};

export const clearReportUnread = (reportId, root = document) => {
    root.querySelectorAll(readMarkerSelector(reportId)).forEach((marker) => marker.remove());
};
