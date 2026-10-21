// Separate Vitest config for the LOCAL-ONLY integration suite (`*.local-it.test.ts`).
// `npm run test` also collects those files but they skip there (no OUTREACH_DB_IT),
// and refuse to run under the unit config even with it (no network guard).
//
// Run through scripts/integration/run-local.sh, which reads the local stack's
// credentials from `supabase status` and refuses anything that is not
// 127.0.0.1:54322 / http://127.0.0.1:54321. globalSetup re-checks the targets
// in-process; setupFiles installs the egress guard in every worker.
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// KALFA_IT_PROBE: used only by cleanup.local-it.test.ts, which spawns a child run of
// the deliberately failing/crashing probe file to prove cleanup from the outside.
const PROBE = process.env.KALFA_IT_PROBE;

export default defineConfig({
  test: {
    environment: 'node',
    include: PROBE
      ? ['src/lib/testing/cleanup.probe.ts']
      : ['src/**/*.local-it.test.ts', 'src/lib/outreach/test-db-guard.test.ts', 'src/lib/testing/network-guard.test.ts'],
    env: { TZ: 'Asia/Jerusalem', NODE_ENV: 'test' },
    globalSetup: ['./src/lib/testing/integration-global-setup.ts'],
    setupFiles: ['./src/lib/testing/integration-setup.ts'],
    // Files share one local database (webhook_inbox claims, billing keys); run
    // them one at a time so no file observes another's committed fixtures.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    server: { deps: { inline: ['@workflowbuilder/sdk', '@workflowbuilder/ui'] } },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws outside a React Server Component bundle; the modules
      // under test are server modules, exercised here from Node directly.
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
});
