import { describe, expect, it } from 'vitest';
import type { Report } from '../../src/worker/lib/models';
import { AdjustmentBlock } from '../../src/worker/views/report';
import { parseRichText, RichText } from '../../src/worker/views/rich-text';

const render = (text: string) => String(<RichText text={text} />);

describe('RichText display formatting', () => {
    it('turns numbered lines into an ordered list that keeps the numbers', () => {
        const html = render('1. 第一項\n2、第二項\n3）第三項');
        expect(html.match(/<ol/g)).toHaveLength(1);
        expect(html.match(/<li /g)).toHaveLength(3);
        for (const n of [1, 2, 3]) expect(html).toContain(`<li value="${n}"`);
        expect(html).not.toContain('2、');
    });

    it('makes short leading labels bold', () => {
        const html = render('1. 辨識錯誤：已修正\n說明：補充\nNote: english');
        expect(html).toContain('<strong class="font-semibold text-slate-950" data-rich-text-label="true">辨識錯誤：</strong>已修正');
        expect(html).toContain('data-rich-text-label="true">說明：</strong>補充');
        expect(html).toContain('data-rich-text-label="true">Note:</strong> english');
    });

    it('does not treat sentences, times or URLs as labels', () => {
        const html = render('關於這點，我們的看法：不變\n12:30 開會\nhttps://example.com/a');
        expect(html).not.toContain('<strong');
        expect(html).toContain('https://example.com/a');
    });

    it('styles ※ lines as hints and keeps them inside the preceding item', () => {
        const blocks = parseRichText('3. 詳解：已讀好\n※ 照片請改用上傳\n4. 浮水印：已去除');
        expect(blocks).toEqual([{ type: 'list', items: [{ number: 3, lines: ['詳解：已讀好', '※ 照片請改用上傳'] }, { number: 4, lines: ['浮水印：已去除'] }] }]);
        const html = render('※ 獨立提示\n一般文字');
        expect(html).toContain('data-rich-text-note');
        expect(html).not.toContain('※ 獨立提示');
    });

    it('keeps line breaks and splits paragraphs on blank lines', () => {
        const html = render('第一行\n第二行\n\n第二段');
        expect(html).toContain('<p class="whitespace-pre-wrap">第一行\n第二行</p>');
        expect(html).toContain('<p class="whitespace-pre-wrap">第二段</p>');
    });

    it('does not start a list on decimal numbers', () => {
        expect(parseRichText('1.5 倍的字級')[0].type).toBe('paragraph');
    });

    it('escapes everything', () => {
        const html = render('1. <b>標籤</b>：<script>alert(1)</script>\n※ <img src=x onerror=alert(1)>\n<a href="javascript:x">連結</a>：值');
        expect(html).not.toMatch(/<script>|<img|<a href|<b>/);
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    });

    it('is used by the shared adjustment block', () => {
        const report = { adjustment_note: '1. 浮水印：已去除\n※ 淡陰影可能變淡' } as Report;
        const html = String(<AdjustmentBlock report={report} adjustmentAttachments={[]} attachmentUrl={() => ''} />);
        expect(html).toContain('data-adjustment-note');
        expect(html).toContain('data-rich-text-label="true">浮水印：</strong>已去除');
        expect(html).toContain('data-rich-text-note');
    });
});
