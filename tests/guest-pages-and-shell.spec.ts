import { createClient } from '@supabase/supabase-js';
import type { Page } from 'next/experimental/testmode/playwright';

import { resolveLocalTestDb } from '@/lib/outreach/test-db-guard';

import { expect, test } from './fixtures';

// The screens the event-setup flow never opens, in a real browser against the production build:
//   - the three guest pages a token opens (/r, /g, /ty), for an unknown token and for a published event;
//   - the signed-in account menu, in the customer shell and in the public site header, and its sign-out;
//   - the customer area's error screen, and that its retry recovers once the cause is gone.
// Each test runs as its own new account (tests/fixtures.ts) against the local stack.

const UNKNOWN_RSVP_TOKEN = 'a'.repeat(24);
const UNKNOWN_EVENT_TOKEN = '0'.repeat(32);
const INVALID_RSVP_LINK = 'קישור אישור ההגעה אינו תקף, פג תוקפו או בוטל.';
const INVALID_EVENT_LINK = 'הקישור אינו תקף או שאינו זמין עוד.';
const GUEST_NAME = 'אורחת הבדיקה';
const EVENT_NAME = 'חתונת בדיקה';

function localAdmin() {
  const env = resolveLocalTestDb();
  return createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Uncaught exceptions in the page: a client/server-boundary or a menu-composition fault shows up here, not in the DOM. */
function collectPageErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (error) => errors.push(error));
  return errors;
}

/** Creates the account's first event through the form and returns its id. */
async function createEvent(page: Page): Promise<string> {
  await page.goto('/app');
  await page.getByRole('link', { name: 'יצירת האירוע הראשון' }).click();
  await page.getByRole('textbox', { name: 'שם האירוע' }).fill(EVENT_NAME);
  await page.getByRole('textbox', { name: 'שם מלא של החתן' }).fill('דני כהן');
  await page.getByRole('textbox', { name: 'שם מלא של הכלה' }).fill('רוני לוי');
  await page.getByRole('combobox', { name: 'תאריך האירוע – יום' }).selectOption('15');
  await page.getByRole('combobox', { name: 'תאריך האירוע – חודש' }).selectOption('06');
  await page.getByRole('combobox', { name: 'תאריך האירוע – שנה' }).selectOption(String(new Date().getFullYear() + 1));
  await page.getByRole('combobox', { name: 'שעת האירוע – שעה' }).selectOption('20');
  await page.getByRole('combobox', { name: 'שעת האירוע – דקות' }).selectOption({ index: 1 });
  await page.getByRole('textbox', { name: 'מיקום' }).fill('אולמי הבדיקה');
  await page.getByRole('textbox', { name: 'כתובת המקום' }).fill('רחוב הבדיקה 1, תל אביב');
  await page.getByRole('button', { name: 'יצירת אירוע' }).click();
  await expect(page).toHaveURL(/\/app\/events\/[0-9a-f-]{36}\/setup$/);
  return /\/app\/events\/([0-9a-f-]{36})\/setup$/.exec(new URL(page.url()).pathname)![1];
}

test.describe('guest pages', () => {
  test('an unknown token gets one generic message on each page, and nothing about the event', async ({ page }) => {
    const errors = collectPageErrors(page);

    await page.goto(`/r/${UNKNOWN_RSVP_TOKEN}`);
    await expect(page.getByText(INVALID_RSVP_LINK)).toBeVisible();

    for (const path of [`/g/${UNKNOWN_EVENT_TOKEN}`, `/ty/${UNKNOWN_EVENT_TOKEN}`]) {
      await page.goto(path);
      await expect(page.getByText(INVALID_EVENT_LINK)).toBeVisible();
    }
    // A token of the wrong shape is refused the same way, before any lookup.
    await page.goto('/g/not-a-token');
    await expect(page.getByText(INVALID_EVENT_LINK)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('a published event opens for its own tokens: the RSVP form, the gift page and the thank-you page', async ({ page }) => {
    const errors = collectPageErrors(page);
    const eventId = await createEvent(page);

    // The event is published and given a gift link straight in the LOCAL database: this test is about what a guest
    // sees, and the owner's own path to a published event is event-setup.spec.ts.
    const db = localAdmin();
    const { data: event, error: eventError } = await db
      .from('events')
      .update({ status: 'active', gift_payment_url: 'https://payments.example.com/gift' })
      .eq('id', eventId)
      .select('gift_link_token')
      .single();
    expect(eventError).toBeNull();
    const { data: guest, error: guestError } = await db
      .from('guests')
      .insert({ event_id: eventId, full_name: GUEST_NAME })
      .select('rsvp_token')
      .single();
    expect(guestError).toBeNull();

    await page.goto(`/r/${guest!.rsvp_token}`);
    await expect(page.getByText(INVALID_RSVP_LINK)).toHaveCount(0);
    await expect(page.getByRole('main')).toContainText(GUEST_NAME);

    await page.goto(`/g/${event!.gift_link_token}`);
    await expect(page.getByText(INVALID_EVENT_LINK)).toHaveCount(0);
    await expect(page.getByRole('main')).toContainText(/דני|רוני|חתונת בדיקה/);

    await page.goto(`/ty/${event!.gift_link_token}`);
    await expect(page.getByText(INVALID_EVENT_LINK)).toHaveCount(0);
    await expect(page.getByRole('main')).toContainText(/דני|רוני|חתונת בדיקה/);

    // One event's token opens nothing of another's: the RSVP page refuses the event token.
    await page.goto(`/r/${event!.gift_link_token}`);
    await expect(page.getByText(INVALID_RSVP_LINK)).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe('account menu', () => {
  test('the customer shell shows who is signed in, and signing out ends the session', async ({ page, account }) => {
    const errors = collectPageErrors(page);
    await page.goto('/app');

    await page.getByRole('button', { name: /לקוח בדיקה/ }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('לקוח בדיקה');
    await expect(menu).toContainText(account.email);
    await expect(menu.getByRole('menuitem', { name: 'הגדרות' })).toBeVisible();

    await menu.getByRole('menuitem', { name: 'התנתקות' }).click();
    await expect(page).not.toHaveURL(/\/app(\/|$)/);
    // The session is gone: the customer area sends an anonymous visitor to sign in.
    await page.goto('/app');
    await expect(page).toHaveURL(/\/auth\/login/);

    expect(errors).toEqual([]);
  });

  test('the public site header offers the signed-in visitor their area and a sign-out', async ({ page }) => {
    const errors = collectPageErrors(page);
    await page.goto('/');

    await page.getByRole('button', { name: 'תפריט משתמש' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toContainText('לקוח בדיקה');
    await expect(menu.getByRole('menuitem', { name: 'התנתקות' })).toBeVisible();

    expect(errors).toEqual([]);
  });
});

test.describe('customer error screen', () => {
  test('a failed load shows the generic screen without the cause, and retry recovers once it is gone', async ({ page, next }) => {
    // The server's read of the events list fails while `broken` is on. Registered after the fixture's own handler, so
    // it is asked first (Next's test mode walks its handlers newest first) and passes everything else on.
    let broken = true;
    next.onFetch((request) => (broken && new URL(request.url).pathname.startsWith('/rest/v1/events') ? 'abort' : undefined));

    await page.goto('/app');
    await expect(page.getByRole('heading', { name: 'משהו השתבש' })).toBeVisible();
    const body = await page.locator('body').innerText();
    for (const leak of ['rest/v1', 'fetch failed', 'AbortError', 'at async']) expect(body).not.toContain(leak);

    broken = false;
    await page.getByRole('button', { name: 'נסו שוב' }).click();
    await expect(page.getByRole('heading', { name: 'משהו השתבש' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'יצירת האירוע הראשון' })).toBeVisible();
  });
});
