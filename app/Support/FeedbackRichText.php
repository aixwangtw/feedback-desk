<?php

namespace App\Support;

use Illuminate\Support\HtmlString;

/**
 * 把回饋單「說明」「調整說明」的純文字排版成好讀的 HTML，只在顯示時使用，資料維持純文字。
 *
 * 規則：行首「1.」「1、」「1)」為編號清單；行首「※」為提示；行首「XXX：」短標籤加粗；
 * 其餘換行原樣保留。所有文字一律先跳脫再包標記。
 */
class FeedbackRichText
{
    private const NUMBERED_LINE = '/^\s*(\d{1,3})(?:[.．](?!\d)|[、)）])\s*(\S.*)$/u';

    private const NOTE_LINE = '/^\s*※\s*(.*)$/u';

    private const LABEL_PREFIX = '/^(?!\d+[：:])([^\s：:，,。、；;！!？?「」『』（）()\[\]【】]{1,12})(：|:(?![\d\/]))\s*(.*)$/us';

    public static function render(?string $text, bool $compact = false): HtmlString
    {
        $blocks = self::parse((string) $text);
        $html = '';

        foreach ($blocks as $block) {
            $html .= match ($block['type']) {
                'list' => self::renderList($block['items']),
                'note' => self::renderNote($block['text']),
                default => '<p class="whitespace-pre-wrap">'.self::renderLines($block['lines']).'</p>',
            };
        }

        $spacing = $compact ? 'space-y-2 leading-6' : 'space-y-3 leading-7';

        return new HtmlString('<div class="'.$spacing.' break-words text-sm text-slate-700" data-rich-text>'.$html.'</div>');
    }

    /**
     * @return list<array{type: 'paragraph', lines: list<string>}|array{type: 'note', text: string}|array{type: 'list', items: list<array{number: int, lines: list<string>}>}>
     */
    public static function parse(string $text): array
    {
        $lines = preg_split('/\r\n|\r|\n/', trim($text, "\r\n")) ?: [];
        $blocks = [];
        $current = null;
        $sawBlankLine = false;

        foreach ($lines as $line) {
            if (trim($line) === '') {
                $sawBlankLine = true;

                continue;
            }

            if (preg_match(self::NUMBERED_LINE, $line, $match)) {
                if ($current === null || $current['type'] !== 'list') {
                    self::flush($blocks, $current);
                    $current = ['type' => 'list', 'items' => []];
                }
                $current['items'][] = ['number' => (int) $match[1], 'lines' => [rtrim($match[2])]];
                $sawBlankLine = false;

                continue;
            }

            $isNote = preg_match(self::NOTE_LINE, $line) === 1;

            if ($current !== null && $current['type'] === 'list' && ! $sawBlankLine) {
                $current['items'][array_key_last($current['items'])]['lines'][] = rtrim($line);

                continue;
            }

            if ($isNote) {
                self::flush($blocks, $current);
                $blocks[] = ['type' => 'note', 'text' => rtrim($line)];
                $sawBlankLine = false;

                continue;
            }

            if ($current === null || $current['type'] !== 'paragraph' || $sawBlankLine) {
                self::flush($blocks, $current);
                $current = ['type' => 'paragraph', 'lines' => []];
            }
            $current['lines'][] = rtrim($line);
            $sawBlankLine = false;
        }

        self::flush($blocks, $current);

        return $blocks;
    }

    /**
     * @param  list<array<string, mixed>>  $blocks
     * @param  array<string, mixed>|null  $current
     */
    private static function flush(array &$blocks, ?array &$current): void
    {
        if ($current !== null) {
            $blocks[] = $current;
            $current = null;
        }
    }

    /**
     * @param  list<array{number: int, lines: list<string>}>  $items
     */
    private static function renderList(array $items): string
    {
        $html = '<ol class="space-y-2">';

        foreach ($items as $item) {
            $html .= '<li value="'.$item['number'].'" class="flex gap-2.5">'
                .'<span class="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-teal-50 px-1.5 text-xs font-bold leading-none text-teal-800 ring-1 ring-teal-200" aria-hidden="true">'.$item['number'].'</span>'
                .'<div class="min-w-0 flex-1 space-y-1.5">'.self::renderItemLines($item['lines']).'</div>'
                .'</li>';
        }

        return $html.'</ol>';
    }

    /**
     * 清單項目內：一般續行併在同段保留換行，※ 行獨立成提示。
     *
     * @param  list<string>  $lines
     */
    private static function renderItemLines(array $lines): string
    {
        $html = '';
        $buffer = [];

        foreach ($lines as $line) {
            if (preg_match(self::NOTE_LINE, $line) === 1) {
                if ($buffer !== []) {
                    $html .= '<p class="whitespace-pre-wrap">'.self::renderLines($buffer).'</p>';
                    $buffer = [];
                }
                $html .= self::renderNote($line);

                continue;
            }
            $buffer[] = $line;
        }

        if ($buffer !== []) {
            $html .= '<p class="whitespace-pre-wrap">'.self::renderLines($buffer).'</p>';
        }

        return $html;
    }

    private static function renderNote(string $line): string
    {
        preg_match(self::NOTE_LINE, $line, $match);

        return '<p class="flex gap-1.5 rounded-lg border-l-4 border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900" data-rich-text-note>'
            .'<span class="shrink-0 font-bold" aria-hidden="true">※</span>'
            .'<span class="min-w-0 whitespace-pre-wrap">'.self::renderLine($match[1] ?? '').'</span></p>';
    }

    /**
     * @param  list<string>  $lines
     */
    private static function renderLines(array $lines): string
    {
        return implode("\n", array_map(self::renderLine(...), $lines));
    }

    private static function renderLine(string $line): string
    {
        if (preg_match(self::LABEL_PREFIX, $line, $match)) {
            $separator = $match[2] === ':' && $match[3] !== '' ? ' ' : '';

            return '<strong class="font-semibold text-slate-950" data-rich-text-label>'.e($match[1].$match[2]).'</strong>'.$separator.e($match[3]);
        }

        return e($line);
    }
}
