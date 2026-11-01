import './server-only';

import { createClient } from '@supabase/supabase-js';
import type { Page } from 'next/experimental/testmode/playwright';
import { PgBoss, type JobWithMetadata } from 'pg-boss';

import { resolveLocalTestDb, testDbSsl } from '@/lib/outreach/test-db-guard';
import { packageActivationJobId, QUEUES, type PackageActivationJob } from '@/lib/queue/queues';

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

/**
 * The package-activation worker, run in the test's own process as the pg-boss docs test a worker (docs/api/testing):
 * boss.work() with the worker's real handler and options (worker/main.ts), and a spy (__test__enableSpies) to wait
 * for the job to complete. The job itself is sent by the app's server; this instance only works it, which is what its
 * spy sees. It runs against the local stack only: the queues from the global setup, the admin client on the local API.
 * The two variables that client reads are set only while the worker runs: the test guard (resolveTestDb) takes a
 * NEXT_PUBLIC_SUPABASE_URL in the environment for the production one.
 */
async function withActivationWorker<T>(run: (boss: PgBoss) => Promise<T>): Promise<T> {
  const env = resolveLocalTestDb();
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.supabaseUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.serviceKey;
  const boss = new PgBoss({
    connectionString: env.dbUrl,
    ssl: testDbSsl(env.dbUrl),
    schema: 'pgboss',
    supervise: false,
    schedule: false,
    migrate: false,
    __test__enableSpies: true,
  });
  boss.on('error', () => {});
  try {
    const { runPackageActivationJob } = await import('@/lib/payments/package-activation-job');
    await boss.start();
    await boss.work(QUEUES.packageActivation, { includeMetadata: true }, async ([job]: JobWithMetadata<PackageActivationJob>[]) => ({
      result: await runPackageActivationJob(job),
    }));
    return await run(boss);
  } finally {
    await boss.stop({ graceful: false });
    for (const [name, value] of [['NEXT_PUBLIC_SUPABASE_URL', saved.url], ['SUPABASE_SERVICE_ROLE_KEY', saved.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
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
    const campaignId = /\/campaign\/([0-9a-f-]{36})\/payment$/.exec(new URL(page.url()).pathname)![1];
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

    // The recorded payment queued the package's start (design D23), under the payment's own id, and the worker runs it.
    // The payment path already started the service inline, so the job finds it running: 'already_active'.
    const { data: paid } = await localAdmin()
      .from('payment_operations')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('outcome', 'succeeded')
      .single();
    expect(paid).not.toBeNull();
    const job = await withActivationWorker((boss) =>
      boss.getSpy<PackageActivationJob>(QUEUES.packageActivation).waitForJob((data) => data.campaignId === campaignId, 'completed'),
    );
    expect(job.id).toBe(packageActivationJobId(paid!.id));
    expect(job.data).toEqual({ campaignId, operationId: paid!.id });
    expect(job.output).toEqual({ result: 'already_active' });
    const db = localAdmin();
    const { data: campaign } = await db.from('campaigns').select('status').eq('id', campaignId).single();
    expect(campaign?.status).toBe('active');
    const { data: activated } = await db.from('activity_log').select('id').eq('action', 'campaign.activated').eq('event_id', eventId);
    expect(activated).toHaveLength(1);
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
