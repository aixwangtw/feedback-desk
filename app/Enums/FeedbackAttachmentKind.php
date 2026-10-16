<?php

namespace App\Enums;

enum FeedbackAttachmentKind: string
{
    /** 老師回報或留言附上的截圖。 */
    case Feedback = 'feedback';

    /** 開發者在「調整說明」附上的圖片，只有開發者能新增或刪除。 */
    case Adjustment = 'adjustment';
}
