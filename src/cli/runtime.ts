import { spawn, type SpawnOptions } from 'node:child_process';
import { homedir, platform, tmpdir } from 'node:os';

export interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

export interface RunOptions {
    cwd?: string;
    /** Show the child's output live while also capturing it. */
    stream?: boolean;
    /** Hand the terminal to the child (interactive commands such as `wrangler login`). */
    interactive?: boolean;
    env?: Record<string, string | undefined>;
    input?: string;
}

/** Everything a command touches outside its own logic, so tests can replace it. */
export interface Runtime {
    env: Record<string, string | undefined>;
    cwd: string;
    home: string;
    tmp: string;
    platform: NodeJS.Platform;
    fetch: typeof fetch;
    out: (text: string) => void;
    err: (text: string) => void;
    run: (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;
    openBrowser: (url: string) => Promise<boolean>;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
}

export function runProcess(command: string, args: string[], options: RunOptions = {}): Promise<RunResult> {
    return new Promise((resolve) => {
        const spawnOptions: SpawnOptions = {
            cwd: options.cwd,
            env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
            stdio: options.interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'],
            shell: process.platform === 'win32',
        };
        let child;
        try {
            child = spawn(command, args, spawnOptions);
        } catch (error) {
            resolve({ code: 127, stdout: '', stderr: String(error) });
            return;
        }
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
            if (options.stream) process.stdout.write(chunk);
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
            if (options.stream) process.stderr.write(chunk);
        });
        if (!options.interactive) {
            if (options.input !== undefined) {
                child.stdin?.end(options.input);
            } else {
                child.stdin?.end();
            }
        }
        child.on('error', (error) => resolve({ code: 127, stdout, stderr: stderr + String(error) }));
        child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    });
}

async function openBrowserDefault(url: string): Promise<boolean> {
    const os = platform();
    const candidates: Array<[string, string[]]> =
        os === 'darwin'
            ? [['open', [url]]]
            : os === 'win32'
              ? [['cmd', ['/c', 'start', '""', url]]]
              : [
                    ['xdg-open', [url]],
                    ['wslview', [url]],
                    ['cmd.exe', ['/c', 'start', '""', url.replaceAll('&', '^&')]],
                ];
    for (const [command, args] of candidates) {
        const result = await runProcess(command, args);
        if (result.code === 0) {
            return true;
        }
    }
    return false;
}

export function defaultRuntime(): Runtime {
    return {
        env: process.env,
        cwd: process.cwd(),
        home: homedir(),
        tmp: tmpdir(),
        platform: process.platform,
        fetch: globalThis.fetch.bind(globalThis),
        out: (text) => process.stdout.write(`${text}\n`),
        err: (text) => process.stderr.write(`${text}\n`),
        run: runProcess,
        openBrowser: openBrowserDefault,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
    };
}

export class CliError extends Error {
    constructor(
        message: string,
        readonly exitCode = 1,
    ) {
        super(message);
    }
}
