#!/usr/bin/env node
/**
 * Builds everything the npm package ships:
 *   dist/public/      static files served by Workers Static Assets (CSS, JS)
 *   dist/worker/      the Worker bundle
 *   dist/cli.js       the feedback-desk command
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

rmSync(dist, { recursive: true, force: true });
const assets = join(dist, 'public', 'assets');
mkdirSync(assets, { recursive: true });

await build({
    entryPoints: [join(root, 'client', 'feedback.js')],
    outfile: join(assets, 'app.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
});

execFileSync(join(root, 'node_modules', '.bin', 'tailwindcss'), ['-i', join(root, 'client', 'app.css'), '-o', join(assets, 'app.css'), '--minify'], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
});

writeFileSync(join(dist, 'public', 'robots.txt'), 'User-agent: *\nDisallow:\n');
for (const icon of ['favicon.ico', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png']) {
    copyFileSync(join(root, 'client', icon), join(dist, 'public', icon));
}

const assetVersion = createHash('sha256')
    .update(readFileSync(join(assets, 'app.css')))
    .update(readFileSync(join(assets, 'app.js')))
    .digest('hex')
    .slice(0, 10);

await build({
    entryPoints: { index: join(root, 'src', 'worker', 'index.tsx') },
    outdir: join(dist, 'worker'),
    // The MCP SDK (with zod) is about 650 KiB; it sits in its own chunk that is loaded only by /mcp
    // requests, so page requests do not pay for compiling it.
    splitting: true,
    chunkNames: 'chunk-[hash]',
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: ['es2022'],
    conditions: ['workerd', 'worker', 'browser', 'import'],
    mainFields: ['module', 'main'],
    external: ['node:*', 'cloudflare:*'],
    jsx: 'automatic',
    jsxImportSource: 'hono/jsx',
    minify: true,
    legalComments: 'none',
    metafile: true,
    define: {
        __ASSET_VERSION__: JSON.stringify(assetVersion),
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
}).then((result) => {
    for (const [file, output] of Object.entries(result.metafile.outputs)) {
        console.log(`${file.replace(`${root}/`, '')}: ${(output.bytes / 1024).toFixed(1)} KiB`);
    }
});

await build({
    entryPoints: [join(root, 'src', 'cli', 'bin.ts')],
    outfile: join(dist, 'cli.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node20'],
    banner: { js: '#!/usr/bin/env node' },
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    legalComments: 'none',
});

console.log(`assets version ${assetVersion}`);
