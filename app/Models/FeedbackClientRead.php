<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * 每個客戶帳號各自的已讀時間。
 */
#[Fillable(['feedback_client_account_id', 'feedback_report_id', 'last_read_at'])]
class FeedbackClientRead extends Model
{
    public $timestamps = false;

    public $incrementing = false;

    protected $primaryKey = null;

    protected function casts(): array
    {
        return [
            'last_read_at' => 'datetime',
        ];
    }
}
