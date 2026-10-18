import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
    const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
    return {
        plugins: [
            cloudflareTest({
                wrangler: { configPath: './wrangler.test.jsonc' },
                miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
            }),
        ],
        test: {
            include: ['test/worker/**/*.test.ts', 'test/worker/**/*.test.tsx'],
            setupFiles: ['./test/worker/apply-migrations.ts'],
        },
    };
});
