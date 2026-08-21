import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests run in a Node environment. Most testable logic is server-side
// (Zod schemas, ownership filtering, auth helpers); component tests can add a
// jsdom environment later if needed.
//
// TZ is pinned so a test suite full of dates gives the same answer on any
// machine. Without it the runner inherits the host, and a scheduling test that
// passes on a server set to Israel can fail in CI set to UTC — or, worse, pass
// in both while asserting different things. Asia/Jerusalem is the product's
// only timezone, so pinning it also means a test that quietly depends on local
// time is testing the behaviour users actually get.
// NODE_ENV is pinned for the same reason as TZ, and for a measured one:
// vitest defaults it to 'test' only when it is UNSET, so an inherited value
// wins. The fleet's qa-runner is spawned from a pm2 process whose environment
// declares NODE_ENV=production (ecosystem.config.cjs), and that leaked into
// the suite — src/lib/url.ts:50 deliberately throws when APP_ORIGIN is unset
// in production, so 2 tests in url.test.ts failed there and passed everywhere
// else. Isolated 2026-07-29: the same run with APP_ORIGIN supplied passes,
// which confirms the trigger is the environment, not the code under test.
// A test run must not depend on who invoked it.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { TZ: 'Asia/Jerusalem', NODE_ENV: 'test' },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
