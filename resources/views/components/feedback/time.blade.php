@props(['at', 'relative' => false])

@php
    // 資料庫以 UTC 儲存；畫面一律換算成台北時間，相對時間不會超過現在（避免時鐘誤差顯示「後」）。
    $local = $at->copy()->timezone('Asia/Taipei');
    $text = $relative
        ? ($local->isFuture() ? '剛剛' : $local->locale('zh_TW')->diffForHumans())
        : $local->format('Y/m/d H:i');
@endphp
<time datetime="{{ $at->toIso8601String() }}" title="{{ $local->format('Y/m/d H:i') }}（台北時間）" {{ $attributes }}>{{ $text }}</time>
