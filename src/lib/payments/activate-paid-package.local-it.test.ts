// activatePaidPackage against the LOCAL stack (design D23, task 21.2). Real: the function, activateCampaignAfterPayment,
// the guarded transition, the ledger (beginOperation / completeOperation and their DB triggers), events, campaigns and
// activity_log in local Supabase. Replaced: Slack only (an outbound side effect). No session anywhere: that is the point.
//
// Fixture difference from a real purchase, as in cardcom-webhook-activation.local-it.test.ts: the pricing round is left
// unlocked and the payment row has no lines, because a locked round and ledger lines can never be deleted and would
// stay in the shared local DB. Neither is read by the activation (requirePackageFunding reads the ledger state;
// transitionCampaignStatus only asks that a round exists).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import {
  type Fixture,
  FixtureScope,
  type FixtureOptions,
  type LocalIntegrationEnv,
  newPool,
  requireLocalIntegrationEnv,
  useLocalAdminEnv,
} from '@/lib/testing/local-integration';

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;
const PRICE = 1;

vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn(async () => undefined) }));

describe.skipIf(!RUN)('activatePaidPackage (local)', () => {
  let pool: Pool;
  let scope: FixtureScope;

  beforeAll(async () => {
    useLocalAdminEnv(ENV!);
    pool = newPool(ENV!, 'activate-paid-package');
    scope = new FixtureScope(pool);
  });

  afterAll(async () => {
    if (!RUN) return;
    try {
      await scope.cleanup();
    } finally {
      await pool.end();
    }
  });

  // An approved campaign with a pricing round and one package payment, settled as `outcome`.
  async function campaignWithPayment(
    outcome: 'succeeded' | 'pending',
    opts: FixtureOptions = {},
  ): Promise<{ f: Fixture; operationId: string }> {
    const f = await scope.create({ campaignStatus: 'approved', noOutbound: true, ...opts });
    await pool.query(
      `insert into public.campaign_pricing (campaign_id, list_price, discount_amount, package_price) values ($1, $2, 0, $2)`,
      [f.campaignId, PRICE],
    );
    const { beginOperation, completeOperation } = await import('@/lib/payments/ledger');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient();
    const begun = await beginOperation(admin, {
      campaignId: f.campaignId,
      eventId: f.eventId,
      kind: 'package_purchase',
      amount: PRICE,
      provider: 'cardcom',
      providerTerminal: 99_999,
      providerOperation: 'ChargeOnly',
      meta: { payerUserId: f.ownerId, provider: 'cardcom' },
    });
    if (!('id' in begun)) throw new Error('fixture: the payment row was not opened');
    if (outcome === 'succeeded') await completeOperation(admin, begun.id, { from: 'pending', outcome: 'succeeded' });
    return { f, operationId: begun.id };
  }

  const state = async (f: Fixture) => {
    const r = await pool.query(
      `select c.status::text status, c.thankyou_send_at,
              (select count(*)::int from public.activity_log a
                where a.action = 'campaign.activated' and a.meta->>'campaignId' = $1::text) activations,
              (select a.meta->>'actor' from public.activity_log a
                where a.action = 'campaign.activated' and a.meta->>'campaignId' = $1::text limit 1) actor
         from public.campaigns c where c.id = $1::uuid`,
      [f.campaignId],
    );
    return r.rows[0] as { status: string; thankyou_send_at: string | null; activations: number; actor: string | null };
  };

  const run = async (campaignId: string, operationId: string) => {
    const { activatePaidPackage } = await import('@/lib/payments/activate-paid-package');
    return activatePaidPackage(campaignId, operationId);
  };

  it('starts a paid approved campaign: active, one system activation row, thank-you default set', async () => {
    const { f, operationId } = await campaignWithPayment('succeeded');
    await expect(run(f.campaignId, operationId)).resolves.toBe('started');
    const s = await state(f);
    expect(s, JSON.stringify(s)).toMatchObject({ status: 'active', activations: 1, actor: 'system' });
    expect(s.thankyou_send_at).not.toBeNull();
  });

  it('a second call changes nothing: already_active, still one row', async () => {
    const { f, operationId } = await campaignWithPayment('succeeded');
    await run(f.campaignId, operationId);
    const first = await state(f);
    await expect(run(f.campaignId, operationId)).resolves.toBe('already_active');
    const s = await state(f);
    expect(s).toMatchObject({ status: 'active', activations: 1 });
    expect(s.thankyou_send_at).toEqual(first.thankyou_send_at);
  });

  it('a late call after staff paused the service leaves it paused: not_applicable', async () => {
    const { f, operationId } = await campaignWithPayment('succeeded');
    await run(f.campaignId, operationId);
    await pool.query(`update public.campaigns set status = 'paused' where id = $1`, [f.campaignId]);
    await expect(run(f.campaignId, operationId)).resolves.toBe('not_applicable');
    expect(await state(f)).toMatchObject({ status: 'paused', activations: 1 });
  });

  it('repairs a run that stopped after the status write: fails while fresh, completes once quiet', async () => {
    const { f, operationId } = await campaignWithPayment('succeeded');
    // The status write happened, its completion did not (no activation row, no thank-you default).
    await pool.query(`update public.campaigns set status = 'active' where id = $1`, [f.campaignId]);
    const { ACTIVATION_ROW_PENDING, REPAIR_AFTER_MS } = await import('@/lib/payments/activate-paid-package');

    await expect(run(f.campaignId, operationId)).rejects.toThrow(ACTIVATION_ROW_PENDING);
    const fresh = await state(f);
    expect(fresh).toMatchObject({ status: 'active', activations: 0 });
    expect(fresh.thankyou_send_at).not.toBeNull(); // the idempotent half is done at once

    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + REPAIR_AFTER_MS + 5_000);
    try {
      await expect(run(f.campaignId, operationId)).resolves.toBe('already_active');
    } finally {
      clock.mockRestore();
    }
    expect(await state(f)).toMatchObject({ status: 'active', activations: 1, actor: 'system' });
  });

  it('refuses once the event day has passed, and leaves the campaign approved', async () => {
    // The database never accepts a past event date (events_before_insert R2, events_guard_update), so an event becomes
    // past only as time passes: the application clock is moved past the fixture's event (30 days out) instead.
    const { f, operationId } = await campaignWithPayment('succeeded');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 40 * 86_400_000);
    try {
      await expect(run(f.campaignId, operationId)).rejects.toThrow('האירוע כבר חלף');
    } finally {
      clock.mockRestore();
    }
    expect(await state(f)).toMatchObject({ status: 'approved', activations: 0 });
  });

  it('refuses an unpaid campaign: the named payment is not a succeeded purchase', async () => {
    const { f, operationId } = await campaignWithPayment('pending');
    await expect(run(f.campaignId, operationId)).rejects.toThrow('הפעלת מערכת נדחתה');
    expect(await state(f)).toMatchObject({ status: 'approved', activations: 0 });
  });

  // The browser routes' inline call: it finds the payment in the ledger itself, and reports instead of throwing.
  it('startPaidPackageNow starts a paid campaign from its own ledger read, then answers started again', async () => {
    const { f } = await campaignWithPayment('succeeded');
    const { startPaidPackageNow } = await import('@/lib/payments/activate-paid-package');
    await expect(startPaidPackageNow(f.campaignId)).resolves.toBe('started');
    await expect(startPaidPackageNow(f.campaignId)).resolves.toBe('started');
    expect(await state(f)).toMatchObject({ status: 'active', activations: 1, actor: 'system' });
  });

  it('startPaidPackageNow on an unpaid campaign answers failed and changes nothing', async () => {
    const { f } = await campaignWithPayment('pending');
    const { startPaidPackageNow } = await import('@/lib/payments/activate-paid-package');
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(startPaidPackageNow(f.campaignId)).resolves.toBe('failed');
    } finally {
      quiet.mockRestore();
    }
    expect(await state(f)).toMatchObject({ status: 'approved', activations: 0 });
  });
});
