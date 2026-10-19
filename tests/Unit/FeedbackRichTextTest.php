<?php

namespace Tests\Unit;

use App\Support\FeedbackRichText;
use PHPUnit\Framework\TestCase;

class FeedbackRichTextTest extends TestCase
{
    public function test_numbered_lines_become_an_ordered_list_keeping_their_numbers(): void
    {
        $html = (string) FeedbackRichText::render("1. 第一項\n2、第二項\n3）第三項");

        $this->assertSame(1, substr_count($html, '<ol'));
        $this->assertSame(3, substr_count($html, '<li '));
        $this->assertStringContainsString('<li value="1"', $html);
        $this->assertStringContainsString('<li value="2"', $html);
        $this->assertStringContainsString('<li value="3"', $html);
        $this->assertStringContainsString('第二項', $html);
        $this->assertStringNotContainsString('2、', $html);
    }

    public function test_short_leading_labels_are_bold(): void
    {
        $html = (string) FeedbackRichText::render("1. 辨識錯誤：已修正\n說明：補充\nNote: english");

        $this->assertStringContainsString('<strong class="font-semibold text-slate-950" data-rich-text-label>辨識錯誤：</strong>已修正', $html);
        $this->assertStringContainsString('data-rich-text-label>說明：</strong>補充', $html);
        $this->assertStringContainsString('data-rich-text-label>Note:</strong> english', $html);
    }

    public function test_sentences_times_and_urls_are_not_treated_as_labels(): void
    {
        $html = (string) FeedbackRichText::render("關於這點，我們的看法：不變\n12:30 開會\nhttps://example.com/a");

        $this->assertStringNotContainsString('<strong', $html);
        $this->assertStringContainsString('https://example.com/a', $html);
    }

    public function test_note_lines_get_the_hint_style_and_stay_inside_the_preceding_item(): void
    {
        $blocks = FeedbackRichText::parse("3. 詳解：已讀好\n※ 照片請改用上傳\n4. 浮水印：已去除");

        $this->assertCount(1, $blocks);
        $this->assertSame('list', $blocks[0]['type']);
        $this->assertSame([3, 4], array_column($blocks[0]['items'], 'number'));
        $this->assertSame(['詳解：已讀好', '※ 照片請改用上傳'], $blocks[0]['items'][0]['lines']);

        $html = (string) FeedbackRichText::render("※ 獨立提示\n一般文字");
        $this->assertStringContainsString('data-rich-text-note', $html);
        $this->assertStringContainsString('獨立提示', $html);
        $this->assertStringNotContainsString('※ 獨立提示', $html);
    }

    public function test_line_breaks_are_preserved_and_blank_lines_split_paragraphs(): void
    {
        $html = (string) FeedbackRichText::render("第一行\n第二行\n\n第二段");

        $this->assertStringContainsString("<p class=\"whitespace-pre-wrap\">第一行\n第二行</p>", $html);
        $this->assertStringContainsString('<p class="whitespace-pre-wrap">第二段</p>', $html);
    }

    public function test_decimal_numbers_do_not_start_a_list(): void
    {
        $this->assertSame('paragraph', FeedbackRichText::parse('1.5 倍的字級')[0]['type']);
    }

    public function test_everything_is_escaped_before_markup_is_added(): void
    {
        $html = (string) FeedbackRichText::render("1. <b>標籤</b>：<script>alert(1)</script>\n※ <img src=x onerror=alert(1)>\n<a href=\"javascript:x\">連結</a>：值");

        $this->assertStringNotContainsString('<script>', $html);
        $this->assertStringNotContainsString('<img', $html);
        $this->assertStringNotContainsString('<a href', $html);
        $this->assertStringNotContainsString('<b>', $html);
        $this->assertStringContainsString('&lt;script&gt;alert(1)&lt;/script&gt;', $html);
        $this->assertStringContainsString('&lt;img src=x onerror=alert(1)&gt;', $html);
    }

    public function test_empty_text_renders_an_empty_container(): void
    {
        $this->assertSame([], FeedbackRichText::parse(''));
        $this->assertStringContainsString('data-rich-text', (string) FeedbackRichText::render(null));
    }
}
