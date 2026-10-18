// Minimal types for the Node.js built-ins the Worker uses through the nodejs_compat flag.
declare module 'node:buffer' {
    export class Buffer extends Uint8Array {
        static from(data: ArrayBuffer | ArrayBufferView | string, encoding?: 'base64' | 'utf8'): Buffer;
        toString(encoding?: 'base64' | 'utf8'): string;
    }
}
