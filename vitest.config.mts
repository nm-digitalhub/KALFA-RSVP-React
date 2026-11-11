import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

// The setup of the Next.js Vitest guide (node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md):
// `plugins: [tsconfigPaths(), react()]` and `environment: 'jsdom'`. tsconfigPaths resolves the `@/*` alias from
// tsconfig.json, so no alias is declared here. Every test file gets a DOM by default; a file that must run without
// one says so with a `// @vitest-environment node` first line.
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
//
// WHAT `test.env` IS, and what it deliberately is NOT
// ---------------------------------------------------
// Vitest defines `test.env` as "custom environment variables assigned to
// `process.env` before running tests" — so the two entries above are the whole
// contract between the runner and the suite. Everything else a test needs it
// must declare itself.
//
// Vitest does NOT read .env/.env.local into process.env. That is opt-in, and the
// documented way to opt in is Vite's loadEnv:
//
//   import { loadEnv } from 'vite'
//   export default defineConfig(({ mode }) => ({
//     test: { env: loadEnv(mode, process.cwd(), '') },
//   }))
//
// We deliberately do NOT do that. Loading .env.local would make the suite depend
// on one machine's deployment configuration — the exact failure this file exists
// to prevent — and would pull live secrets into unit tests.
//
// MEASURED 2026-08-26, which is how this was settled rather than assumed:
// contacts.test.ts's reconcile-guard case passed only because
// RECONCILE_AUTHORIZED_SET_ENABLED happened to be exported in the invoking
// shell. The same file, unchanged, failed once that shell was replaced. Running
// it with the variable set to true, set to false, and unset now gives 26/26 in
// all three, because the tests stub the flag themselves.
//
// THE RULE: a test that depends on an env var sets it with `vi.stubEnv(...)` and
// clears it with `afterEach(() => vi.unstubAllEnvs())`. Never add a product flag
// here to make a test pass — pinning one state in the config also means the
// other state is never tested, and a kill-switch has two real states.
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    env: { TZ: 'Asia/Jerusalem', NODE_ENV: 'test' },
    // Persist transformed modules across runs. Vitest's own diagnostic asked for
    // it: MEASURED 2026-09-23, 39.11s of transforming — 27% of the run — redone
    // from scratch on every `vitest run`.
    //
    // ⚠️ A TOP-LEVEL `test` OPTION IN 5.x, NOT `test.experimental`. The published
    // docs still show `experimental.fsModuleCache` (Context7 indexes up to
    // 4.1.6); the installed 5.0.1 types declare it beside `css` and `cache`, with
    // `experimental_defineCacheKeyGenerator` deprecated in favour of
    // `defineCacheKeyGenerator`. The installed types are the authority.
    //
    // SAFE HERE BECAUSE NOTHING TRANSFORMS ON AN OUTSIDE FACTOR. The key is the
    // file's content, its id, Vite's environment config and coverage status; the
    // docs warn only about plugins whose output depends on something else, and
    // this config registers none. `test.env` above is applied at RUN time, not
    // transform time, so the pinned TZ / NODE_ENV cannot be baked into a cached
    // module. The cache lives in `node_modules/.vitest-cache`, so a reinstall
    // clears it and git never sees it.
    fsModuleCache: true,
  },
});
