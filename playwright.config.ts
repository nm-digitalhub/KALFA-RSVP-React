import { defineConfig, devices } from '@playwright/test';

// E2E tests of KALFA against an isolated stack: the app's E2E build on 127.0.0.1:3998 (npm run e2e:build / e2e:start,
// NODE_ENV=test, so Next.js reads .env.test.local and never .env.local) and the local Supabase stack. The tests import
// `test` from tests/fixtures.ts, which runs every test under Next's test mode; defineConfig comes from Playwright itself so
// no default project or server of Next's sample config is merged in.
//
// Next.js recommends running Playwright against the production build (guides/testing/playwright), hence build + start.
export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:3998',
    trace: 'on-first-retry',
    // page.route must see every request; a service worker would answer some of them first (Playwright docs: network).
    serviceWorkers: 'block',
    locale: 'he-IL',
  },
  // Chromium only: it is the browser installed for this Playwright version.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run e2e:build && npm run e2e:start',
    url: 'http://127.0.0.1:3998/auth/login',
    reuseExistingServer: !process.env.CI,
    timeout: 15 * 60 * 1000,
  },
});
