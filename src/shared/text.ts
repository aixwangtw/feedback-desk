/** Length in Unicode code points, matching PHP mb_strlen used by the Laravel version. */
export function charLength(value: string): number {
    let count = 0;
    for (const _ of value) {
        count += 1;
    }
    return count;
}

/** First `max` code points of `value`. */
export function charSlice(value: string, max: number): string {
    if (value.length <= max) {
        return value;
    }
    let result = '';
    let count = 0;
    for (const char of value) {
        if (count >= max) {
            break;
        }
        result += char;
        count += 1;
    }
    return result;
}

/**
 * Laravel Str::slug equivalent for project slugs: ASCII letters, digits and dashes. Non-ASCII
 * names (for example Chinese) produce an empty slug, so the caller must pass --slug.
 */
export function slugify(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
