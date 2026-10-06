import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({
  getPaymentsEnabled: vi.fn(),
  getPackageModelEnabled: vi.fn(),
  getSumitServerConfig: vi.fn(),
}));
vi.mock('@/lib/data/billing', () => ({ getCampaignCreditTotal: vi.fn() }));
vi.mock('@/lib/data/sumit-customers', () => ({ getSumitCustomerId: vi.fn(), recordSumitCustomerId: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/tax-ceiling', () => ({ checkOsekPaturCeilingAfterCharge: vi.fn() }));
// The real error classes (the purchase tells a decline from "we do not know" by class), a fake network call.
vi.mock('@/lib/sumit/charge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sumit/charge')>()),
  chargeSumit: vi.fn(),
}));
// The real card mapper; only the Vault write is replaced.
vi.mock('@/lib/payments/card', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments/card')>()),
  saveCitizenId: vi.fn(),
}));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPackageModelEnabled, getPaymentsEnabled, getSumitServerConfig } from '@/lib/data/payments';
import { getCampaignCreditTotal } from '@/lib/data/billing';
import { getSumitCustomerId, recordSumitCustomerId } from '@/lib/data/sumit-customers';
import { logActivity } from '@/lib/data/activity';
import { checkOsekPaturCeilingAfterCharge } from '@/lib/data/tax-ceiling';
import { chargeSumit, SumitDeclinedError, SumitNetworkError, type SumitChargeResult } from '@/lib/sumit/charge';
import { saveCitizenId } from '@/lib/payments/card';
import type { CampaignPurchaseState } from '@/lib/data/campaigns';
import { getPackagePaymentState, purchasePackage, type PackagePurchaseInput } from './package-purchase';

// The package purchase is the one place a customer's card is charged for the whole package, once. The properties
// defended here, each against the database double that enforces the real unique indexes:
//   - the PENDING ledger row exists before SUMIT is asked for money (a crash can never leave a charge unrecorded);
//   - the amount is the campaign's own package_price, never anything the browser sent;
//   - a double click, a second tab, or a retry after a payment already exists cannot charge twice;
//   - a clear decline can be retried; "we do not know" and "charged but not recorded" go to REVIEW, never to a retry;
//   - a confirmed charge is never downgraded by a failure of something that comes after it (the card vault, the
//     customer-number anchor, the audit row).

// What the database does around the table: BEFORE INSERT stamps the timestamps, the registry's once_per_campaign
// flag (once_slot) and — for the join loadOperations reads — the kind's effect. The two partial unique indexes are
// the real ones (payment_operations_one_pending_uq, payment_operations_once_uq).
const ONCE = new Set(['authorize', 'charge', 'package_purchase']);
const EFFECT: Record<string, string> = { authorize: 'commit', charge: 'collect', package_purchase: 'collect', package_upgrade: 'collect', refund: 'return' };
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 9, 4, 12, 0, clock++)).toISOString();
function trigger(_table: string, row: TableRow): TableRow {
  return {
    occurred_at: stamp(),
    recorded_at: stamp(),
    ...row,
    once_slot: ONCE.has(String(row.kind)),
    payment_operation_kinds: { effect: EFFECT[String(row.kind)] },
  };
}
const INDEXES = [
  { columns: ['campaign_id', 'kind'], where: { outcome: 'pending' } },
  { columns: ['campaign_id', 'kind'], where: { once_slot: true, outcome: ['pending', 'review', 'succeeded'] } },
];

function existing(kind: string, outcome: string, over: TableRow = {}): TableRow {
  return {
    id: `seed-${outcome}`,
    campaign_id: 'c1',
    event_id: 'e1',
    kind,
    outcome,
    amount: 120,
    once_slot: ONCE.has(kind),
    payment_operation_kinds: { effect: EFFECT[kind] },
    occurred_at: '2026-10-01T10:00:00.000Z',
    recorded_at: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

const GOOD: SumitChargeResult = {
  documentId: 77,
  documentNumber: 40106,
  documentUrl: 'https://example.test/doc/77',
  paymentId: 4242,
  authNumber: '0759469',
  status: '000',
  statusDescription: 'מאושר (קוד 000)',
  sumitCustomerId: 2127277236,
  paymentMethod: {
    Type: 1,
    CreditCard_Token: 'tok-reusable',
    CreditCard_ExpirationMonth: 7,
    CreditCard_ExpirationYear: 2031,
    CreditCard_LastDigits: '9183',
    CreditCard_CardMask: 'XXXXXXXXXXXX9183',
    CreditCard_CitizenID: '316125434',
  },
};

const CAMPAIGN: CampaignPurchaseState = { id: 'c1', event_id: 'e1', status: 'approved', package_price: 120, capture_status: null, charge_status: null };
const SECRETS = ['og-token-123', 'test-api-key', 'tok-reusable', '316125434'];

function input(over: { campaign?: Partial<CampaignPurchaseState> } = {}): PackagePurchaseInput {
  return {
    campaign: { ...CAMPAIGN, ...over.campaign },
    payer: { userId: 'u1', email: 'dana@example.com', name: 'דנה כהן' },
    ogToken: 'og-token-123',
  };
}

let db: FakeTableClient;
let errorLog: ReturnType<typeof vi.spyOn>;

function useDb(seed: TableRow[] = []) {
  db = createFakeTableClient({ payment_operations: seed }, {}, { beforeInsert: trigger, uniqueIndexes: INDEXES });
  vi.mocked(createAdminClient).mockReturnValue(db.client as never);
}

// Everything the code logged or alerted, flattened — to prove no secret and no card data ever leaves in a log line.
function everythingLogged(): string {
  return JSON.stringify([errorLog.mock.calls, vi.mocked(sendSlackAlert).mock.calls]);
}

beforeEach(() => {
  vi.resetAllMocks();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  useDb();
  vi.mocked(getPaymentsEnabled).mockResolvedValue(true);
  vi.mocked(getPackageModelEnabled).mockResolvedValue(true);
  vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 12345, apiKey: 'test-api-key' });
  vi.mocked(getCampaignCreditTotal).mockResolvedValue(0);
  vi.mocked(getSumitCustomerId).mockResolvedValue(null);
  vi.mocked(recordSumitCustomerId).mockResolvedValue(undefined);
  vi.mocked(logActivity).mockResolvedValue(undefined);
  vi.mocked(saveCitizenId).mockResolvedValue('secret-1');
  vi.mocked(chargeSumit).mockResolvedValue(GOOD);
});

function purchaseRows(): TableRow[] {
  return db.rows('payment_operations').filter((r) => r.kind === 'package_purchase');
}

describe('purchasePackage — closed gates (fail-closed, nothing written, nothing charged)', () => {
  it.each([
    ['payments are off', () => vi.mocked(getPaymentsEnabled).mockResolvedValue(false)],
    ['the package model is off', () => vi.mocked(getPackageModelEnabled).mockResolvedValue(false)],
    ['the provider is not configured', () => vi.mocked(getSumitServerConfig).mockResolvedValue(null)],
  ])('%s → disabled', async (_label, close) => {
    close();
    expect(await purchasePackage(input())).toBe('disabled');
    expect(chargeSumit).not.toHaveBeenCalled();
    expect(db.rows('payment_operations')).toHaveLength(0);
  });
});

describe('purchasePackage — only a signed package campaign with a real price can be bought', () => {
  it.each(['draft', 'pending_approval', 'active', 'closed', 'cancelled'] as const)('a %s campaign → not_purchasable', async (status) => {
    expect(await purchasePackage(input({ campaign: { status } }))).toBe('not_purchasable');
    expect(chargeSumit).not.toHaveBeenCalled();
    expect(db.rows('payment_operations')).toHaveLength(0);
  });

  it.each([null, 0, -5, Number.NaN])('package_price %s (a pay-per-result campaign, or no usable amount) → not_purchasable', async (price) => {
    expect(await purchasePackage(input({ campaign: { package_price: price } }))).toBe('not_purchasable');
    expect(chargeSumit).not.toHaveBeenCalled();
    expect(db.rows('payment_operations')).toHaveLength(0);
  });
});

describe('purchasePackage — a campaign that already carries an old-style payment is not a clean package campaign', () => {
  it.each(['pending', 'authorized', 'hold_failed', 'hold_review'])('a card hold in state %s → not_purchasable', async (capture) => {
    expect(await purchasePackage(input({ campaign: { capture_status: capture } }))).toBe('not_purchasable');
    expect(chargeSumit).not.toHaveBeenCalled();
    expect(db.rows('payment_operations')).toHaveLength(0);
  });

  it.each(['pending', 'charged', 'charge_failed', 'charge_review', 'nothing_to_charge'])('a final-charge state %s → not_purchasable', async (charge) => {
    expect(await purchasePackage(input({ campaign: { charge_status: charge } }))).toBe('not_purchasable');
    expect(chargeSumit).not.toHaveBeenCalled();
    expect(db.rows('payment_operations')).toHaveLength(0);
  });
});

describe('purchasePackage — credits are not silently ignored', () => {
  it('an event with unspent credit is refused until credit deduction exists (charging the full price would overcharge)', async () => {
    vi.mocked(getCampaignCreditTotal).mockResolvedValue(20);
    expect(await purchasePackage(input())).toBe('credit_unsupported');
    expect(getCampaignCreditTotal).toHaveBeenCalledWith('c1', 'e1');
    expect(chargeSumit).not.toHaveBeenCalled();
    expect(db.rows('payment_operations')).toHaveLength(0);
  });

  it('a credit lookup that fails is an error, never "no credit"', async () => {
    vi.mocked(getCampaignCreditTotal).mockRejectedValue(new Error('שליפת הזיכויים נכשלה'));
    expect(await purchasePackage(input())).toBe('error');
    expect(chargeSumit).not.toHaveBeenCalled();
    expect(db.rows('payment_operations')).toHaveLength(0);
  });
});

describe('purchasePackage — a payment that already exists blocks a second one', () => {
  it('already collected → already_paid, no new row, no charge', async () => {
    useDb([existing('package_purchase', 'succeeded')]);
    expect(await purchasePackage(input())).toBe('already_paid');
    expect(chargeSumit).not.toHaveBeenCalled();
    expect(db.rows('payment_operations')).toHaveLength(1);
  });

  it('the ledger answers before the campaign\'s own state: once paid, a later status change or credit does not turn "paid" into an error', async () => {
    useDb([existing('package_purchase', 'succeeded')]);
    vi.mocked(getCampaignCreditTotal).mockResolvedValue(20);
    expect(await purchasePackage(input({ campaign: { status: 'active' } }))).toBe('already_paid');
    expect(getCampaignCreditTotal).not.toHaveBeenCalled();
    expect(chargeSumit).not.toHaveBeenCalled();
  });

  it('a purchase in flight → in_progress', async () => {
    useDb([existing('package_purchase', 'pending')]);
    expect(await purchasePackage(input())).toBe('in_progress');
    expect(chargeSumit).not.toHaveBeenCalled();
  });

  it('a purchase waiting for a person (review) → review: the card may already have been charged', async () => {
    useDb([existing('package_purchase', 'review')]);
    expect(await purchasePackage(input())).toBe('review');
    expect(chargeSumit).not.toHaveBeenCalled();
  });

  it('a campaign that was refunded is not purchasable again through this route', async () => {
    useDb([existing('package_purchase', 'succeeded'), existing('refund', 'succeeded', { id: 'seed-refund', occurred_at: '2026-10-02T10:00:00.000Z', recorded_at: '2026-10-02T10:00:00.000Z' })]);
    expect(await purchasePackage(input())).toBe('not_purchasable');
    expect(chargeSumit).not.toHaveBeenCalled();
  });

  it('an earlier DECLINED attempt does not block a new one', async () => {
    useDb([existing('package_purchase', 'failed')]);
    expect(await purchasePackage(input())).toBe('paid');
    expect(chargeSumit).toHaveBeenCalledTimes(1);
  });

  it('a ledger that cannot be read is an error, never "nothing paid yet"', async () => {
    db.fail('payment_operations', '57014', 'select');
    expect(await purchasePackage(input())).toBe('error');
    expect(chargeSumit).not.toHaveBeenCalled();
    expect(db.rows('payment_operations')).toHaveLength(0);
  });

  it('the race the pre-check cannot see: the database refuses the second pending row (23505) → in_progress, no charge', async () => {
    db.fail('payment_operations', '23505', 'insert');
    // the pre-check reads first (select), so the forced failure lands on the INSERT
    expect(await purchasePackage(input())).toBe('in_progress');
    expect(chargeSumit).not.toHaveBeenCalled();
  });

  it('any other failure to take the lock is an error and nothing is charged', async () => {
    db.fail('payment_operations', '40001', 'insert');
    expect(await purchasePackage(input())).toBe('error');
    expect(chargeSumit).not.toHaveBeenCalled();
  });

  it('two clicks at once: exactly one charge and one succeeded row', async () => {
    const [a, b] = await Promise.all([purchasePackage(input()), purchasePackage(input())]);
    expect([a, b].sort()).toEqual(['in_progress', 'paid']);
    expect(chargeSumit).toHaveBeenCalledTimes(1);
    expect(purchaseRows().filter((r) => r.outcome === 'succeeded')).toHaveLength(1);
  });
});

describe('purchasePackage — the charge', () => {
  it('writes the PENDING row (with the server price and the payer) BEFORE asking SUMIT for money', async () => {
    let atCharge: TableRow[] = [];
    vi.mocked(chargeSumit).mockImplementation(async () => {
      atCharge = db.rows('payment_operations').map((r) => ({ ...r }));
      return GOOD;
    });
    await purchasePackage(input());
    expect(atCharge).toHaveLength(1);
    expect(atCharge[0]).toMatchObject({
      campaign_id: 'c1',
      event_id: 'e1',
      kind: 'package_purchase',
      outcome: 'pending',
      amount: 120,
      meta: { payerUserId: 'u1' },
    });
  });

  it('writes what the price is made of as ONE line, before asking SUMIT for money: the receipt wording and the server price', async () => {
    let linesAtCharge: TableRow[] = [];
    vi.mocked(chargeSumit).mockImplementation(async () => {
      linesAtCharge = db.rows('payment_operation_lines').map((r) => ({ ...r }));
      return GOOD;
    });
    await purchasePackage(input({ campaign: { package_price: 149.9 } }));
    expect(linesAtCharge).toMatchObject([
      { operation_id: purchaseRows()[0].id, line_no: 1, description: 'KALFA — חבילת אישורי הגעה לאירוע', quantity: 1, unit_price: 149.9 },
    ]);
    expect(purchaseRows()[0]).toMatchObject({ outcome: 'succeeded', amount: 149.9, credit_applied: 0 });
  });

  it('if the line cannot be written nothing is charged: the row is closed as failed and the customer gets the error outcome', async () => {
    db.fail('payment_operation_lines', '23514', 'insert');
    expect(await purchasePackage(input())).toBe('error');
    expect(chargeSumit).not.toHaveBeenCalled();
    expect(purchaseRows()).toMatchObject([{ outcome: 'failed' }]);
  });

  it('asks for exactly the campaign price, as a 2-decimal string, with the operation id as the reconciliation reference', async () => {
    vi.mocked(getSumitCustomerId).mockResolvedValue(2127277236);
    await purchasePackage(input({ campaign: { package_price: 149.9 } }));
    const sent = vi.mocked(chargeSumit).mock.calls[0][0];
    expect(sent).toEqual({
      companyId: 12345,
      apiKey: 'test-api-key',
      ogToken: 'og-token-123',
      amount: '149.90',
      description: 'KALFA — חבילת אישורי הגעה לאירוע',
      externalRef: purchaseRows()[0].id,
      customerEmail: 'dana@example.com',
      customerName: 'דנה כהן',
      customerId: 2127277236,
    });
  });

  it('a payer with no known customer number is sent without one (SUMIT opens the customer)', async () => {
    await purchasePackage(input());
    expect(vi.mocked(chargeSumit).mock.calls[0][0].customerId).toBeNull();
  });

  it('records the confirmed charge: succeeded, every provider reference, the card without the holder id', async () => {
    expect(await purchasePackage(input())).toBe('paid');
    expect(purchaseRows()).toHaveLength(1);
    expect(purchaseRows()[0]).toMatchObject({
      outcome: 'succeeded',
      amount: 120,
      provider_payment_id: 4242,
      provider_auth_ref: '0759469',
      provider_status: '000',
      provider_status_description: 'מאושר (קוד 000)',
      provider_document_id: 77,
      provider_document_number: 40106,
      provider_document_url: 'https://example.test/doc/77',
      payment_method_type: '1',
      card_token_ref: 'tok-reusable',
      card_exp_month: 7,
      card_exp_year: 2031,
      card_last4: '9183',
      card_mask: 'XXXXXXXXXXXX9183',
      citizen_id_secret: 'secret-1',
    });
    // the holder id went to the vault, and only the secret's id is on the row
    expect(saveCitizenId).toHaveBeenCalledWith(db.client, 'c1', '316125434');
    expect(JSON.stringify(purchaseRows()[0])).not.toContain('316125434');
  });

  it('keeps the payer\'s SUMIT customer number and writes an audit row (ids and amounts only)', async () => {
    await purchasePackage(input());
    expect(recordSumitCustomerId).toHaveBeenCalledWith({ userId: 'u1', sumitCustomerId: 2127277236, campaignId: 'c1' });
    expect(logActivity).toHaveBeenCalledWith({
      eventId: 'e1',
      action: 'campaign.package_purchased',
      meta: { campaignId: 'c1', operationId: purchaseRows()[0].id, amount: 120, documentNumber: 40106 },
    });
  });

  it('a charge that returns no reusable card is still a confirmed payment: succeeded, no card, nothing sent to the vault', async () => {
    vi.mocked(chargeSumit).mockResolvedValue({ ...GOOD, paymentMethod: null });
    expect(await purchasePackage(input())).toBe('paid');
    expect(purchaseRows()[0]).toMatchObject({ outcome: 'succeeded', provider_document_number: 40106 });
    expect(purchaseRows()[0].card_token_ref ?? null).toBeNull();
    expect(saveCitizenId).not.toHaveBeenCalled();
  });

  it('a vault failure does not undo a confirmed charge: succeeded, the card kept without the holder id', async () => {
    vi.mocked(saveCitizenId).mockRejectedValue(new Error('שמירת פרטי הכרטיס נכשלה'));
    expect(await purchasePackage(input())).toBe('paid');
    expect(purchaseRows()[0]).toMatchObject({ outcome: 'succeeded', card_token_ref: 'tok-reusable' });
    expect(purchaseRows()[0].citizen_id_secret ?? null).toBeNull();
    expect(errorLog).toHaveBeenCalled();
  });

  it('follow-ups that fail (customer-number anchor, audit row) never change a confirmed payment', async () => {
    vi.mocked(recordSumitCustomerId).mockRejectedValue(new Error('x'));
    vi.mocked(logActivity).mockRejectedValue(new Error('x'));
    expect(await purchasePackage(input())).toBe('paid');
    expect(purchaseRows()[0].outcome).toBe('succeeded');
  });
});

describe('purchasePackage — a decline is certain; everything else is not', () => {
  it('a decline fails the row, alerts, and the customer can try again', async () => {
    vi.mocked(chargeSumit).mockRejectedValueOnce(new SumitDeclinedError());
    expect(await purchasePackage(input())).toBe('declined');
    expect(purchaseRows()[0].outcome).toBe('failed');
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn', category: 'campaign_billing' }));
    // the retry: a fresh pending row, a second charge, and the first row stays as the record of the decline
    expect(await purchasePackage(input())).toBe('paid');
    expect(purchaseRows().map((r) => r.outcome)).toEqual(['failed', 'succeeded']);
  });

  it.each([
    ['a network failure', () => new SumitNetworkError('שגיאת תקשורת עם מערכת התשלום')],
    ['an unconfirmed answer', () => new SumitNetworkError('אישור התשלום לא התקבל ממערכת')],
    ['an unexpected error', () => new Error('boom')],
  ])('%s → the row goes to REVIEW, an alert is sent, and nothing retries on its own', async (_label, make) => {
    vi.mocked(chargeSumit).mockRejectedValueOnce(make());
    expect(await purchasePackage(input())).toBe('review');
    expect(purchaseRows()[0].outcome).toBe('review');
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', category: 'campaign_billing' }));
    // the card may have been charged: a second click must not charge again
    expect(await purchasePackage(input())).toBe('review');
    expect(chargeSumit).toHaveBeenCalledTimes(1);
  });

  it('a decline whose row cannot be closed leaves it pending for the sweeper, and still reports the decline', async () => {
    vi.mocked(chargeSumit).mockRejectedValueOnce(new SumitDeclinedError());
    // the pre-check is a select and the begin an insert; the FIRST update is the failed-completion
    db.fail('payment_operations', '57014', 'update');
    expect(await purchasePackage(input())).toBe('declined');
    expect(purchaseRows()[0].outcome).toBe('pending');
    expect(errorLog).toHaveBeenCalled();
  });
});

describe('purchasePackage — the charge was confirmed but could not be recorded', () => {
  it('moves the row to REVIEW with the provider references and alerts loudly; the customer is not told to pay again', async () => {
    db.fail('payment_operations', '57014', 'update'); // the succeeded completion fails, the review fallback goes through
    expect(await purchasePackage(input())).toBe('review');
    expect(purchaseRows()[0]).toMatchObject({
      outcome: 'review',
      provider_payment_id: 4242,
      provider_document_number: 40106,
      provider_auth_ref: '0759469',
    });
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', fields: expect.objectContaining({ campaign_id: 'c1', document_number: 40106 }) }),
    );
  });

  it('when even the review fallback fails the row stays pending (the sweeper moves it to review), and the alert still went out', async () => {
    db.fail('payment_operations', '57014', 'update');
    db.fail('payment_operations', '57014', 'update');
    expect(await purchasePackage(input())).toBe('review');
    expect(purchaseRows()[0].outcome).toBe('pending');
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});

// The yearly turnover alert for the עוסק פטור ceiling (tax-ceiling.ts) must also see package revenue: it runs once the
// payment is RECORDED, never for money that did not move or was not recorded. That it is fail-safe (it never throws or
// rejects, whatever the database says) is the contract of tax-ceiling.ts and is tested there.
describe('purchasePackage — the עוסק פטור ceiling check', () => {
  it('runs once after a recorded payment', async () => {
    expect(await purchasePackage(input())).toBe('paid');
    expect(checkOsekPaturCeilingAfterCharge).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a decline', () => vi.mocked(chargeSumit).mockRejectedValueOnce(new SumitDeclinedError())],
    ['an unclear answer', () => vi.mocked(chargeSumit).mockRejectedValueOnce(new SumitNetworkError('שגיאת תקשורת עם מערכת התשלום'))],
    ['a confirmed charge that could not be recorded', () => db.fail('payment_operations', '57014', 'update')],
  ])('does not run after %s (no recorded revenue)', async (_label, arrange) => {
    arrange();
    await purchasePackage(input());
    expect(checkOsekPaturCeilingAfterCharge).not.toHaveBeenCalled();
  });

  it('does not run for a purchase that was refused because a payment already exists', async () => {
    expect(await purchasePackage(input())).toBe('paid');
    vi.mocked(checkOsekPaturCeilingAfterCharge).mockClear();
    expect(await purchasePackage(input())).toBe('already_paid');
    expect(checkOsekPaturCeilingAfterCharge).not.toHaveBeenCalled();
  });
});

describe('purchasePackage — nothing secret is ever logged or alerted', () => {
  it.each([
    ['a decline', () => vi.mocked(chargeSumit).mockRejectedValueOnce(new SumitDeclinedError())],
    ['an unknown outcome', () => vi.mocked(chargeSumit).mockRejectedValueOnce(new SumitNetworkError('x og-token-123 test-api-key'))],
    ['a persist failure', () => db.fail('payment_operations', '57014', 'update')],
    ['a vault failure', () => vi.mocked(saveCitizenId).mockRejectedValue(new Error('316125434'))],
  ])('%s', async (_label, arrange) => {
    arrange();
    await purchasePackage(input());
    const logged = everythingLogged();
    for (const secret of SECRETS) expect(logged).not.toContain(secret);
  });
});

describe('getPackagePaymentState', () => {
  it('derives the state from the ledger: nothing yet, then collected after a purchase', async () => {
    expect(await getPackagePaymentState('c1')).toEqual({ status: 'none', collected: 0, credit: 0, committed: 0 });
    await purchasePackage(input());
    expect(await getPackagePaymentState('c1')).toEqual({ status: 'collected', collected: 120, credit: 0, committed: 0 });
  });

  it('a purchase waiting for a person reads as review, a purchase in flight as pending', async () => {
    useDb([existing('package_purchase', 'review')]);
    expect((await getPackagePaymentState('c1')).status).toBe('review');
    useDb([existing('package_purchase', 'pending')]);
    expect((await getPackagePaymentState('c1')).status).toBe('pending');
  });

  it('an unreadable ledger throws — it must never look like "nothing paid"', async () => {
    db.fail('payment_operations', '57014', 'select');
    await expect(getPackagePaymentState('c1')).rejects.toThrow();
  });
});
