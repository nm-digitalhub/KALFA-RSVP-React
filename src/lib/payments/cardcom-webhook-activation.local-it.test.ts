// Why does a CardCom package payment that reaches the server only through CardCom's webhook (the buyer's browser closed
// before its settle call) not start the service? Run against the LOCAL stack, server path only: no page, no browser,
// no real charge.
//
// Every case uses an IDENTICAL fixture and the IDENTICAL CardCom answer; only the server requests differ:
//   B. the browser's settle call alone (POST /api/campaigns/[id]/purchase/settle)   → control, starts today;
//   C. the webhook first, then the browser's settle call (the buyer came back)       → control, starts today;
//   D. the webhook, then the EXISTING activation function called with no buyer session → diagnostic: a webhook carries
//      no session, and the activation as written today (activateCampaign, owner actor → requireOwnedEvent →
//      requireUser) needs one. Pins that "just call activateAfterPayment from the webhook" is not a fix;
//   A. the webhook alone                                                              → TARGET, fails until fixed.
//
// Real: both routes (POST handlers), the origin check, settleCardcomSession, the payment ledger and its DB triggers,
// activateCampaign / transitionCampaignStatus / requirePackageFunding, requireOwnedEvent's query (owner_id filter),
// requireUser's own code, the campaign row and activity_log in local Supabase.
// Replaced, at the boundary only:
//   - CardCom's GetLpResult (lowProfileGetLpResult): answers "paid ₪1 on terminal 99999";
//   - the CardCom connection reader (getCardcomServerConfig): its secret lives in Vault; the test gives terminal + name;
//   - Slack and the tax-ceiling re-check: outbound side effects;
//   - the request-scoped Supabase client (cookie transport) is the service-role client, which has no signed-in user;
//   - requireUser returns the event owner ONLY while a case plays the buyer's browser (B, C). Otherwise the real
//     requireUser runs, finds no user and redirects to /auth/login, exactly as with a request that carries no cookie.
// The network guard of the integration config refuses any non-loopback connection, so nothing can leave the machine.
//
// Fixture differences from a real purchase, stated on purpose:
//   - the pricing round is left UNLOCKED and the payment row has no lines and no pricing_round_id. A locked round and
//     ledger lines can never be deleted (campaign_pricing_guard, payment_operation_lines_guard), so a test that
//     created them would leave rows in the shared local DB. Neither is read by settleCardcomSession or by the
//     activation's funding check (requirePackageFunding reads the ledger state; transitionCampaignStatus only asks
//     that a round exists).
import { randomUUID } from 'node:crypto';

import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

import {
  type Fixture,
  FixtureScope,
  type LocalIntegrationEnv,
  newPool,
  requireLocalIntegrationEnv,
  useLocalAdminEnv,
} from '@/lib/testing/local-integration';

const RUN = process.env.OUTREACH_DB_IT === '1';
const ENV: LocalIntegrationEnv | null = RUN ? requireLocalIntegrationEnv() : null;

const TERMINAL = 99_999; // not CardCom's test terminal (1000), so the row is classed as real money, as in production
const PRICE = 1;
const ORIGIN = 'http://127.0.0.1:3999';

// The signed-in buyer while a case plays the buyer's browser. null = no session (the real requireUser runs).
const session: { userId: string | null } = { userId: null };

vi.mock('@/lib/cardcom/generated/low-profile/low-profile', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  lowProfileGetLpResult: vi.fn(),
}));
vi.mock('@/lib/data/cardcom-config', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getCardcomServerConfig: vi.fn(async () => ({
    terminalNumber: TERMINAL,
    apiName: 'it-api',
    enabled: true,
    saveCardOnPurchase: false,
    googlePayMode: 'off',
  })),
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn(async () => undefined) }));
vi.mock('@/lib/data/tax-ceiling', () => ({ checkOsekPaturCeilingAfterCharge: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/server', async () => {
  const { createAdminClient } = await import('@/lib/supabase/admin');
  return { createClient: vi.fn(async () => createAdminClient()) };
});
vi.mock('@/lib/auth/dal', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/auth/dal')>();
  return {
    ...real,
    requireUser: vi.fn(async () =>
      session.userId ? ({ id: session.userId, email: 'it-buyer@kalfa.test' } as never) : real.requireUser(),
    ),
  };
});

type Case = { f: Fixture; operationId: string; lowProfileId: string };
type State = { status: string; thankyou_send_at: string | null; payment: string; activations: number };

describe.skipIf(!RUN)('CardCom payment: which server request starts the service (local)', () => {
  let pool: Pool;
  let scope: FixtureScope;
  const cases: Case[] = [];
  let webhookPOST: typeof import('@/app/api/cardcom/webhook/route').POST;
  let settlePOST: typeof import('@/app/api/campaigns/[id]/purchase/settle/route').POST;

  // An active event 30 days out, its campaign approved and waiting for payment, one pending CardCom payment opened
  // through the real ledger function as cardcom-purchase.ts opens it, and its CardCom session.
  async function pendingPayment(): Promise<Case> {
    const f = await scope.create({ campaignStatus: 'approved', noOutbound: true });
    await pool.query(
      `insert into public.campaign_pricing (campaign_id, list_price, discount_amount, package_price) values ($1, $2, 0, $2)`,
      [f.campaignId, PRICE],
    );
    const { beginOperation } = await import('@/lib/payments/ledger');
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const begun = await beginOperation(createAdminClient(), {
      campaignId: f.campaignId,
      eventId: f.eventId,
      kind: 'package_purchase',
      amount: PRICE,
      provider: 'cardcom',
      providerTerminal: TERMINAL,
      providerOperation: 'ChargeOnly',
      meta: { payerUserId: f.ownerId, provider: 'cardcom' },
    });
    if (!('id' in begun)) throw new Error('fixture: the payment row was not opened');
    const c: Case = { f, operationId: begun.id, lowProfileId: `it-lp-${randomUUID()}` };
    cases.push(c);
    await pool.query(`insert into public.cardcom_payment_sessions (low_profile_id, operation_id) values ($1, $2)`, [
      c.lowProfileId,
      c.operationId,
    ]);
    return c;
  }

  // What CardCom posts: only the LowProfileId. No cookie, no session.
  const webhook = (c: Case) =>
    webhookPOST(
      new NextRequest('http://127.0.0.1/api/cardcom/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
        body: JSON.stringify({ LowProfileId: c.lowProfileId }),
      }),
    );

  // The buyer's browser after the form submitted: signed in as the owner, from the app's own origin.
  const browserSettle = async (c: Case) => {
    session.userId = c.f.ownerId;
    try {
      return await settlePOST(
        new NextRequest(`${ORIGIN}/api/campaigns/${c.f.campaignId}/purchase/settle`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: ORIGIN },
          body: JSON.stringify({ submitted: true }),
        }),
        { params: Promise.resolve({ id: c.f.campaignId }) },
      );
    } finally {
      session.userId = null;
    }
  };

  const state = async (c: Case): Promise<State> => {
    const r = await pool.query(
      `select c.status::text status, c.thankyou_send_at,
              (select outcome::text from public.payment_operations where id = $2::uuid) payment,
              (select count(*)::int from public.activity_log a
                where a.action = 'campaign.activated' and a.meta->>'campaignId' = $1::text) activations
         from public.campaigns c where c.id = $1::uuid`,
      [c.f.campaignId, c.operationId],
    );
    return r.rows[0] as State;
  };

  beforeAll(async () => {
    useLocalAdminEnv(ENV!);
    vi.stubEnv('APP_ORIGIN', ORIGIN);
    pool = newPool(ENV!, 'cardcom-webhook-activation');
    scope = new FixtureScope(pool);

    // CardCom's answer for every session: paid, the row's amount in shekels, on the terminal it was opened on.
    const { lowProfileGetLpResult } = await import('@/lib/cardcom/generated/low-profile/low-profile');
    vi.mocked(lowProfileGetLpResult).mockResolvedValue({
      ResponseCode: 0,
      Operation: 'ChargeOnly',
      TranzactionId: 424242,
      TerminalNumber: TERMINAL,
      TranzactionInfo: { Amount: PRICE, CoinId: 1, ApprovalNumber: '0000001' },
      DocumentInfo: null,
      UIValues: null,
    } as never);

    webhookPOST = (await import('@/app/api/cardcom/webhook/route')).POST;
    settlePOST = (await import('@/app/api/campaigns/[id]/purchase/settle/route')).POST;
  });

  afterAll(async () => {
    if (!RUN) return;
    vi.unstubAllEnvs();
    try {
      // Session rows reference the payment rows (RESTRICT) and are not reachable from the fixture roots.
      await pool.query(`delete from public.cardcom_payment_sessions where low_profile_id = any($1::text[])`, [
        cases.map((c) => c.lowProfileId),
      ]);
      await scope.cleanup();
      const left = await pool.query(
        `select (select count(*) from public.payment_operations where id = any($1::uuid[]))::int
              + (select count(*) from public.cardcom_payment_sessions where low_profile_id = any($2::text[]))::int n`,
        [cases.map((c) => c.operationId), cases.map((c) => c.lowProfileId)],
      );
      expect(left.rows[0].n).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('B (control): the browser settle call alone records the payment and starts the service', async () => {
    const c = await pendingPayment();
    const res = await browserSettle(c);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'paid', activation: 'started' });
    const s = await state(c);
    expect(s, JSON.stringify(s)).toMatchObject({ payment: 'succeeded', status: 'active', activations: 1 });
    expect(s.thankyou_send_at).not.toBeNull();
  });

  it('C (control): webhook first, then the browser settle call; the service starts on the browser call', async () => {
    const c = await pendingPayment();
    expect((await webhook(c)).status).toBe(200);
    const afterWebhook = await state(c);
    expect(afterWebhook, JSON.stringify(afterWebhook)).toMatchObject({ payment: 'succeeded', status: 'approved' });
    const res = await browserSettle(c);
    expect(await res.json()).toEqual({ state: 'paid', activation: 'started' });
    const s = await state(c);
    expect(s, JSON.stringify(s)).toMatchObject({ payment: 'succeeded', status: 'active', activations: 1 });
  });

  it('D (diagnostic): after the webhook, the existing activation cannot run without a buyer session', async () => {
    const c = await pendingPayment();
    expect((await webhook(c)).status).toBe(200);
    expect(await state(c)).toMatchObject({ payment: 'succeeded', status: 'approved' });

    // The owner-actor activation, as the settle route uses it, called the way a webhook would: no session.
    const { activateCampaign } = await import('@/lib/data/campaigns');
    const err = await activateCampaign(c.f.campaignId).then(
      () => null,
      (e: unknown) => e as { digest?: string },
    );
    expect(err?.digest ?? String(err)).toMatch(/NEXT_REDIRECT.*\/auth\/login/);

    const { activateAfterPayment } = await import('@/lib/payments/activate-after-payment');
    expect(await activateAfterPayment(c.f.campaignId, c.f.eventId)).toBe('failed');
    const s = await state(c);
    expect(s, JSON.stringify(s)).toMatchObject({ payment: 'succeeded', status: 'approved', activations: 0 });
  });

  // KNOWN GAP: fails today, so it is declared it.fails (the suite's KNOWN BUG idiom). When the server settle path
  // starts the service, vitest reports this as an unexpected pass: turn it back into a plain `it` then.
  it.fails('KNOWN GAP: A (target): the webhook alone records the payment AND starts the service, once', async () => {
    const c = await pendingPayment();
    expect((await webhook(c)).status).toBe(200);
    const s = await state(c);
    expect(s.payment).toBe('succeeded');
    expect(s, JSON.stringify(s)).toMatchObject({ status: 'active', activations: 1 });
    expect(s.thankyou_send_at).not.toBeNull();

    // The same webhook again: still one payment and one activation.
    expect((await webhook(c)).status).toBe(200);
    expect(await state(c)).toMatchObject({ payment: 'succeeded', status: 'active', activations: 1 });
  });
});
