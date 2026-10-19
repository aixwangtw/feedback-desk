import type { FC } from 'hono/jsx';

/**
 * Display-only formatting for report descriptions and adjustment notes; stored text stays plain.
 * "1." / "1、" / "1)" lines become a numbered list, "※" lines a hint, short "Label：" prefixes bold.
 * Line breaks are kept. All text goes through JSX children, so it is always escaped.
 */

const NUMBERED_LINE = /^\s*(\d{1,3})(?:[.．](?!\d)|[、)）])\s*(\S.*)$/u;
const NOTE_LINE = /^\s*※\s*(.*)$/u;
const LABEL_PREFIX = /^(?!\d+[：:])([^\s：:，,。、；;！!？?「」『』（）()[\]【】]{1,12})(：|:(?![\d/]))\s*(.*)$/su;

export type RichTextBlock =
    | { type: 'paragraph'; lines: string[] }
    | { type: 'note'; text: string }
    | { type: 'list'; items: Array<{ number: number; lines: string[] }> };

export function parseRichText(text: string): RichTextBlock[] {
    const trimmed = text.replace(/^[\r\n]+|[\r\n]+$/g, '');
    if (trimmed === '') return [];
    const blocks: RichTextBlock[] = [];
    let current: RichTextBlock | null = null;
    let sawBlankLine = false;
    const flush = () => {
        if (current) blocks.push(current);
        current = null;
    };

    for (const raw of trimmed.split(/\r\n|\r|\n/)) {
        const line = raw.trimEnd();
        if (line.trim() === '') {
            sawBlankLine = true;
            continue;
        }
        const numbered = NUMBERED_LINE.exec(line);
        if (numbered) {
            if (!current || current.type !== 'list') {
                flush();
                current = { type: 'list', items: [] };
            }
            (current as Extract<RichTextBlock, { type: 'list' }>).items.push({ number: Number(numbered[1]), lines: [numbered[2].trimEnd()] });
            sawBlankLine = false;
            continue;
        }
        if (current && (current as RichTextBlock).type === 'list' && !sawBlankLine) {
            const items = (current as Extract<RichTextBlock, { type: 'list' }>).items;
            items[items.length - 1].lines.push(line);
            continue;
        }
        if (NOTE_LINE.test(line)) {
            flush();
            blocks.push({ type: 'note', text: line });
            sawBlankLine = false;
            continue;
        }
        if (!current || (current as RichTextBlock).type !== 'paragraph' || sawBlankLine) {
            flush();
            current = { type: 'paragraph', lines: [] };
        }
        (current as Extract<RichTextBlock, { type: 'paragraph' }>).lines.push(line);
        sawBlankLine = false;
    }
    flush();
    return blocks;
}

const Line: FC<{ line: string }> = ({ line }) => {
    const match = LABEL_PREFIX.exec(line);
    if (!match) return <>{line}</>;
    const separator = match[2] === ':' && match[3] !== '' ? ' ' : '';
    return (
        <>
            <strong class="font-semibold text-slate-950" data-rich-text-label>{match[1] + match[2]}</strong>
            {separator + match[3]}
        </>
    );
};

const Lines: FC<{ lines: string[] }> = ({ lines }) => (
    <p class="whitespace-pre-wrap">
        {lines.map((line, index) => (
            <>
                {index > 0 ? '\n' : ''}
                <Line line={line} />
            </>
        ))}
    </p>
);

const Note: FC<{ line: string }> = ({ line }) => (
    <p class="flex gap-1.5 rounded-lg border-l-4 border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900" data-rich-text-note>
        <span class="shrink-0 font-bold" aria-hidden="true">※</span>
        <span class="min-w-0 whitespace-pre-wrap"><Line line={NOTE_LINE.exec(line)?.[1] ?? ''} /></span>
    </p>
);

/** Inside a list item, plain continuation lines stay together; "※" lines become hints. */
function itemChunks(lines: string[]): Array<{ note: string } | { lines: string[] }> {
    const chunks: Array<{ note: string } | { lines: string[] }> = [];
    let buffer: string[] = [];
    for (const line of lines) {
        if (NOTE_LINE.test(line)) {
            if (buffer.length > 0) chunks.push({ lines: buffer });
            buffer = [];
            chunks.push({ note: line });
        } else {
            buffer.push(line);
        }
    }
    if (buffer.length > 0) chunks.push({ lines: buffer });
    return chunks;
}

export const RichText: FC<{ text: string | null | undefined; compact?: boolean }> = ({ text, compact }) => (
    <div class={`${compact ? 'space-y-2 leading-6' : 'space-y-3 leading-7'} break-words text-sm text-slate-700`} data-rich-text>
        {parseRichText(text ?? '').map((block) =>
            block.type === 'list' ? (
                <ol class="space-y-2">
                    {block.items.map((item) => (
                        <li value={item.number} class="flex gap-2.5">
                            <span class="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-teal-50 px-1.5 text-xs font-bold leading-none text-teal-800 ring-1 ring-teal-200" aria-hidden="true">{item.number}</span>
                            <div class="min-w-0 flex-1 space-y-1.5">
                                {itemChunks(item.lines).map((chunk) => ('note' in chunk ? <Note line={chunk.note} /> : <Lines lines={chunk.lines} />))}
                            </div>
                        </li>
                    ))}
                </ol>
            ) : block.type === 'note' ? (
                <Note line={block.text} />
            ) : (
                <Lines lines={block.lines} />
            ),
        )}
    </div>
);
