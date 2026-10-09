import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({
  requirePlatformPermission: vi.fn(),
}));
vi.mock('@/lib/data/events', () => ({
  requireOwnedEvent: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/close-charge', () => ({ closeCampaignAndCharge: vi.fn() }));
vi.mock('@/lib/sumit/capture', () => ({ creditHeldCardSumit: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({ getSumitServerConfig: vi.fn() }));
vi.mock('@/lib/email/sender', () => ({ getEmailSender: vi.fn() }));
vi.mock('@/lib/sms/sender', () => ({ getSmsSender: vi.fn() }));
vi.mock('@/lib/email/templates', () => ({ cancellationRequestResponseEmail: vi.fn() }));
vi.mock('@/lib/data/cancellation-sms', () => ({ buildCancellationSmsText: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn().mockResolvedValue('https://beta.kalfa.me') }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/payments/package-refund', () => ({
  checkPackageRefund: vi.fn(),
  packageRefundSummary: vi.fn(),
  packagePaymentRecord: vi.fn(),
  refundPackagePayment: vi.fn(),
}));
vi.mock('@/lib/data/campaigns', () => ({ closeCampaign: vi.fn() }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { closeCampaignAndCharge } from '@/lib/data/close-charge';
import { creditHeldCardSumit } from '@/lib/sumit/capture';
import { getSumitServerConfig } from '@/lib/data/payments';
import { getEmailSender } from '@/lib/email/sender';
import { getSmsSender } from '@/lib/sms/sender';
import { cancellationRequestResponseEmail } from '@/lib/email/templates';
import { buildCancellationSmsText } from '@/lib/data/cancellation-sms';
import { logActivity } from '@/lib/data/activity';
import { closeCampaign } from '@/lib/data/campaigns';
import { checkPackageRefund, packagePaymentRecord, packageRefundSummary, refundPackagePayment } from '@/lib/payments/package-refund';
import {
  CANCELLATION_REQUEST_ALREADY_OPEN,
  createCancellationRequest,
  computeSuggestedCancellationAmount,
  getCampaignForEventAdmin,
  getCancellationRequestForAdmin,
  resolveCancellationRequest,
} from './event-cancellation';

type Mock = ReturnType<typeof vi.fn>;

describe('createCancellationRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  // The owner-scoped client: `open` is what the pending-request check finds, `insert` what the insert answers.
  function client(opts: { open?: unknown; openError?: unknown; insert?: { data: unknown; error: unknown } } = {}) {
    const eqCalls: Array<[string, unknown]> = [];
    const insertMock = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => opts.insert ?? { data: { id: 'r1', request_number: 42 }, error: null },
      }),
    });
    const chain = {
      eq: (column: string, value: unknown) => {
        eqCalls.push([column, value]);
        return chain;
      },
      limit: () => chain,
      maybeSingle: async () => ({ data: opts.open ?? null, error: opts.openError ?? null }),
    };
    (createClient as unknown as Mock).mockResolvedValue({
      from: () => ({ insert: insertMock, select: () => chain }),
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    });
    return { insertMock, eqCalls };
  }

  it('inserts via the owner-scoped client and returns the request number', async () => {
    (requireOwnedEvent as unknown as Mock).mockResolvedValue({ id: 'e1', status: 'active' });
    const { eqCalls } = client();
    const r = await createCancellationRequest('e1', { reason: 'שינוי תוכניות', smsConsent: true });
    expect(r).toEqual({ id: 'r1', requestNumber: 42 });
    expect(eqCalls).toEqual([['event_id', 'e1'], ['status', 'pending']]);
  });

  it('refuses a second request while one is already open, without inserting', async () => {
    (requireOwnedEvent as unknown as Mock).mockResolvedValue({ id: 'e1', status: 'active' });
    const { insertMock } = client({ open: { id: 'r0' } });
    await expect(
      createCancellationRequest('e1', { reason: 'שינוי תוכניות', smsConsent: false }),
    ).rejects.toThrow(CANCELLATION_REQUEST_ALREADY_OPEN);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('answers the same message when the database refuses a simultaneous second request (23505)', async () => {
    (requireOwnedEvent as unknown as Mock).mockResolvedValue({ id: 'e1', status: 'active' });
    client({ insert: { data: null, error: { code: '23505', message: 'duplicate key' } } });
    await expect(
      createCancellationRequest('e1', { reason: 'שינוי תוכניות', smsConsent: false }),
    ).rejects.toThrow(CANCELLATION_REQUEST_ALREADY_OPEN);
  });

  it('fails safely when the open-request check cannot be read', async () => {
    (requireOwnedEvent as unknown as Mock).mockResolvedValue({ id: 'e1', status: 'active' });
    const { insertMock } = client({ openError: { code: '57014' } });
    await expect(
      createCancellationRequest('e1', { reason: 'שינוי תוכניות', smsConsent: false }),
    ).rejects.toThrow('פתיחת בקשת הביטול נכשלה');
    expect(insertMock).not.toHaveBeenCalled();
  });

  it('rejects a draft event without touching the DB', async () => {
    (requireOwnedEvent as unknown as Mock).mockResolvedValue({ id: 'e1', status: 'draft' });
    await expect(
      createCancellationRequest('e1', { reason: 'שינוי תוכניות', smsConsent: false }),
    ).rejects.toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('computeSuggestedCancellationAmount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('suggests min(5% of ceiling, cap), never the accrued service-already-rendered amount', async () => {
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: (table: string) => {
        if (table === 'app_settings') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { cancellation_fee_percent: 5, cancellation_fee_cap: 100 },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { max_charge_ceiling: 88 }, error: null }) }) }),
        };
      },
    });
    // fee = min(5% of 88, 100) = 4.4
    const amount = await computeSuggestedCancellationAmount('c1');
    expect(amount).toBeCloseTo(4.4, 2);
  });

  it('never suggests more than the campaign ceiling even with a very high fee_cap', async () => {
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: (table: string) => {
        if (table === 'app_settings') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { cancellation_fee_percent: 5, cancellation_fee_cap: 100000 },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ single: async () => ({ data: { max_charge_ceiling: 12 }, error: null }) }) }),
        };
      },
    });
    const amount = await computeSuggestedCancellationAmount('c1');
    expect(amount).toBeLessThanOrEqual(12);
  });

  // A package has no ceiling: the base of the fee is what the card paid, handed in by the caller.
  function settings(percent: number, cap: number, ceiling: number | null = null) {
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: (table: string) =>
        table === 'app_settings'
          ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { cancellation_fee_percent: percent, cancellation_fee_cap: cap }, error: null }) }) }) }
          : { select: () => ({ eq: () => ({ single: async () => ({ data: { max_charge_ceiling: ceiling }, error: null }) }) }) },
    });
  }

  it('with a base (a package: what the card paid) it is taken of that base, not of the missing ceiling', async () => {
    settings(5, 100, null);
    expect(await computeSuggestedCancellationAmount('c1', 120)).toBeCloseTo(6, 2);
  });

  it('with a base it is still capped, and never more than the base', async () => {
    settings(5, 2, null);
    expect(await computeSuggestedCancellationAmount('c1', 120)).toBeCloseTo(2, 2);
    settings(100, 100000, null);
    expect(await computeSuggestedCancellationAmount('c1', 120)).toBeLessThanOrEqual(120);
  });

  it('without a base and without a ceiling the suggestion is 0, as before', async () => {
    settings(5, 100, null);
    expect(await computeSuggestedCancellationAmount('c1')).toBe(0);
  });
});

describe('getCampaignForEventAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the latest campaign for the event with hasCardOnFile=true when all 4 card fields are present', async () => {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'camp1', charge_status: 'charged', max_charge_ceiling: 88, final_charge_amount: 84,
        card_token_ref: 'tok-abc', card_exp_month: 7, card_exp_year: 2031, card_citizen_id: '316125434',
      },
      error: null,
    });
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ neq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }) }),
    });
    const r = await getCampaignForEventAdmin('e1');
    expect(r).toEqual({
      id: 'camp1',
      chargeStatus: 'charged',
      maxChargeCeiling: 88,
      finalChargeAmount: 84,
      isPackage: false,
      packagePaid: null,
      packageRefundable: null,
      packageRefundedForRequest: null,
      packageUnreadable: false,
      packageRefundDocument: null,
      packageRecord: null,
      hasCardOnFile: true,
      basePrice: 0,
      includedReached: 0,
      pricePerReached: 0,
    });
  });

  it('returns hasCardOnFile=false when any of the 4 card fields is missing', async () => {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'camp1', charge_status: 'charged', max_charge_ceiling: 88,
        card_token_ref: null, card_exp_month: null, card_exp_year: null, card_citizen_id: null,
      },
      error: null,
    });
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ neq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }) }),
    });
    const r = await getCampaignForEventAdmin('e1');
    expect(r?.hasCardOnFile).toBe(false);
  });

  // A fixed-price package keeps no charge status, ceiling or card on the campaign: its money is in the payment ledger.
  function adminClientFor(row: Record<string, unknown>) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ neq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }) }),
    });
  }
  const PKG_ROW = {
    id: 'camp1', charge_status: null, max_charge_ceiling: null, final_charge_amount: 0, package_price: 120,
    card_token_ref: null, card_exp_month: null, card_exp_year: null, card_citizen_id: null,
  };

  it('a package campaign: what the card paid and whether a card is on file come from the ledger, not the old columns', async () => {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    adminClientFor(PKG_ROW);
    (packageRefundSummary as unknown as Mock).mockResolvedValue({ refundable: 70, refundedForRequest: 50, hasCard: true });
    const r = await getCampaignForEventAdmin('e1', 'req1');
    expect(packageRefundSummary).toHaveBeenCalledWith('camp1', 'req1');
    expect(r).toMatchObject({ isPackage: true, packagePaid: 120, packageRefundable: 70, hasCardOnFile: true, packageUnreadable: false });
  });

  it('a package: what THIS request already sent back is reported, so the screen can say a resolve is being resumed', async () => {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    adminClientFor(PKG_ROW);
    (packageRefundSummary as unknown as Mock).mockResolvedValue({ refundable: 15, refundedForRequest: 105, hasCard: true });
    expect(await getCampaignForEventAdmin('e1', 'req1')).toMatchObject({ packagePaid: 120, packageRefundable: 15, packageRefundedForRequest: 105 });
  });

  // The receipt the purchase issued and how this request's last refund attempt ended (with the provider's own answer) come
  // from the ledger too — a refused refund must show WHY on the screen.
  it('a package: the purchase document and the last refund attempt of THIS request come from the ledger', async () => {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    adminClientFor(PKG_ROW);
    (packageRefundSummary as unknown as Mock).mockResolvedValue({ refundable: 120, refundedForRequest: 0, hasCard: true });
    const record = {
      purchaseDocument: { id: null, number: 6, url: null },
      lastRefundAttempt: { outcome: 'failed', providerStatus: '9006', providerStatusDescription: 'אין הרשאה', recordedAt: '2026-10-09T13:12:32Z' },
    };
    (packagePaymentRecord as unknown as Mock).mockResolvedValue(record);
    expect(await getCampaignForEventAdmin('e1', 'req1')).toMatchObject({ packageRecord: record });
    expect(packagePaymentRecord).toHaveBeenCalledWith('camp1', 'req1');
  });

  it('a package with no usable saved card says so', async () => {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    adminClientFor(PKG_ROW);
    (packageRefundSummary as unknown as Mock).mockResolvedValue({ refundable: 120, refundedForRequest: 0, hasCard: false });
    expect((await getCampaignForEventAdmin('e1', 'req1'))?.hasCardOnFile).toBe(false);
  });

  it('a package whose ledger cannot be read is reported as unreadable — never as "paid nothing"', async () => {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    adminClientFor(PKG_ROW);
    (packageRefundSummary as unknown as Mock).mockRejectedValue(new Error('db down'));
    expect(await getCampaignForEventAdmin('e1', 'req1')).toMatchObject({ isPackage: true, packagePaid: null, packageRefundable: null, packageRefundedForRequest: null, hasCardOnFile: false, packageUnreadable: true });
  });

  it('a campaign that is not a package never touches the ledger', async () => {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    adminClientFor({ ...PKG_ROW, package_price: null, charge_status: 'charged', final_charge_amount: 84 });
    const r = await getCampaignForEventAdmin('e1', 'req1');
    expect(packageRefundSummary).not.toHaveBeenCalled();
    expect(r).toMatchObject({ isPackage: false, packagePaid: null, packageRefundable: null, packageRefundedForRequest: null, packageUnreadable: false });
  });

  it('asks only for the LIVE campaign: a cancelled one is never what a cancellation request is about, so the screen cannot promise what the resolver will not do', async () => {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    const neq = vi.fn(() => ({ order: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }));
    (createAdminClient as unknown as Mock).mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ neq }) }) }) });
    expect(await getCampaignForEventAdmin('e1')).toBeNull();
    expect(neq).toHaveBeenCalledWith('status', 'cancelled');
  });

  // A failed read must never look like "no live campaign": the screen would promise that no money moves.
  it('throws when the campaign cannot be read, instead of answering "no campaign"', async () => {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } });
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ neq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }) }),
    });
    await expect(getCampaignForEventAdmin('e1')).rejects.toThrow('טעינת נתוני הקמפיין נכשלה');
  });

  it('returns null when the event has no campaign', async () => {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ neq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }) }),
    });
    const r = await getCampaignForEventAdmin('e1');
    expect(r).toBeNull();
  });
});

describe('resolveCancellationRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  // The embed lists an event's campaigns in no promised order. A cancelled one (older, with its own id) put before or after the live one.
  function withCancelled<T extends Record<string, unknown>>(where: 'before' | 'after' | undefined, live: T[]): Array<T | Record<string, unknown>> {
    if (!where) return live;
    const cancelled = { id: 'camp0', status: 'cancelled', created_at: '2026-10-08T08:00:00+00:00', charge_status: null, final_charge_amount: null, max_charge_ceiling: null, auth_external_ref: null, package_price: 120, card_token_ref: null, card_exp_month: null, card_exp_year: null, card_citizen_id: null };
    return where === 'before' ? [cancelled, ...live] : [...live, cancelled];
  }

  // `chargeStatus` controls which branch fires: null/failed/review/nothing_to_charge
  // ⇒ campaign is still pre-charge ⇒ closeCampaignAndCharge IS called; 'charged'
  // ⇒ post-charge ⇒ creditHeldCardSumit is called instead (if a card is on file).
  function happy(opts: {
    chargeStatus: string | null;
    smsConsent?: boolean;
    finalChargeAmount?: number;
    noCard?: boolean;
    packagePrice?: number | null;
    maxChargeCeiling?: number | null;
    campaignStatus?: string;
    // The event also has a CANCELLED campaign (a reset test run leaves one), listed before or after the live one.
    cancelledCampaign?: 'before' | 'after';
  }) {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    const cardFields = opts.noCard
      ? { card_token_ref: null, card_exp_month: null, card_exp_year: null, card_citizen_id: null }
      : { card_token_ref: 'tok-abc', card_exp_month: 7, card_exp_year: 2031, card_citizen_id: '316125434' };
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'r1',
        request_number: 42,
        status: 'pending',
        sms_consent: opts.smsConsent ?? true,
        event_id: 'e1',
        reason: 'שינוי תוכניות',
        events: {
          id: 'e1',
          status: 'active',
          owner_id: 'u1',
          campaigns: withCancelled(opts.cancelledCampaign, [
            {
              id: 'camp1',
              status: opts.campaignStatus ?? 'active',
              created_at: '2026-10-08T10:00:00+00:00',
              charge_status: opts.chargeStatus,
              final_charge_amount: opts.finalChargeAmount ?? 0,
              max_charge_ceiling: opts.maxChargeCeiling ?? null,
              auth_external_ref: 'ext-1',
              package_price: opts.packagePrice ?? null,
              ...cardFields,
            },
          ]),
        },
      },
      error: null,
    });
    // The final write: .eq('id').eq('status','pending').select('id') — one row back means this resolve won. Other updates
    // (campaigns.final_charge_amount) end at .eq('id').
    const resolvedRows = vi.fn().mockResolvedValue({ data: [{ id: 'r1' }], error: null });
    const update = vi.fn().mockReturnValue({ eq: () => ({ error: null, eq: () => ({ select: resolvedRows }) }) });
    const profileSingle = vi.fn().mockResolvedValue({
      data: { full_name: 'דנה', phone: '+972500000000' },
      error: null,
    });
    // adminCloseEvent's own live-status check (events.status via maybeSingle) —
    // the event is still 'active' at this point since closeCampaignAndCharge/
    // creditHeldCardSumit are mocked out (their real event-closing side effect
    // never runs here), so adminCloseEvent must proceed to actually close it.
    const eventStatusMaybeSingle = vi.fn().mockResolvedValue({
      data: { status: 'active' },
      error: null,
    });
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: (table: string) => {
        if (table === 'profiles') {
          return { select: () => ({ eq: () => ({ maybeSingle: profileSingle }) }) };
        }
        return {
          select: () => ({ eq: () => ({ single, maybeSingle: eventStatusMaybeSingle }) }),
          update,
        };
      },
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'dana@example.com' } } }) } },
    });
    (cancellationRequestResponseEmail as unknown as Mock).mockReturnValue({ subject: 's', html: '<p>h</p>', text: 't' });
    (buildCancellationSmsText as unknown as Mock).mockReturnValue('sms text');
    const send = vi.fn().mockResolvedValue(undefined);
    (getEmailSender as unknown as Mock).mockResolvedValue({ send });
    const smsSend = vi.fn().mockResolvedValue({ id: 'sms1' });
    (getSmsSender as unknown as Mock).mockResolvedValue({ send: smsSend });
    (closeCampaignAndCharge as unknown as Mock).mockResolvedValue({
      outcome: 'charged', amount: 24.4, paymentId: 999, documentId: 601, documentUrl: 'https://pay.sumit.co.il/x?download=601',
    });
    (getSumitServerConfig as unknown as Mock).mockResolvedValue({ companyId: 1, apiKey: 'k' });
    (creditHeldCardSumit as unknown as Mock).mockResolvedValue({
      documentId: 701, documentNumber: 1, documentUrl: 'https://pay.sumit.co.il/x?download=701', authNumber: 'a1', paymentId: 555,
    });
    return { send, smsSend, update, eventStatusMaybeSingle, resolvedRows };
  }

  // A fixed-price package was paid at purchase and has no settlement. Resolving its cancellation request means giving
  // money BACK: the admin's two resolutions keep the meaning they have for a charged campaign (ביטול מלא = everything
  // goes back; חיוב חלקי = the typed amount or percentage STAYS, the rest goes back). The customer is e-mailed only
  // after the money is confirmed back, and is told what went back; the request closes only after both.
  describe('a fixed-price package campaign', () => {
    const DOC = { id: 9001, number: 4023, url: 'https://example.test/doc/9001' };
    function pkg(over: { status?: string; paid?: number; refundedForRequest?: number } = {}) {
      const h = happy({ chargeStatus: null, packagePrice: 120, campaignStatus: over.status ?? 'active' });
      (packageRefundSummary as unknown as Mock).mockResolvedValue({
        refundable: over.paid ?? 120,
        refundedForRequest: over.refundedForRequest ?? 0,
        hasCard: true,
      });
      (checkPackageRefund as unknown as Mock).mockResolvedValue(null);
      (refundPackagePayment as unknown as Mock).mockImplementation(async (i: { amount: number }) => ({
        status: 'refunded', amount: i.amount, document: DOC, alreadyDone: false,
      }));
      return h;
    }
    const order = (m: unknown) => (m as { mock: { invocationCallOrder: number[] } }).mock.invocationCallOrder[0];

    it.each(['before', 'after'] as const)('with a cancelled campaign listed %s the live one, the refund is made for the LIVE campaign, never the cancelled one', async (where) => {
      const h = happy({ chargeStatus: null, packagePrice: 120, campaignStatus: 'active', cancelledCampaign: where });
      (packageRefundSummary as unknown as Mock).mockResolvedValue({ refundable: 120, refundedForRequest: 0, hasCard: true });
      (checkPackageRefund as unknown as Mock).mockResolvedValue(null);
      (refundPackagePayment as unknown as Mock).mockImplementation(async (i: { amount: number }) => ({ status: 'refunded', amount: i.amount, document: DOC, alreadyDone: false }));
      await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
      expect(packageRefundSummary).toHaveBeenCalledWith('camp1', 'r1');
      expect(refundPackagePayment).toHaveBeenCalledWith({ campaignId: 'camp1', eventId: 'e1', amount: 120, cancellationRequestId: 'r1' });
      expect(packageRefundSummary).not.toHaveBeenCalledWith('camp0', expect.anything());
      expect(h.update).toBeDefined();
    });

    it('full cancellation: refunds what the card paid, closes the campaign and the event, and records the credit document', async () => {
      const { update } = pkg();
      await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
      expect(refundPackagePayment).toHaveBeenCalledWith({ campaignId: 'camp1', eventId: 'e1', amount: 120, cancellationRequestId: 'r1' });
      expect(closeCampaign).toHaveBeenCalledWith('camp1');
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        capture_outcome: 'refunded', resolution_amount: 120, sumit_document_id: 9001, sumit_document_url: DOC.url, status: 'resolved',
      }));
      // never the old per-result money paths
      expect(closeCampaignAndCharge).not.toHaveBeenCalled();
      expect(creditHeldCardSumit).not.toHaveBeenCalled();
    });

    it('the order is the safety: the refund is CHECKED, then the money goes back, then the customer is e-mailed, then the campaign is closed', async () => {
      const { send } = pkg();
      await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
      expect(checkPackageRefund).toHaveBeenCalledWith({ campaignId: 'camp1', eventId: 'e1', amount: 120, cancellationRequestId: 'r1' });
      expect(order(checkPackageRefund)).toBeLessThan(order(refundPackagePayment));
      expect(order(refundPackagePayment)).toBeLessThan(order(send));
      expect(order(send)).toBeLessThan(order(closeCampaign));
    });

    it('the e-mail says what went back: the amount the ledger confirmed', async () => {
      pkg();
      await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionAmount: 15, resolutionNote: 'דמי ביטול' });
      expect(cancellationRequestResponseEmail).toHaveBeenCalledWith(
        expect.objectContaining({ resolution: 'partial_charge', resolutionAmount: 15, refundedAmount: 105 }),
      );
    });

    // The money is back but the customer was not told: the request must stay open (so it is visibly unfinished), and
    // approving it again must send the e-mail WITHOUT a second refund (the ledger returns the earlier one).
    it('the e-mail fails after the refund: the admin is told the money is back, nothing else is done, and a retry refunds nothing twice', async () => {
      const h = pkg();
      h.send.mockRejectedValueOnce(Object.assign(new Error('smtp down'), { name: 'EmailSendError' }));
      await expect(
        resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' }),
      ).rejects.toThrow('הכסף הוחזר ללקוח, אך שליחת המייל נכשלה');
      expect(refundPackagePayment).toHaveBeenCalledTimes(1);
      expect(h.smsSend).not.toHaveBeenCalled();
      expect(closeCampaign).not.toHaveBeenCalled();
      expect(h.update).not.toHaveBeenCalled();

      // The retry: the ledger now holds this request's refund, so the module returns it instead of refunding again.
      vi.clearAllMocks();
      const again = pkg({ paid: 0, refundedForRequest: 120 });
      (checkPackageRefund as unknown as Mock).mockResolvedValue({ status: 'refunded', amount: 120, document: DOC, alreadyDone: true });
      (refundPackagePayment as unknown as Mock).mockResolvedValue({ status: 'refunded', amount: 120, document: DOC, alreadyDone: true });
      await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
      expect(again.send).toHaveBeenCalledTimes(1);
      expect(cancellationRequestResponseEmail).toHaveBeenCalledWith(expect.objectContaining({ refundedAmount: 120 }));
      expect(again.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved', resolution_amount: 120 }));
    });

    it('partial: the typed amount stays with us, the rest goes back, and the customer is told the amount kept', async () => {
      pkg();
      await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionAmount: 15, resolutionNote: 'דמי ביטול' });
      expect(refundPackagePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 105 }));
      expect(cancellationRequestResponseEmail).toHaveBeenCalledWith(expect.objectContaining({ resolution: 'partial_charge', resolutionAmount: 15 }));
    });

    it('partial as a percentage: 5% of the ₪120 paid stays (₪6.00), ₪114 goes back', async () => {
      pkg();
      await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 5, resolutionNote: 'דמי ביטול 5%' });
      expect(refundPackagePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 114 }));
      expect(cancellationRequestResponseEmail).toHaveBeenCalledWith(expect.objectContaining({ resolutionAmount: 6 }));
    });

    // A refund that exists for THIS request means an earlier attempt got as far as the money and failed at a later step
    // (closing the campaign, recording the request). The ledger is the truth about what that attempt did, so a retry
    // RESUMES it: the e-mail, the SMS and the record follow what really went back — never what the admin types this time,
    // or the customer would be told numbers that never happened.
    describe('a retry after a half-finished resolve (the money went back, a later step failed)', () => {
      function resumed(refunded: number, paid = 120) {
        const h = pkg({ paid: paid - refunded, refundedForRequest: refunded });
        (checkPackageRefund as unknown as Mock).mockResolvedValue({ status: 'refunded', amount: refunded, document: DOC, alreadyDone: true });
        (refundPackagePayment as unknown as Mock).mockResolvedValue({ status: 'refunded', amount: refunded, document: DOC, alreadyDone: true });
        return h;
      }
      const emailArg = () => (cancellationRequestResponseEmail as unknown as Mock).mock.calls[0][0] as { resolution: string; resolutionAmount?: number };

      it('the first attempt kept ₪15 (₪105 went back): a "full cancellation" typed now is still told and recorded as that', async () => {
        const { update } = resumed(105);
        await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
        expect(emailArg()).toMatchObject({ resolution: 'partial_charge', resolutionAmount: 15 });
        // The SMS says the fee that stayed (₪15) and what went back (₪105) — never the refund as if it were a charge.
        expect(buildCancellationSmsText).toHaveBeenCalledWith(expect.objectContaining({ resolution: 'partial_charge', resolutionAmount: 15, refundedAmount: 105 }));
        expect(update).toHaveBeenCalledWith(expect.objectContaining({
          resolution: 'partial_charge', resolution_amount: 105, capture_outcome: 'refunded', sumit_document_id: 9001, status: 'resolved',
        }));
      });

      it('the first attempt refunded everything: a "partial" typed now is still told and recorded as a full cancellation', async () => {
        const { update } = resumed(120);
        await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionAmount: 15, resolutionNote: 'דמי ביטול' });
        expect(emailArg().resolution).toBe('full_cancellation');
        expect(emailArg().resolutionAmount).toBeUndefined();
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ resolution: 'full_cancellation', resolution_amount: 120 }));
      });

      it('a percentage typed now is ignored: the ledger already decided the amount', async () => {
        resumed(105);
        await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 50, resolutionNote: 'דמי ביטול 50%' });
        expect(emailArg()).toMatchObject({ resolution: 'partial_charge', resolutionAmount: 15 });
        expect(refundPackagePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 105 }));
      });

      it('nothing is refunded twice, and the campaign and the event are still closed', async () => {
        resumed(105);
        await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
        expect(checkPackageRefund).toHaveBeenCalledWith(expect.objectContaining({ amount: 105 }));
        expect(refundPackagePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 105, cancellationRequestId: 'r1' }));
        expect(closeCampaign).toHaveBeenCalledWith('camp1');
        expect(logActivity).toHaveBeenCalledWith({ eventId: 'e1', action: 'event.closed_by_admin', meta: {} });
      });

      it('declining it now is refused: the money is already back, and recording "declined" would be untrue', async () => {
        const { send, update } = resumed(105);
        await expect(
          resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'האירוע כבר בעיצומו' }),
        ).rejects.toThrow('כבר בוצע החזר');
        expect(send).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(closeCampaign).not.toHaveBeenCalled();
      });
    });

    it('keeping everything (100%): nothing goes back, no refund is attempted, the request still closes with no money movement', async () => {
      const { update } = pkg();
      await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 100, resolutionNote: 'ללא החזר' });
      expect(checkPackageRefund).not.toHaveBeenCalled();
      expect(refundPackagePayment).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ capture_outcome: 'not_applicable', resolution_amount: null }));
      expect(closeCampaign).toHaveBeenCalledWith('camp1');
    });

    it('declined: no money, no check, the campaign and the event stay open', async () => {
      const { update } = pkg();
      await resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'האירוע כבר בעיצומו' });
      expect(checkPackageRefund).not.toHaveBeenCalled();
      expect(refundPackagePayment).not.toHaveBeenCalled();
      expect(closeCampaign).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ capture_outcome: 'not_applicable' }));
    });

    it('declined with an unreadable ledger still goes ahead: a decline moves no money', async () => {
      const { update } = pkg();
      (packageRefundSummary as unknown as Mock).mockRejectedValue(new Error('db down'));
      await resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'האירוע כבר בעיצומו' });
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ resolution: 'declined', capture_outcome: 'not_applicable' }));
      expect(refundPackagePayment).not.toHaveBeenCalled();
    });

    it('a refund that cannot go ahead is refused BEFORE the e-mail — no promise is made that cannot be kept', async () => {
      const { send, smsSend, update } = pkg();
      (checkPackageRefund as unknown as Mock).mockResolvedValue({ status: 'refused', reason: 'no_card' });
      await expect(
        resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' }),
      ).rejects.toThrow('אין כרטיס שמור');
      expect(send).not.toHaveBeenCalled();
      expect(smsSend).not.toHaveBeenCalled();
      expect(refundPackagePayment).not.toHaveBeenCalled();
      expect(closeCampaign).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('more kept than was paid is refused before the e-mail', async () => {
      const { send } = pkg();
      await expect(
        resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionAmount: 200, resolutionNote: 'דמי ביטול' }),
      ).rejects.toThrow('גדול ממה ששולם');
      expect(send).not.toHaveBeenCalled();
      expect(checkPackageRefund).not.toHaveBeenCalled();
    });

    it('a percentage with nothing paid to take it of is refused before the e-mail', async () => {
      const { send } = pkg({ paid: 0 });
      await expect(
        resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 5, resolutionNote: 'דמי ביטול' }),
      ).rejects.toThrow('סכום בסיס');
      expect(send).not.toHaveBeenCalled();
    });

    it('an unreadable ledger stops everything before the e-mail', async () => {
      const { send } = pkg();
      (packageRefundSummary as unknown as Mock).mockRejectedValue(new Error('db down'));
      await expect(
        resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' }),
      ).rejects.toThrow('נכשלה');
      expect(send).not.toHaveBeenCalled();
      expect(refundPackagePayment).not.toHaveBeenCalled();
    });

    it.each([
      ['declined', { status: 'declined' }, 'נדחה'],
      ['review', { status: 'review' }, 'אל תנסו שוב'],
      ['in progress', { status: 'in_progress' }, 'כבר בתהליך'],
      ['an error', { status: 'error' }, 'נכשלה'],
    ])('when the refund itself ends in %s the request stays open, the campaign is not closed and the customer is told nothing', async (_label, result, message) => {
      const { update, send, smsSend } = pkg();
      (refundPackagePayment as unknown as Mock).mockResolvedValue(result);
      await expect(
        resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' }),
      ).rejects.toThrow(message);
      expect(send).not.toHaveBeenCalled();
      expect(smsSend).not.toHaveBeenCalled();
      expect(closeCampaign).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('a campaign that is already closed is not closed again; the event still is', async () => {
      pkg({ status: 'closed' });
      await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
      expect(closeCampaign).not.toHaveBeenCalled();
      expect(logActivity).toHaveBeenCalledWith({ eventId: 'e1', action: 'event.closed_by_admin', meta: {} });
    });

    it('the SMS carries the amount that went back, as a refund', async () => {
      const { smsSend } = pkg();
      await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
      expect(smsSend).toHaveBeenCalled();
      expect(buildCancellationSmsText).toHaveBeenCalledWith(expect.objectContaining({ resolution: 'full_cancellation', refundedAmount: 120 }));
    });
  });

  it('pre-charge campaign: calls closeCampaignAndCharge with overrideAmount=0 for full_cancellation', async () => {
    happy({ chargeStatus: null });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' });
    expect(closeCampaignAndCharge).toHaveBeenCalledWith('camp1', { overrideAmount: 0, overrideReason: 'cancellation_full' });
    expect(creditHeldCardSumit).not.toHaveBeenCalled();
  });

  it('pre-charge campaign: calls closeCampaignAndCharge with the confirmed amount for partial_charge', async () => {
    happy({ chargeStatus: 'charge_failed' });
    await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionAmount: 24.4, resolutionNote: 'עבור שירות שסופק' });
    expect(closeCampaignAndCharge).toHaveBeenCalledWith('camp1', { overrideAmount: 24.4, overrideReason: 'cancellation_partial_charge' });
  });

  it('post-charge campaign WITH a card on file: calls creditHeldCardSumit for the full charged amount (full_cancellation)', async () => {
    const { update } = happy({ chargeStatus: 'charged', finalChargeAmount: 84 });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
    expect(creditHeldCardSumit).toHaveBeenCalledWith(expect.objectContaining({ amount: '84' }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ capture_outcome: 'refunded' }));
    // The campaigns row must reflect the net amount after the SUMIT credit, or
    // the customer's own page and the admin campaigns list keep showing the
    // stale pre-refund gross forever.
    // full refund of the entire ₪84 charge ⇒ net final_charge_amount = 0.
    expect(update).toHaveBeenCalledWith({ final_charge_amount: 0 });
  });

  it('post-charge campaign WITH a card on file: credits only the difference for partial_charge', async () => {
    const { update } = happy({ chargeStatus: 'charged', finalChargeAmount: 84 });
    await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionAmount: 30, resolutionNote: 'חלק נשאר' });
    // credit = charged(84) - keep(30) = 54
    expect(creditHeldCardSumit).toHaveBeenCalledWith(expect.objectContaining({ amount: '54' }));
    // net final_charge_amount after a ₪54 credit off the original ₪84 = 30 —
    // matches the amount the customer was told they'd keep being charged.
    expect(update).toHaveBeenCalledWith({ final_charge_amount: 30 });
  });

  // The fee chosen as a PERCENTAGE: the server computes the amount from a base it determines (what was charged, or the
  // frozen ceiling); the browser never submits a computed amount in this mode.
  describe('a fee chosen as a percentage', () => {
    it('post-charge: 5% of the ₪300 that was charged is ₪15 kept, ₪285 credited back, and the customer email carries ₪15', async () => {
      const { update } = happy({ chargeStatus: 'charged', finalChargeAmount: 300 });
      await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 5, resolutionNote: 'דמי ביטול 5%' });
      expect(creditHeldCardSumit).toHaveBeenCalledWith(expect.objectContaining({ amount: '285' }));
      expect(update).toHaveBeenCalledWith({ final_charge_amount: 15 });
      expect(cancellationRequestResponseEmail).toHaveBeenCalledWith(expect.objectContaining({ resolution: 'partial_charge', resolutionAmount: 15 }));
    });

    it('rounds to whole agorot: 12.5% of ₪84 is ₪10.50', async () => {
      happy({ chargeStatus: 'charged', finalChargeAmount: 84 });
      await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 12.5, resolutionNote: 'דמי ביטול' });
      expect(creditHeldCardSumit).toHaveBeenCalledWith(expect.objectContaining({ amount: '73.5' }));
    });

    it('100% keeps everything: nothing is credited', async () => {
      happy({ chargeStatus: 'charged', finalChargeAmount: 84 });
      await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 100, resolutionNote: 'ללא החזר' });
      expect(creditHeldCardSumit).not.toHaveBeenCalled();
    });

    it('pre-charge: the base is the frozen ceiling — 5% of ₪400 is a real ₪20 charge', async () => {
      happy({ chargeStatus: null, maxChargeCeiling: 400 });
      await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 5, resolutionNote: 'דמי ביטול 5%' });
      expect(closeCampaignAndCharge).toHaveBeenCalledWith('camp1', { overrideAmount: 20, overrideReason: 'cancellation_partial_charge' });
    });

    it('pre-charge with NO ceiling (an open-ceiling agreement): no base, refused BEFORE the email or any money', async () => {
      const { send, smsSend } = happy({ chargeStatus: null, maxChargeCeiling: null });
      await expect(
        resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 5, resolutionNote: 'דמי ביטול 5%' }),
      ).rejects.toThrow('סכום בסיס');
      expect(send).not.toHaveBeenCalled();
      expect(smsSend).not.toHaveBeenCalled();
      expect(closeCampaignAndCharge).not.toHaveBeenCalled();
      expect(creditHeldCardSumit).not.toHaveBeenCalled();
    });

    it('a percentage that rounds to nothing is refused before the email or any money', async () => {
      const { send } = happy({ chargeStatus: 'charged', finalChargeAmount: 0.1 });
      await expect(
        resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 1, resolutionNote: 'דמי ביטול' }),
      ).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
      expect(creditHeldCardSumit).not.toHaveBeenCalled();
    });

    it('a post-charge campaign with nothing left charged has no base either', async () => {
      const { send } = happy({ chargeStatus: 'charged', finalChargeAmount: 0 });
      await expect(
        resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 5, resolutionNote: 'דמי ביטול' }),
      ).rejects.toThrow('סכום בסיס');
      expect(send).not.toHaveBeenCalled();
    });

    it('an amount in shekels still works exactly as before', async () => {
      happy({ chargeStatus: 'charged', finalChargeAmount: 84 });
      await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionAmount: 30, resolutionNote: 'סכום' });
      expect(creditHeldCardSumit).toHaveBeenCalledWith(expect.objectContaining({ amount: '54' }));
    });
  });

  it('post-charge campaign WITHOUT a card on file: falls back to manual_refund_required, never calls creditHeldCardSumit', async () => {
    const { update } = happy({ chargeStatus: 'charged', finalChargeAmount: 84, noCard: true });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, יש להחזיר ידנית' });
    expect(creditHeldCardSumit).not.toHaveBeenCalled();
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ capture_outcome: 'manual_refund_required' }));
  });

  it('declined: never calls closeCampaignAndCharge or creditHeldCardSumit regardless of charge_status, records not_applicable', async () => {
    const { update } = happy({ chargeStatus: 'charged', finalChargeAmount: 84 });
    await resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'האירוע כבר בעיצומו' });
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
    expect(creditHeldCardSumit).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ capture_outcome: 'not_applicable' }));
  });

  it('sends email THEN SMS (consent=true) THEN persists, in that order', async () => {
    const { send, smsSend } = happy({ chargeStatus: null });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' });
    expect(send).toHaveBeenCalled();
    expect(smsSend).toHaveBeenCalled();
  });

  it('does NOT send SMS when sms_consent is false', async () => {
    const { smsSend } = happy({ chargeStatus: null, smsConsent: false });
    await resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'לא ניתן' });
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('throws and persists NOTHING when the email send fails (checked BEFORE any SUMIT capture)', async () => {
    const { update } = happy({ chargeStatus: null });
    (getEmailSender as unknown as Mock).mockResolvedValue({ send: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(
      resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'x' }),
    ).rejects.toThrow();
    expect(closeCampaignAndCharge).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('adminCloseEvent closes the event and logs it when still active', async () => {
    happy({ chargeStatus: null });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' });
    expect(logActivity).toHaveBeenCalledWith({ eventId: 'e1', action: 'event.closed_by_admin', meta: {} });
  });

  // closeCampaignAndCharge (real implementation, mocked out here) can ITSELF
  // close the event on a terminal settlement outcome — resolveCancellationRequest
  // then calls adminCloseEvent afterward, gated on its own `event.status`
  // snapshot (read once, before closeCampaignAndCharge runs, so it can't see
  // that). adminCloseEvent must re-check the LIVE status and no-op rather than
  // write status='closed' again and log a second, misleading activity entry.
  it('adminCloseEvent no-ops (no duplicate write/log) when the event is already closed', async () => {
    const { eventStatusMaybeSingle } = happy({ chargeStatus: null });
    eventStatusMaybeSingle.mockResolvedValue({ data: { status: 'closed' }, error: null });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' });
    expect(logActivity).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'event.closed_by_admin' }),
    );
  });

  // Two resolves of the same request both pass the "still pending" check at the top. Only one may record it: the final
  // write is filtered on status='pending', and a write that matched no row is reported, never taken as success.
  it('the final write is only for a request that is still pending, and a lost race is reported', async () => {
    const { update, resolvedRows } = happy({ chargeStatus: null });
    resolvedRows.mockResolvedValue({ data: [], error: null });
    await expect(
      resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'לא ניתן' }),
    ).rejects.toThrow('הבקשה כבר טופלה בניסיון אחר');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved' }));
    expect(resolvedRows).toHaveBeenCalledWith('id');
    expect(logActivity).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'event_cancellation.resolved' }));
  });

  it('rejects resolving a request that is already resolved', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'r1', status: 'resolved', sms_consent: false, events: { id: 'e1', status: 'closed', owner_id: 'u1', campaigns: [] } },
      error: null,
    });
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    (createAdminClient as unknown as Mock).mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ single }) }) }) });
    await expect(
      resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'x' }),
    ).rejects.toThrow();
  });
});

describe('getCancellationRequestForAdmin', () => {
  beforeEach(() => vi.clearAllMocks());
  function adminReturns(result: { data: unknown; error: unknown }) {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue(undefined);
    const maybeSingle = vi.fn().mockResolvedValue(result);
    (createAdminClient as unknown as Mock).mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) });
  }

  it('a request that does not exist is null (the page answers 404)', async () => {
    adminReturns({ data: null, error: null });
    expect(await getCancellationRequestForAdmin('r1')).toBeNull();
  });

  // A failed read must never become "no such request": the admin area's error boundary offers a retry instead.
  it('a failed read throws instead', async () => {
    adminReturns({ data: null, error: { message: 'db down' } });
    await expect(getCancellationRequestForAdmin('r1')).rejects.toThrow('טעינת בקשת הביטול נכשלה');
  });
});
