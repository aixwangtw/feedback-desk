import { parseArgs, type ParseArgsConfig } from 'node:util';
import { CliError } from './runtime';

export type Options = NonNullable<ParseArgsConfig['options']>;

export interface Parsed {
    values: Record<string, string | boolean | string[] | undefined>;
    positionals: string[];
}

export const COMMON_OPTIONS: Options = {
    url: { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
};

export function parse(argv: string[], options: Options): Parsed {
    try {
        const result = parseArgs({ args: argv, options: { ...COMMON_OPTIONS, ...options }, allowPositionals: true, strict: true });
        return { values: result.values as Parsed['values'], positionals: result.positionals };
    } catch (error) {
        throw new CliError(error instanceof Error ? error.message : String(error));
    }
}

export function str(parsed: Parsed, name: string): string | undefined {
    const value = parsed.values[name];
    return typeof value === 'string' ? value : undefined;
}

export function bool(parsed: Parsed, name: string): boolean {
    return parsed.values[name] === true;
}

export function list(parsed: Parsed, name: string): string[] {
    const value = parsed.values[name];
    if (Array.isArray(value)) return value;
    return typeof value === 'string' ? [value] : [];
}

export function requirePositional(parsed: Parsed, index: number, name: string): string {
    const value = parsed.positionals[index];
    if (value === undefined || value === '') {
        throw new CliError(`缺少參數 ${name}。`);
    }
    return value;
}
