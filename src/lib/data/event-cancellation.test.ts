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
// The pricing module decides "is this a package" (task 4.1); each fixture states the campaign's current-round price.
vi.mock('@/lib/data/campaign-pricing', () => ({ getCurrentPricing: vi.fn() }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { requireOwnedEvent } from '@/lib/data/events';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentPricing } from '@/lib/data/campaign-pricing';
import { getEmailSender } from '@/lib/email/sender';
import { getSmsSender } from '@/lib/sms/sender';
import { cancellationRequestResponseEmail } from '@/lib/email/templates';
import { buildCancellationSmsText } from '@/lib/data/cancellation-sms';
import { logActivity } from '@/lib/data/activity';
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
  // `inserts` answers the inserts in order (the last one repeats); `insert` is the single-answer shorthand.
  function client(
    opts: { open?: unknown; openError?: unknown; insert?: { data: unknown; error: unknown }; inserts?: { data: unknown; error: unknown }[] } = {},
  ) {
    const eqCalls: Array<[string, unknown]> = [];
    const answers = opts.inserts ?? [opts.insert ?? { data: { id: 'r1', request_code: '7K4Q-92XM' }, error: null }];
    let call = 0;
    const insertMock = vi.fn().mockImplementation(() => ({
      select: () => ({
        single: async () => answers[Math.min(call++, answers.length - 1)],
      }),
    }));
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

  it('inserts via the owner-scoped client and returns the request code', async () => {
    (requireOwnedEvent as unknown as Mock).mockResolvedValue({ id: 'e1', status: 'active' });
    const { eqCalls } = client();
    const r = await createCancellationRequest('e1', { reason: 'שינוי תוכניות', smsConsent: true });
    expect(r).toEqual({ id: 'r1', requestCode: '7K4Q-92XM' });
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
    client({ insert: { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "event_cancellation_requests_one_pending"' } } });
    await expect(
      createCancellationRequest('e1', { reason: 'שינוי תוכניות', smsConsent: false }),
    ).rejects.toThrow(CANCELLATION_REQUEST_ALREADY_OPEN);
  });

  // The database draws the code at random; its unique constraint refuses a repeat, and the insert is simply tried again.
  const CODE_COLLISION = {
    data: null,
    error: { code: '23505', message: 'duplicate key value violates unique constraint "event_cancellation_requests_request_code_key"' },
  };

  it('a code that collides is drawn again — never reported as "a request is already open"', async () => {
    (requireOwnedEvent as unknown as Mock).mockResolvedValue({ id: 'e1', status: 'active' });
    const { insertMock } = client({ inserts: [CODE_COLLISION, { data: { id: 'r2', request_code: 'ZJK4-RETD' }, error: null }] });
    const r = await createCancellationRequest('e1', { reason: 'שינוי תוכניות', smsConsent: false });
    expect(r).toEqual({ id: 'r2', requestCode: 'ZJK4-RETD' });
    expect(insertMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after three collisions with a plain failure', async () => {
    (requireOwnedEvent as unknown as Mock).mockResolvedValue({ id: 'e1', status: 'active' });
    const { insertMock } = client({ inserts: [CODE_COLLISION] });
    await expect(
      createCancellationRequest('e1', { reason: 'שינוי תוכניות', smsConsent: false }),
    ).rejects.toThrow('פתיחת בקשת הביטול נכשלה');
    expect(insertMock).toHaveBeenCalledTimes(3);
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

  // The base of the fee is what the card paid for the package, handed in by the caller.
  function settings(percent: number, cap: number) {
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { cancellation_fee_percent: percent, cancellation_fee_cap: cap }, error: null }),
          }),
        }),
      }),
    });
  }

  it('is the configured percentage of what the card paid', async () => {
    settings(5, 100);
    expect(await computeSuggestedCancellationAmount(120)).toBeCloseTo(6, 2);
  });

  it('is capped, and never more than what was paid', async () => {
    settings(5, 2);
    expect(await computeSuggestedCancellationAmount(120)).toBeCloseTo(2, 2);
    settings(100, 100000);
    expect(await computeSuggestedCancellationAmount(120)).toBeLessThanOrEqual(120);
  });

  it('with nothing paid the suggestion is 0', async () => {
    settings(5, 100);
    expect(await computeSuggestedCancellationAmount(0)).toBe(0);
  });
});

describe('getCampaignForEventAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  // A fixed-price package's money is in the payment ledger.
  function pricingOf(price: number | null) {
    (getCurrentPricing as unknown as Mock).mockResolvedValue(
      price == null ? null : { roundId: 'round-1', version: 1, listPrice: price, discountAmount: 0, price, lockedAt: '2026-10-07T00:00:00Z', couponAssignmentId: null },
    );
  }

  function adminClientFor(row: Record<string, unknown>) {
    pricingOf((row.package_price as number | null) ?? null);
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    (createAdminClient as unknown as Mock).mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ neq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) }) }),
    });
  }
  const PKG_ROW = { id: 'camp1', package_price: 120, contact_quota: 100 };

  it('a package campaign: what the card paid and whether a card is on file come from the ledger', async () => {
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
    adminClientFor({ ...PKG_ROW, package_price: null, contact_quota: null });
    const r = await getCampaignForEventAdmin('e1', 'req1');
    expect(packageRefundSummary).not.toHaveBeenCalled();
    expect(r).toEqual({
      id: 'camp1',
      contactQuota: null,
      isPackage: false,
      packagePaid: null,
      packageRefundable: null,
      packageRefundedForRequest: null,
      packageUnreadable: false,
      packageRefundDocument: null,
      packageRecord: null,
      hasCardOnFile: false,
    });
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
    const cancelled = { id: 'camp0', status: 'cancelled', created_at: '2026-10-08T08:00:00+00:00', package_price: 120 };
    return where === 'before' ? [cancelled, ...live] : [...live, cancelled];
  }

  // `packagePrice` null is a campaign created under the earlier pay-per-result model: no money moves for it. The resolve
  // never closes such a campaign, and the database keeps the event open while it is operational (R7), so by default it
  // is one that has already ended; a package campaign is running by default.
  function happy(opts: {
    smsConsent?: boolean;
    packagePrice?: number | null;
    campaignStatus?: string;
    // The event also has a CANCELLED campaign (a reset test run leaves one), listed before or after the live one.
    cancelledCampaign?: 'before' | 'after';
  }) {
    (requirePlatformPermission as unknown as Mock).mockResolvedValue({ id: 'staff1' });
    (getCurrentPricing as unknown as Mock).mockResolvedValue(
      opts.packagePrice == null
        ? null
        : { roundId: 'round-1', version: 1, listPrice: opts.packagePrice, discountAmount: 0, price: opts.packagePrice, lockedAt: '2026-10-07T00:00:00Z', couponAssignmentId: null },
    );
    const campaignStatus = opts.campaignStatus ?? (opts.packagePrice == null ? 'closed' : 'active');
    const rpc = vi.fn().mockResolvedValue({
      data: campaignStatus === 'closed' ? 'already_closed' : 'done',
      error: null,
    });
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'r1',
        request_code: '7K4Q-92XM',
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
              status: campaignStatus,
              created_at: '2026-10-08T10:00:00+00:00',
              package_price: opts.packagePrice ?? null,
            },
          ]),
        },
      },
      error: null,
    });
    // The final write: .eq('id').eq('status','pending').select('id') — one row back means this resolve won.
    const resolvedRows = vi.fn().mockResolvedValue({ data: [{ id: 'r1' }], error: null });
    const update = vi.fn().mockReturnValue({ eq: () => ({ error: null, eq: () => ({ select: resolvedRows }) }) });
    const profileSingle = vi.fn().mockResolvedValue({
      data: { full_name: 'דנה', phone: '+972500000000' },
      error: null,
    });
    // adminCloseEvent's own live-status check (events.status via maybeSingle): the event is still 'active', so
    // adminCloseEvent must proceed to actually close it.
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
      rpc,
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'dana@example.com' } } }) } },
    });
    (cancellationRequestResponseEmail as unknown as Mock).mockResolvedValue({ subject: 's', html: '<p>h</p>', text: 't' });
    (buildCancellationSmsText as unknown as Mock).mockReturnValue('sms text');
    const send = vi.fn().mockResolvedValue(undefined);
    (getEmailSender as unknown as Mock).mockResolvedValue({ send });
    const smsSend = vi.fn().mockResolvedValue({ id: 'sms1' });
    (getSmsSender as unknown as Mock).mockResolvedValue({ send: smsSend });
    return { send, smsSend, update, eventStatusMaybeSingle, resolvedRows, rpc };
  }

  // A fixed-price package was paid at purchase and has no settlement. Resolving its cancellation request means giving
  // money BACK: the admin's two resolutions keep the meaning they have for a charged campaign (ביטול מלא = everything
  // goes back; חיוב חלקי = the typed amount or percentage STAYS, the rest goes back). The customer is e-mailed only
  // after the money is confirmed back, and is told what went back; the request closes only after both.
  describe('a fixed-price package campaign', () => {
    const DOC = { id: 9001, number: 4023, url: 'https://example.test/doc/9001' };
    function pkg(over: { status?: string; paid?: number; refundedForRequest?: number } = {}) {
      const h = happy({ packagePrice: 120, campaignStatus: over.status ?? 'active' });
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
      const h = happy({ packagePrice: 120, campaignStatus: 'active', cancelledCampaign: where });
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
      const { update, rpc } = pkg();
      await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
      expect(refundPackagePayment).toHaveBeenCalledWith({ campaignId: 'camp1', eventId: 'e1', amount: 120, cancellationRequestId: 'r1' });
      expect(rpc).toHaveBeenCalledWith('campaign_runstate', {
        p_campaign: 'camp1', p_action: 'close', p_actor: 'staff1',
        p_via: 'cancellation_request', p_cancellation_request: 'r1',
      });
      expect(update).toHaveBeenCalledWith(expect.objectContaining({
        capture_outcome: 'refunded', resolution_amount: 120, refund_document_id: 9001, refund_document_url: DOC.url, status: 'resolved',
      }));
    });

    it('checks the refund, closes through the RPC, refunds, then emails', async () => {
      const { send, rpc } = pkg();
      await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'cancelled' });
      expect(checkPackageRefund).toHaveBeenCalledWith({
        campaignId: 'camp1',
        eventId: 'e1',
        amount: 120,
        cancellationRequestId: 'r1',
      });
      expect(order(checkPackageRefund)).toBeLessThan(order(rpc));
      expect(order(rpc)).toBeLessThan(order(refundPackagePayment));
      expect(order(refundPackagePayment)).toBeLessThan(order(send));
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
        const h = pkg({ status: 'closed', paid: paid - refunded, refundedForRequest: refunded });
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
          resolution: 'partial_charge', resolution_amount: 105, capture_outcome: 'refunded', refund_document_id: 9001, status: 'resolved',
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
        expect(logActivity).toHaveBeenCalledWith({ eventId: 'e1', action: 'event.closed_by_admin', meta: {} });
      });

      it('declining it now is refused: the money is already back, and recording "declined" would be untrue', async () => {
        const { send, update } = resumed(105);
        await expect(
          resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'האירוע כבר בעיצומו' }),
        ).rejects.toThrow('כבר בוצע החזר');
        expect(send).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
      });
    });

    it('keeping everything (100%): nothing goes back, no refund is attempted, the request still closes with no money movement', async () => {
      const { update } = pkg();
      await resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 100, resolutionNote: 'ללא החזר' });
      expect(checkPackageRefund).not.toHaveBeenCalled();
      expect(refundPackagePayment).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ capture_outcome: 'not_applicable', resolution_amount: null }));
    });

    it('declined: no money, no check, the campaign and the event stay open', async () => {
      const { update, rpc } = pkg();
      await resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'האירוע כבר בעיצומו' });
      expect(rpc).not.toHaveBeenCalled();
      expect(checkPackageRefund).not.toHaveBeenCalled();
      expect(refundPackagePayment).not.toHaveBeenCalled();
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
      expect(update).not.toHaveBeenCalled();
    });

    describe('campaign run-state RPC', () => {
      it('refuses an RPC error before refunding or emailing', async () => {
        const { send, smsSend, update, rpc } = pkg();
        rpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } });
        await expect(
          resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'cancelled' }),
        ).rejects.toThrow('סגירת הקמפיין נכשלה');
        expect(rpc).toHaveBeenCalledWith('campaign_runstate', expect.objectContaining({
          p_campaign: 'camp1',
          p_action: 'close',
          p_actor: 'staff1',
          p_via: 'cancellation_request',
          p_cancellation_request: 'r1',
        }));
        expect(checkPackageRefund).toHaveBeenCalledWith({
          campaignId: 'camp1',
          eventId: 'e1',
          amount: 120,
          cancellationRequestId: 'r1',
        });
        expect(order(checkPackageRefund)).toBeLessThan(order(rpc));
        expect(refundPackagePayment).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(smsSend).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
      });

      it('refuses an unexpected RPC result before refunding or emailing', async () => {
        const { send, update, rpc } = pkg();
        rpc.mockResolvedValueOnce({ data: 'forbidden', error: null });
        await expect(
          resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'cancelled' }),
        ).rejects.toThrow('forbidden');
        expect(refundPackagePayment).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
      });
    });

    // The database keeps the event open while any of its campaigns is operational (R7). A package still awaiting approval
    // is not closed by the resolve, so the event close would fail after the e-mail; it is refused before it instead.
    it('a package still awaiting approval keeps the event open: refused BEFORE the e-mail', async () => {
      const { send, update } = pkg({ status: 'pending_approval', paid: 0 });
      await expect(
        resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל' }),
      ).rejects.toThrow('לא ניתן לסגור את האירוע: יש לו קמפיין במצב "ממתין לאישור התנאים"');
      expect(send).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('a campaign that is already closed is not closed again; the event still is', async () => {
      const { rpc } = pkg({ status: 'closed' });
      await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
      expect(rpc).toHaveBeenCalledWith('campaign_runstate', expect.objectContaining({
        p_campaign: 'camp1', p_action: 'close', p_cancellation_request: 'r1',
      }));
      expect(logActivity).toHaveBeenCalledWith({ eventId: 'e1', action: 'event.closed_by_admin', meta: {} });
    });

    it('the SMS carries the amount that went back, as a refund', async () => {
      const { smsSend } = pkg();
      await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
      expect(smsSend).toHaveBeenCalled();
      expect(buildCancellationSmsText).toHaveBeenCalledWith(expect.objectContaining({ resolution: 'full_cancellation', refundedAmount: 120 }));
    });

    it('the SMS links to the refund\'s credit document, as the refund returned it', async () => {
      pkg();
      await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל, מזוכה' });
      expect(buildCancellationSmsText).toHaveBeenCalledWith(expect.objectContaining({ documentUrl: 'https://example.test/doc/9001' }));
    });
  });

  // A campaign created under the earlier pay-per-result model: the resolve moves no money, sends the e-mail first and
  // closes the event.
  describe('a campaign without a package', () => {
    it('full cancellation: no money moves, recorded as not_applicable, the event is closed', async () => {
      const { update } = happy({});
      await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' });
      expect(refundPackagePayment).not.toHaveBeenCalled();
      expect(packageRefundSummary).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ capture_outcome: 'not_applicable', status: 'resolved' }));
      expect(logActivity).toHaveBeenCalledWith({ eventId: 'e1', action: 'event.closed_by_admin', meta: {} });
    });

    it('one that is still operational keeps the event open (R7): refused BEFORE the e-mail', async () => {
      const { send, update } = happy({ campaignStatus: 'pending_approval' });
      await expect(
        resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' }),
      ).rejects.toThrow('לא ניתן לסגור את האירוע');
      expect(send).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it('a fee as a percentage has no base and is refused BEFORE the e-mail', async () => {
      const { send } = happy({});
      await expect(
        resolveCancellationRequest('r1', { resolution: 'partial_charge', resolutionPercent: 5, resolutionNote: 'דמי ביטול 5%' }),
      ).rejects.toThrow('סכום בסיס');
      expect(send).not.toHaveBeenCalled();
    });

    it('declined: records not_applicable', async () => {
      const { update } = happy({});
      await resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'האירוע כבר בעיצומו' });
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ capture_outcome: 'not_applicable' }));
    });
  });

  it('sends email THEN SMS (consent=true) THEN persists, in that order', async () => {
    const { send, smsSend } = happy({});
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' });
    expect(send).toHaveBeenCalled();
    expect(smsSend).toHaveBeenCalled();
  });

  it('does NOT send SMS when sms_consent is false', async () => {
    const { smsSend } = happy({ smsConsent: false });
    await resolveCancellationRequest('r1', { resolution: 'declined', resolutionNote: 'לא ניתן' });
    expect(smsSend).not.toHaveBeenCalled();
  });

  it('throws and persists NOTHING when the email send fails', async () => {
    const { update } = happy({});
    (getEmailSender as unknown as Mock).mockResolvedValue({ send: vi.fn().mockRejectedValue(new Error('boom')) });
    await expect(
      resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'x' }),
    ).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it('adminCloseEvent closes the event and logs it when still active', async () => {
    happy({});
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' });
    expect(logActivity).toHaveBeenCalledWith({ eventId: 'e1', action: 'event.closed_by_admin', meta: {} });
  });

  // resolveCancellationRequest calls adminCloseEvent gated on its own `event.status` snapshot, read once at the top.
  // adminCloseEvent must re-check the LIVE status and no-op rather than write status='closed' again and log a second,
  // misleading activity entry.
  it('adminCloseEvent no-ops (no duplicate write/log) when the event is already closed', async () => {
    const { eventStatusMaybeSingle } = happy({});
    eventStatusMaybeSingle.mockResolvedValue({ data: { status: 'closed' }, error: null });
    await resolveCancellationRequest('r1', { resolution: 'full_cancellation', resolutionNote: 'בוטל במלואו' });
    expect(logActivity).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'event.closed_by_admin' }),
    );
  });

  // Two resolves of the same request both pass the "still pending" check at the top. Only one may record it: the final
  // write is filtered on status='pending', and a write that matched no row is reported, never taken as success.
  it('the final write is only for a request that is still pending, and a lost race is reported', async () => {
    const { update, resolvedRows } = happy({});
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
