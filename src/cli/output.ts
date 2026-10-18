/**
 * Report text comes from clients and strangers. Before printing it to a terminal, control
 * characters (ANSI escapes, carriage returns that overwrite lines, etc.) are shown as \\uXXXX so a
 * report cannot repaint the terminal or hide text from the person or agent reading it.
 */
export function escapeTerminal(value: unknown): string {
    return String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Single-line version: newlines and tabs are also escaped (for table cells). */
export function escapeInline(value: unknown): string {
    return escapeTerminal(value).replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

function charWidth(code: number): number {
    if (
        (code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe4f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1faff) ||
        (code >= 0x20000 && code <= 0x3fffd)
    ) {
        return 2;
    }
    return 1;
}

export function displayWidth(text: string): number {
    let width = 0;
    for (const char of text) {
        width += charWidth(char.codePointAt(0) ?? 0);
    }
    return width;
}

function truncate(text: string, max: number): string {
    if (displayWidth(text) <= max) {
        return text;
    }
    let result = '';
    let width = 0;
    for (const char of text) {
        const w = charWidth(char.codePointAt(0) ?? 0);
        if (width + w > max - 1) {
            break;
        }
        result += char;
        width += w;
    }
    return `${result}…`;
}

/** Box-less table with column widths that account for CJK double-width characters. */
export function table(headers: string[], rows: string[][], maxCell = 40): string {
    const cells = rows.map((row) => row.map((cell) => truncate(escapeInline(cell), maxCell)));
    const widths = headers.map((header, index) => Math.max(displayWidth(header), ...cells.map((row) => displayWidth(row[index] ?? ''))));
    const line = (values: string[]) => values.map((value, index) => value + ' '.repeat(Math.max(0, widths[index] - displayWidth(value)))).join('  ').trimEnd();
    return [line(headers), line(widths.map((width) => '-'.repeat(width))), ...cells.map(line)].join('\n');
}

export function twoColumn(label: string, value: string): string {
    return `  ${label}${' '.repeat(Math.max(1, 12 - displayWidth(label)))}${value}`;
}
