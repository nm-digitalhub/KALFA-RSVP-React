import { createClient } from '@supabase/supabase-js';
import type { Page } from 'next/experimental/testmode/playwright';

import { resolveLocalTestDb } from '@/lib/outreach/test-db-guard';

import { expect, test } from './fixtures';

// The setup flow of a new event, end to end: from the first event to the management page, and a close during setup.
// What it holds (openspec separate-event-setup-from-management, the event-setup and event-closure specs):
//   - until the server records the payment, every customer route of the event shows setup, with ONE step list;
//   - the purchase ends setup and lands the owner on the management page, with no step list;
//   - a close during setup retires the unpaid package in the same operation, with one audit row;
//   - no customer screen of the flow says "קמפיין".
// Each test runs as its own new account (tests/fixtures.ts) against the local stack; CardCom is the test's stand-in.

const WORD = 'קמפיין';
const EVENT_URL = /\/app\/events\/([0-9a-f-]{36})(?:\/setup)?$/;

const steps = (page: Page) => page.getByRole('group', { name: 'שלבי ההקמה' });

/** A setup screen: its step heading, exactly one step list, and none of the retired word. */
async function expectSetupScreen(page: Page, heading: string): Promise<void> {
  await expect(page.getByRole('heading', { name: heading, level: 2 })).toBeVisible();
  await expect(steps(page)).toHaveCount(1);
  await expect(page.getByRole('main')).not.toContainText(WORD);
}

/** Creates the account's first event and returns its id; the owner lands in setup. */
async function createEvent(page: Page): Promise<string> {
  await page.goto('/app');
  await page.getByRole('link', { name: 'יצירת האירוע הראשון' }).click();
  await page.getByRole('textbox', { name: 'שם האירוע' }).fill('חתונת בדיקה');
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
  return EVENT_URL.exec(new URL(page.url()).pathname)![1];
}

async function confirmDetails(page: Page): Promise<void> {
  for (const box of await page.getByRole('main').getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: 'אישור פרטי האירוע והמשך' }).click();
}

async function choosePackage(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'בחירה והמשך להסכם' }).click();
}

async function approveTerms(page: Page): Promise<void> {
  for (const box of await page.getByRole('main').getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: 'אישור והמשך לתשלום' }).click();
}

/** Fills the cardholder details (a valid Israeli ID) and pays; the card fields are the stand-in's frames. */
async function pay(page: Page): Promise<void> {
  await page.getByLabel('תעודת זהות של בעל הכרטיס').fill('123456782');
  await page.getByLabel('טלפון נייד').fill('0501234567');
  await page.getByLabel('כתובת (רחוב ומספר)').fill('רחוב הבדיקה 1');
  await page.getByLabel('עיר').fill('תל אביב');
  await page.getByLabel('חודש תוקף (MM)').fill('12');
  await page.getByLabel('שנה (YY)').fill('30');
  await page.getByRole('button', { name: /^שלם/ }).click();
}

function localAdmin() {
  const env = resolveLocalTestDb();
  return createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

test.describe('event setup', () => {
  test('a new owner goes through every setup step, pays, and lands on the management page', async ({ page }) => {
    const eventId = await createEvent(page);

    await expectSetupScreen(page, 'אישור פרטי האירוע');
    await expect(steps(page)).toContainText('אישורי ההגעה פעילים');
    await confirmDetails(page);

    await expectSetupScreen(page, 'בחירת חבילה');
    // During setup the management routes send the owner back into setup.
    await page.goto(`/app/events/${eventId}`);
    await expect(page).toHaveURL(`/app/events/${eventId}/setup`);
    await page.goto(`/app/events/${eventId}/guests`);
    await expect(page).toHaveURL(`/app/events/${eventId}/setup`);
    await choosePackage(page);

    await expectSetupScreen(page, 'אישור תנאי החבילה');
    await approveTerms(page);

    // The payment renders inside the same setup shell, step list included.
    await expect(page).toHaveURL(new RegExp(`/app/events/${eventId}/campaign/[0-9a-f-]{36}/payment$`));
    await expectSetupScreen(page, 'תשלום החבילה');
    await expect(page).not.toHaveTitle(new RegExp(WORD));
    await pay(page);

    // The recorded purchase ends setup: the event page is the management page, with no step list.
    await expect(page).toHaveURL(`/app/events/${eventId}`, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'אישורי הגעה', level: 2 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'אישורי הגעה ותוצאות' })).toBeVisible();
    await expect(steps(page)).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText(WORD);

    // And setup now sends the owner to the event page.
    await page.goto(`/app/events/${eventId}/setup`);
    await expect(page).toHaveURL(`/app/events/${eventId}`);
  });

  test('closing during setup retires the unpaid package, keeps the record, and shows the closed event', async ({
    page,
    account,
  }) => {
    const eventId = await createEvent(page);
    await confirmDetails(page);

    // Back from the package step stays inside setup.
    await expectSetupScreen(page, 'בחירת חבילה');
    await page.getByRole('button', { name: 'חזרה: פרטי האירוע' }).click();
    await expect(page).toHaveURL(`/app/events/${eventId}/setup?step=details`);
    await page.goto(`/app/events/${eventId}/setup`);
    await choosePackage(page);

    // A chosen, unpaid package: the close is offered, with a confirmation.
    await expectSetupScreen(page, 'אישור תנאי החבילה');
    await page.getByRole('button', { name: 'סגירת האירוע' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('לסגור את האירוע?');
    await dialog.getByRole('button', { name: 'סגירת האירוע' }).click();

    await expect(page).toHaveURL(`/app/events/${eventId}`);
    await expect(page.getByRole('main')).toContainText('הסתיים');
    await expect(page.getByRole('main')).not.toContainText(WORD);

    // In the database: the event closed and its unpaid service cancelled together, nothing deleted, one audit row.
    const db = localAdmin();
    const { data: event } = await db.from('events').select('status').eq('id', eventId).single();
    expect(event?.status).toBe('closed');
    const { data: campaigns } = await db.from('campaigns').select('id, status').eq('event_id', eventId);
    expect(campaigns).toHaveLength(1);
    expect(campaigns![0].status).toBe('cancelled');
    const { data: audit } = await db
      .from('activity_log')
      .select('user_id, meta')
      .eq('event_id', eventId)
      .eq('action', 'event.closed');
    expect(audit).toEqual([
      { user_id: account.id, meta: { retiredCampaignId: campaigns![0].id, statusBefore: 'pending_approval' } },
    ]);
  });
});
