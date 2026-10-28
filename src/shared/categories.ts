import { charLength } from './text';

/** 專案設定表單一次最多送多少字。 */
export const MAX_CATEGORY_INPUT_LENGTH = 1000;
export const MAX_CATEGORIES = 20;
export const MAX_CATEGORY_LENGTH = 50;

/** 去掉前後空白、空字串與重複，保留原順序。 */
export function normalizeCategories(categories: unknown[]): string[] {
    const normalized: string[] = [];
    for (const category of categories) {
        if (typeof category !== 'string') {
            continue;
        }
        const trimmed = category.trim();
        if (trimmed !== '' && !normalized.includes(trimmed)) {
            normalized.push(trimmed);
        }
    }
    return normalized;
}

/** 逗號（全形、半形）或換行分隔的輸入。 */
export function parseCategoryInput(input: string): string[] {
    return normalizeCategories(input.split(/[,，\r\n]+/u));
}

/** 超過數量或長度時的錯誤訊息；沒問題回 null。 */
export function categoryProblem(categories: string[]): string | null {
    if (categories.length > MAX_CATEGORIES) {
        return `分類最多 ${MAX_CATEGORIES} 個。`;
    }
    for (const category of categories) {
        if (charLength(category) > MAX_CATEGORY_LENGTH) {
            return `分類「${category}」太長，每個最多 ${MAX_CATEGORY_LENGTH} 字。`;
        }
    }
    return null;
}

/** 專案的 report_categories 欄位（JSON 陣列）；沒設定或壞掉時是空陣列，表示不分類。 */
export function projectCategories(project: { report_categories?: string | null }): string[] {
    if (!project.report_categories) {
        return [];
    }
    try {
        const parsed: unknown = JSON.parse(project.report_categories);
        return Array.isArray(parsed) ? normalizeCategories(parsed) : [];
    } catch {
        return [];
    }
}
