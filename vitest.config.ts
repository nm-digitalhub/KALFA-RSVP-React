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
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { TZ: 'Asia/Jerusalem' },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
