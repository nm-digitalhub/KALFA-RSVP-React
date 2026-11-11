import { createClient } from '@supabase/supabase-js';
import type { Page } from 'next/experimental/testmode/playwright';

import { resolveLocalTestDb } from '@/lib/outreach/test-db-guard';

import { expect, test } from './fixtures';

// The cookie-consent config is read through a `'use cache'` function (src/lib/consent/admin-config.ts). These tests
// hold, against the production build, what only a running server can show:
//   - the cached value is served although the database changed behind the server's back;
//   - an administrator's change is seen by the very next request (the action expires the cache tag);
//   - a failed read is the baseline for that request only, and is never kept as the value.
// What is observed is the category status on the public /cookies page, which renders the same config.
//
// The config is one global row, so the tests run one after the other and put back what they changed.

test.describe.configure({ mode: 'serial' });

const ACTIVE = 'פעיל';
const DISABLED = 'מושבת זמנית';

function localAdmin() {
  const env = resolveLocalTestDb();
  return createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The status pill of a category section on /cookies, found by the section's heading. */
function status(page: Page, heading: RegExp) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: heading }) }).locator('span').first();
}
const analytics = (page: Page) => status(page, /עוגיות אנליטיקה/);
const marketing = (page: Page) => status(page, /עוגיות שיווק ורימרקטינג/);

/** Writes the flags straight into the database: no action runs, so no cache tag is expired. */
async function writeBehindTheServer(flags: Record<string, boolean>): Promise<void> {
  const { error } = await localAdmin().from('app_settings').update(flags).eq('id', true);
  expect(error).toBeNull();
}

/** Makes the test's account a platform owner, so it may open /admin and change the settings. */
async function makeOwner(userId: string): Promise<void> {
  const db = localAdmin();
  const { data: role, error: roleError } = await db.from('platform_roles').select('id').eq('is_owner_role', true).single();
  expect(roleError).toBeNull();
  const { error } = await db.from('platform_staff').insert({ user_id: userId, role_id: role!.id, granted_by: userId });
  expect(error).toBeNull();
}

/** Opens /admin/cookie-consent and puts a category's checkbox in the wanted state, without submitting. */
async function prepareCategory(page: Page, label: string, on: boolean) {
  await page.goto('/admin/cookie-consent');
  const form = page.locator('form').filter({ has: page.getByLabel(label) });
  await form.getByLabel(label).setChecked(on);
  return form;
}

/** Sets a category through the admin form. A real change expires the cache tag; the notice says which it was. */
async function setCategoryAsAdmin(page: Page, label: string, on: boolean): Promise<void> {
  const form = await prepareCategory(page, label, on);
  await form.getByRole('button', { name: 'עדכון' }).click();
  await expect(form.getByText(on ? /הופעלה/ : /כובתה/)).toBeVisible();
}

test.describe('cached cookie-consent config', () => {
  test.beforeAll(async () => {
    await writeBehindTheServer({ cookie_consent_analytics_enabled: true, cookie_consent_marketing_enabled: true });
  });
  test.afterAll(async () => {
    await writeBehindTheServer({ cookie_consent_analytics_enabled: true, cookie_consent_marketing_enabled: true });
  });

  test('the cached value outlives a change made behind the server, and an admin change is seen at once', async ({
    page,
    account,
  }) => {
    await makeOwner(account.id);
    // Through the form, so the cache starts from a known, freshly read value whatever an earlier run left in it.
    await setCategoryAsAdmin(page, 'קטגוריית שיווק/רימרקטינג מוצעת', false);
    await setCategoryAsAdmin(page, 'קטגוריית שיווק/רימרקטינג מוצעת', true);

    await page.goto('/cookies');
    await expect(analytics(page)).toHaveText(ACTIVE);
    await expect(marketing(page)).toHaveText(ACTIVE);

    // The database changes, no action runs: the server keeps answering from its cache.
    await writeBehindTheServer({ cookie_consent_marketing_enabled: false });
    await page.goto('/cookies');
    await expect(marketing(page)).toHaveText(ACTIVE);

    // The administrator turns analytics off: the action expires the tag, and the next request reads the database,
    // so BOTH changes show.
    await setCategoryAsAdmin(page, 'קטגוריית אנליטיקה מוצעת', false);
    await page.goto('/cookies');
    await expect(analytics(page)).toHaveText(DISABLED);
    await expect(marketing(page)).toHaveText(DISABLED);
  });

  test('a failed read is the baseline for that request only: the next request reads again', async ({ page, account, next }) => {
    await makeOwner(account.id);
    // A stored value that is NOT the baseline: analytics off (the baseline offers every category).
    await writeBehindTheServer({ cookie_consent_analytics_enabled: true, cookie_consent_marketing_enabled: true });
    await setCategoryAsAdmin(page, 'קטגוריית אנליטיקה מוצעת', false);

    // From the next admin change on, the server's read of the config fails. That change expires the cached entry, so
    // the read is attempted again and has nothing to fall back on but the baseline.
    let failing = false;
    const seen: string[] = [];
    next.onFetch((request) => {
      const url = new URL(request.url);
      const readsTheConfig =
        request.method === 'GET' &&
        url.pathname.startsWith('/rest/v1/app_settings') &&
        url.search.includes('cookie_consent_analytics_enabled');
      if (!readsTheConfig) return undefined;
      seen.push(failing ? 'failed' : 'read');
      return failing ? 'abort' : undefined;
    });
    const form = await prepareCategory(page, 'קטגוריית שיווק/רימרקטינג מוצעת', false);
    failing = true;
    const saved = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes('/admin/cookie-consent'));
    await form.getByRole('button', { name: 'עדכון' }).click();
    await saved;

    await page.goto('/cookies');
    // The read failed: the page shows the baseline (the category offered), not the stored "off".
    await expect(analytics(page)).toHaveText(ACTIVE);
    expect(seen).toContain('failed');

    failing = false;
    await page.goto('/cookies');
    // Nothing was kept from the failure: this request read the database and shows what is stored.
    await expect(analytics(page)).toHaveText(DISABLED);
    await expect(marketing(page)).toHaveText(DISABLED);
  });
});
