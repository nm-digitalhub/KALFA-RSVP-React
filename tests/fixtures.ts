import { randomUUID } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { expect, test as base, type Page } from 'next/experimental/testmode/playwright';

import { OPEN_FIELDS_ORIGIN } from '@/lib/cardcom/open-fields';
import { resolveLocalTestDb } from '@/lib/outreach/test-db-guard';

import { CardcomServer } from './cardcom';

// The E2E fixtures, on the patterns of the Playwright docs:
//   - one account per TEST, signed in through the login page, its storage state used by that test. The docs recommend
//     one account per parallel worker for tests that change server-side data (auth.md, "Moderate"); KALFA lets a
//     customer own ONE event (canCreateEvent), so two event-creating tests on one account would refuse each other, and
//     each test gets its own account instead;
//   - the account is created the way Supabase documents for a server: auth.admin.createUser with the service-role key,
//     email confirmed (reference/javascript/auth-admin-createuser), on the LOCAL stack only (resolveLocalTestDb, fed by
//     tests/global-setup.ts);
//   - every test runs under Next's test mode (next/experimental/testmode/playwright): the server's own outbound fetches
//     reach `serverFetch` below, so the local stack and the app itself go through, CardCom is answered by the test
//     (tests/cardcom.ts), and anything else is refused. The browser's CardCom frames are served the same way.
//
// The accounts and what they create stay in the local database. A purchase leaves a locked pricing round and ledger
// rows that nothing may delete (the guards behind purge_test_event), so there is no complete cleanup per test; the
// local database is reset with `supabase db reset --local`, and supabase/seed.sql restores the base data.

export type Account = { id: string; email: string; password: string };

// The cookie banner shows only while no choice is stored, so it may or may not cover the page: the Playwright way for such
// an overlay is a locator handler (page.addLocatorHandler, release notes 1.42/1.44), which answers it whenever it appears.
// "Essential only", the privacy-preserving choice.
async function dismissCookieBanner(page: Page): Promise<void> {
  await page.addLocatorHandler(page.getByRole('heading', { name: 'עוגיות באתר' }), async () => {
    await page.getByRole('button', { name: 'רק חיוניות' }).click();
  });
}

type TestFixtures = { cardcom: CardcomServer; account: Account; customerStorageState: string };

export const test = base.extend<TestFixtures>({
  account: [
    async ({}, use) => {
      const env = resolveLocalTestDb();
      const admin = createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const email = `e2e-${randomUUID().slice(0, 8)}@kalfa.test`;
      const password = `${randomUUID()}Aa1!`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'לקוח בדיקה', phone: '' },
      });
      if (error || !data.user) throw new Error(`E2E: local Auth refused the test account (${error?.message ?? 'no user'})`);
      await use({ id: data.user.id, email, password });
    },
    { scope: 'test' },
  ],

  customerStorageState: [
    async ({ browser, account, baseURL }, use, testInfo) => {
      const fileName = testInfo.outputPath('auth.json');
      // A clean context: the account is new for this test.
      const page = await browser.newPage({ storageState: undefined, baseURL });
      await dismissCookieBanner(page);
      await page.goto('/auth/login');
      await page.getByLabel('אימייל').fill(account.email);
      await page.getByLabel('סיסמה', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'התחברות', exact: true }).click();
      // The session cookie is set once the sign-in lands on the customer home (auth.md: wait for the final URL).
      await page.waitForURL('**/app');
      await page.context().storageState({ path: fileName });
      await page.close();
      await use(fileName);
    },
    { scope: 'test' },
  ],

  // The tuple form, like the fixtures above (Playwright accepts both).
  storageState: [({ customerStorageState }, use) => use(customerStorageState), { scope: 'test' }],

  cardcom: [
    async ({ next, page, baseURL }, use) => {
      const cardcom = new CardcomServer();
      const passThrough = new Set([new URL(resolveLocalTestDb().supabaseUrl).origin, new URL(baseURL!).origin]);
      next.onFetch((request) => {
        const origin = new URL(request.url).origin;
        // The local stack and the app itself are fetched by the test, not answered with 'continue': Next 16.4's test mode
        // reads the request body to hand it to this handler (buildProxyRequest, request.arrayBuffer()) and 'continue'
        // then replays that same, already-read request, so every write (an RPC, an insert) fails while reads work. This
        // is the README's "fetch loopback", kept to the allowed origins; the request here carries the body intact.
        if (passThrough.has(origin)) return fetch(request);
        if (origin === OPEN_FIELDS_ORIGIN) return cardcom.answer(request);
        // Refused, and said so: an app call that fails because of this rule must be visible in the test output. The origin
        // only, never the path or query, which can carry tokens.
        console.warn(`[e2e] refused a server call to ${origin}`);
        return 'abort';
      });
      await page.route(`${OPEN_FIELDS_ORIGIN}/**`, (route) => cardcom.frame(route));
      await dismissCookieBanner(page);
      await use(cardcom);
    },
    { auto: true },
  ],
});

export { expect };
