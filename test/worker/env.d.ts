declare namespace Cloudflare {
    interface Env {
        DB: D1Database;
        UPGRADE_DB: D1Database;
        FILES: R2Bucket;
        APP_SECRET: string;
        TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    }
    interface GlobalProps {
        mainModule: typeof import('../../src/worker/index');
    }
}
