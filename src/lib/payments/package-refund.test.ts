import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';
import { withLedgerStamp } from '@/test/ledger-stamp-trigger';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({ getPaymentsEnabled: vi.fn(), getSumitServerConfig: vi.fn() }));
vi.mock('@/lib/data/sumit-customers', () => ({ getSumitCustomerId: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('./cardcom-refund', () => ({ checkCardcomRefund: vi.fn(), refundCardcomPayment: vi.fn(), cardcomRefundSummary: vi.fn() }));
vi.mock('@/lib/sumit/generated/api', () => ({ billingPaymentsCharge: vi.fn(), accountingDocumentsSend: vi.fn() }));
// The real card mapper; only the Vault read is replaced.
vi.mock('./card', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./card')>()),
  readCitizenId: vi.fn(),
}));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentsEnabled, getSumitServerConfig } from '@/lib/data/payments';
import { getSumitCustomerId } from '@/lib/data/sumit-customers';
import { logActivity } from '@/lib/data/activity';
import { accountingDocumentsSend, billingPaymentsCharge } from '@/lib/sumit/generated/api';
import { SumitError } from '@/lib/sumit/mutator';
import { readCitizenId } from './card';
import { deriveStatus } from './status';
import { loadOperations } from './ledger';
import { cardcomRefundSummary, checkCardcomRefund, refundCardcomPayment } from './cardcom-refund';
import { checkPackageRefund, packageRefundSummary, refundPackagePayment } from './package-refund';

// Giving a customer's money back is the one thing here that can never be taken back. The properties defended, each
// against the database double that enforces the real unique indexes:
//   - the PENDING refund row exists before SUMIT is asked to move any money (a crash can never leave a refund unrecorded);
//   - never more than the card actually paid, minus what already went back — checked before AND after the row is taken;
//   - one refund per cancellation request: a double click, a second tab or a retry cannot refund twice;
//   - a clear refusal can be retried; "we do not know" goes to REVIEW and is never retried by the code;
//   - a confirmed refund is never downgraded by a failure of something that comes after it;
//   - no secret (card token, holder id, API key) ever reaches a log line or an alert.

const ONCE = new Set(['authorize', 'charge', 'package_purchase']);
const EFFECT: Record<string, string> = { authorize: 'commit', charge: 'collect', package_purchase: 'collect', package_upgrade: 'collect', refund: 'return' };
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 9, 6, 12, 0, clock++)).toISOString();
function trigger(_table: string, row: TableRow): TableRow {
  return {
    occurred_at: stamp(),
    recorded_at: stamp(),
    ...row,
    once_slot: ONCE.has(String(row.kind)),
    payment_operation_kinds: { effect: EFFECT[String(row.kind)] },
  };
}
// the real one-pending-per-kind index, and the real once-per-request index on meta.cancellation_request_id
const INDEXES = [
  { columns: ['campaign_id', 'kind'], where: { outcome: 'pending' } },
  { columns: ['campaign_id', 'kind'], where: { once_slot: true, outcome: ['pending', 'review', 'succeeded'] } },
];

function seed(kind: string, outcome: string, over: TableRow = {}): TableRow {
  return {
    id: `seed-${kind}-${outcome}`,
    campaign_id: 'c1',
    event_id: 'e1',
    kind,
    outcome,
    amount: 120,
    credit_applied: 0,
    once_slot: ONCE.has(kind),
    payment_operation_kinds: { effect: EFFECT[kind] },
    occurred_at: '2026-10-01T10:00:00.000Z',
    recorded_at: '2026-10-01T10:00:00.000Z',
    meta: {},
    ...over,
  };
}

// The purchase: paid 120 by the card, with the card saved on it and the payer recorded in its meta.
const PURCHASE = seed('package_purchase', 'succeeded', {
  id: 'pur1',
  meta: { payerUserId: 'u1' },
  payment_method_type: '1',
  card_token_ref: 'tok-reusable',
  card_exp_month: 7,
  card_exp_year: 2031,
  card_last4: '9183',
  card_mask: 'XXXXXXXXXXXX9183',
  citizen_id_secret: 'secret-1',
  provider_document_id: 77,
  provider_document_number: 40106,
});

const SECRETS = ['tok-reusable', '316125434', 'test-api-key'];

// What SUMIT answered in the live ₪1 test of 6.10.2026 (payment, amount -1, a credit document), scaled to the amount.
const okAnswer = (amount: number) => ({
  Status: 0,
  Data: {
    Payment: { ID: 555, ValidPayment: true, Status: '000', StatusDescription: 'מאושר (קוד 000)', Amount: -amount, AuthNumber: ' 034692' },
    DocumentID: 9001,
    DocumentNumber: 4023,
    DocumentDownloadURL: 'https://example.test/doc/9001',
    CustomerID: 2127277236,
  },
});

let db: FakeTableClient;
let errorLog: ReturnType<typeof vi.spyOn>;

function useDb(rows: TableRow[] = [PURCHASE], hook?: (table: string, row: TableRow) => void) {
  db = createFakeTableClient(
    { payment_operations: rows },
    {},
    {
      beforeInsert: withLedgerStamp((table, row) => {
        hook?.(table, row);
        return trigger(table, row);
      }),
      uniqueIndexes: INDEXES,
    },
  );
  vi.mocked(createAdminClient).mockReturnValue(db.client as never);
}

const REQ = { campaignId: 'c1', eventId: 'e1', cancellationRequestId: 'req1' };
const refundRows = () => db.rows('payment_operations').filter((r) => r.kind === 'refund');
const everythingLogged = () => JSON.stringify([errorLog.mock.calls, vi.mocked(sendSlackAlert).mock.calls, vi.mocked(logActivity).mock.calls]);

beforeEach(() => {
  vi.resetAllMocks();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  useDb();
  vi.mocked(getPaymentsEnabled).mockResolvedValue(true);
  vi.mocked(getSumitServerConfig).mockResolvedValue({ companyId: 12345, apiKey: 'test-api-key' });
  vi.mocked(getSumitCustomerId).mockResolvedValue(2127277236);
  vi.mocked(readCitizenId).mockResolvedValue('316125434');
  vi.mocked(logActivity).mockResolvedValue(undefined);
  vi.mocked(billingPaymentsCharge).mockImplementation(async (body) => {
    const unit = (body?.Items?.[0]?.UnitPrice ?? 0) as number;
    return okAnswer(-unit) as never;
  });
  vi.mocked(accountingDocumentsSend).mockResolvedValue({ Status: 0 } as never);
});

describe('refundPackagePayment — the money back', () => {
  it('refunds the full amount: a credit line on the saved card and the same customer, recorded as a refund of the purchase', async () => {
    const result = await refundPackagePayment({ ...REQ, amount: 120 });

    expect(result).toEqual({
      status: 'refunded',
      amount: 120,
      alreadyDone: false,
      document: { id: 9001, number: 4023, url: 'https://example.test/doc/9001' },
    });
    const [body, options] = vi.mocked(billingPaymentsCharge).mock.calls[0];
    expect(body).toMatchObject({
      Customer: { ID: 2127277236 },
      PaymentMethod: { CreditCard_Token: 'tok-reusable', CreditCard_ExpirationMonth: 7, CreditCard_ExpirationYear: 2031, CreditCard_CitizenID: '316125434', Type: 1 },
      SupportCredit: true,
      AutoCapture: true,
    });
    expect(body?.Items).toHaveLength(1);
    expect(body?.Items?.[0]).toMatchObject({ Quantity: 1, UnitPrice: -120 });
    expect(JSON.stringify(body)).not.toContain('Credentials');
    expect(options).toMatchObject({ sumit: { creds: { companyId: 12345, apiKey: 'test-api-key' }, timeoutMs: 60_000 } });

    expect(refundRows()).toMatchObject([
      {
        kind: 'refund',
        outcome: 'succeeded',
        amount: 120,
        parent_operation_id: 'pur1',
        meta: { cancellation_request_id: 'req1' },
        provider_payment_id: 555,
        provider_document_id: 9001,
        provider_document_number: 4023,
      },
    ]);
  });

  it('afterwards the ledger says refunded, with nothing collected any more', async () => {
    await refundPackagePayment({ ...REQ, amount: 120 });
    const state = deriveStatus(await loadOperations(db.client as never, 'c1'));
    expect(state).toMatchObject({ status: 'refunded', collected: 0 });
  });

  it('a partial refund leaves the rest collected', async () => {
    await refundPackagePayment({ ...REQ, amount: 50 });
    const state = deriveStatus(await loadOperations(db.client as never, 'c1'));
    expect(state).toMatchObject({ status: 'collected', collected: 70 });
  });

  it('writes the PENDING refund row, with its line, BEFORE SUMIT is asked to move any money', async () => {
    let atCall: { rows: TableRow[]; lines: TableRow[] } | null = null;
    vi.mocked(billingPaymentsCharge).mockImplementation(async () => {
      atCall = { rows: refundRows().map((r) => ({ ...r })), lines: db.rows('payment_operation_lines').map((r) => ({ ...r })) };
      return okAnswer(120) as never;
    });
    await refundPackagePayment({ ...REQ, amount: 120 });
    expect(atCall).not.toBeNull();
    expect(atCall!.rows).toMatchObject([{ outcome: 'pending', amount: 120, parent_operation_id: 'pur1', meta: { cancellation_request_id: 'req1' } }]);
    expect(atCall!.lines).toMatchObject([{ line_no: 1, unit_price: 120 }]);
  });

  it('a credit that SUMIT sends back is taken from the purchase customer, not from whoever pressed the button', async () => {
    await refundPackagePayment({ ...REQ, amount: 120 });
    expect(getSumitCustomerId).toHaveBeenCalledWith('u1');
  });

  it('after a recorded refund: an audit row and a plain Slack note, with ids only', async () => {
    await refundPackagePayment({ ...REQ, amount: 120 });
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'e1', action: 'campaign.package_refunded' }));
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'info', category: 'campaign_billing', source: 'package-refund' }));
  });

  it('asks SUMIT to send the credit document to the customer, by its id', async () => {
    await refundPackagePayment({ ...REQ, amount: 120 });
    expect(accountingDocumentsSend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(accountingDocumentsSend).mock.calls[0][0]).toMatchObject({ EntityID: 9001 });
  });

  it('if that document e-mail fails, the refund still stands and the failure is reported for a person to send it', async () => {
    vi.mocked(accountingDocumentsSend).mockRejectedValue(new SumitError('unreachable', 'x', true));
    const result = await refundPackagePayment({ ...REQ, amount: 120 });
    expect(result.status).toBe('refunded');
    expect(refundRows()[0].outcome).toBe('succeeded');
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });
});

describe('refundPackagePayment — never more than the card paid', () => {
  it('more than was paid is refused before anything is written or sent', async () => {
    expect(await refundPackagePayment({ ...REQ, amount: 120.01 })).toEqual({ status: 'refused', reason: 'exceeds_refundable' });
    expect(refundRows()).toHaveLength(0);
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
  });

  it('what already went back is taken off: 70 left after a refund of 50', async () => {
    useDb([PURCHASE, seed('refund', 'succeeded', { id: 'r0', amount: 50, meta: { cancellation_request_id: 'older' }, parent_operation_id: 'pur1' })]);
    expect(await refundPackagePayment({ ...REQ, amount: 70.01 })).toEqual({ status: 'refused', reason: 'exceeds_refundable' });
    expect((await refundPackagePayment({ ...REQ, amount: 70 })).status).toBe('refunded');
  });

  it('a refund of another request that is still pending or in review counts as already given back', async () => {
    useDb([PURCHASE, seed('refund', 'pending', { id: 'r0', amount: 100, meta: { cancellation_request_id: 'other' }, parent_operation_id: 'pur1' })]);
    expect(await refundPackagePayment({ ...REQ, amount: 30 })).toEqual({ status: 'refused', reason: 'exceeds_refundable' });
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
  });

  it('a credit used on the purchase was never on the card: only what reached it is refundable', async () => {
    useDb([{ ...PURCHASE, amount: 70, credit_applied: 30 }]);
    expect(await refundPackagePayment({ ...REQ, amount: 100 })).toEqual({ status: 'refused', reason: 'exceeds_refundable' });
    expect((await refundPackagePayment({ ...REQ, amount: 70 })).status).toBe('refunded');
  });

  it('a competing refund that lands between the check and the lock is caught AFTER the row is taken — SUMIT is never asked', async () => {
    // The moment OUR pending row is inserted, another session's succeeded refund of 100 appears (it committed in the gap).
    let injected = false;
    useDb([PURCHASE], (table, row) => {
      if (table === 'payment_operations' && row.kind === 'refund' && !injected) {
        injected = true;
        db.tables.payment_operations.push(seed('refund', 'succeeded', { id: 'rival', amount: 100, meta: { cancellation_request_id: 'rival-req' }, parent_operation_id: 'pur1' }));
      }
    });
    const result = await refundPackagePayment({ ...REQ, amount: 100 });
    expect(result).toEqual({ status: 'refused', reason: 'exceeds_refundable' });
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
    const mine = refundRows().find((r) => (r.meta as { cancellation_request_id?: string }).cancellation_request_id === 'req1');
    expect(mine?.outcome).toBe('failed');
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, 10.005])('an amount of %s is refused as invalid', async (amount) => {
    expect(await refundPackagePayment({ ...REQ, amount })).toEqual({ status: 'refused', reason: 'invalid_amount' });
    expect(refundRows()).toHaveLength(0);
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
  });

  it('a campaign that never paid has nothing to refund', async () => {
    useDb([]);
    expect(await refundPackagePayment({ ...REQ, amount: 10 })).toEqual({ status: 'refused', reason: 'no_payment' });
    useDb([seed('package_purchase', 'failed', { id: 'pur-failed' })]);
    expect(await refundPackagePayment({ ...REQ, amount: 10 })).toEqual({ status: 'refused', reason: 'no_payment' });
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
  });
});

describe('refundPackagePayment — once per cancellation request', () => {
  it('a request that already refunded is not refunded again: the earlier refund is returned and SUMIT is not asked', async () => {
    useDb([
      PURCHASE,
      seed('refund', 'succeeded', {
        id: 'r1', amount: 50, meta: { cancellation_request_id: 'req1' }, parent_operation_id: 'pur1',
        provider_document_id: 9001, provider_document_number: 4023, provider_document_url: 'https://example.test/doc/9001',
      }),
    ]);
    expect(await refundPackagePayment({ ...REQ, amount: 50 })).toEqual({
      status: 'refunded', amount: 50, alreadyDone: true, document: { id: 9001, number: 4023, url: 'https://example.test/doc/9001' },
    });
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
    expect(refundRows()).toHaveLength(1);
  });

  it('an attempt of the same request that is pending answers in_progress; in review answers review — neither starts over', async () => {
    useDb([PURCHASE, seed('refund', 'pending', { id: 'r1', amount: 50, meta: { cancellation_request_id: 'req1' }, parent_operation_id: 'pur1' })]);
    expect(await refundPackagePayment({ ...REQ, amount: 50 })).toEqual({ status: 'in_progress' });
    useDb([PURCHASE, seed('refund', 'review', { id: 'r1', amount: 50, meta: { cancellation_request_id: 'req1' }, parent_operation_id: 'pur1' })]);
    expect(await refundPackagePayment({ ...REQ, amount: 50 })).toEqual({ status: 'review' });
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
  });

  it('an earlier attempt that FAILED may be tried again, and the failed row stays as the record', async () => {
    useDb([PURCHASE, seed('refund', 'failed', { id: 'r1', amount: 50, meta: { cancellation_request_id: 'req1' }, parent_operation_id: 'pur1' })]);
    expect((await refundPackagePayment({ ...REQ, amount: 50 })).status).toBe('refunded');
    expect(refundRows().map((r) => r.outcome)).toEqual(['failed', 'succeeded']);
  });

  it('two clicks at once: one refund goes out, the other is told it is in progress', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(billingPaymentsCharge).mockImplementation(async () => {
      await gate;
      return okAnswer(120) as never;
    });
    const first = refundPackagePayment({ ...REQ, amount: 120 });
    await vi.waitFor(() => expect(billingPaymentsCharge).toHaveBeenCalledTimes(1));
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'in_progress' });
    release();
    expect((await first).status).toBe('refunded');
    expect(billingPaymentsCharge).toHaveBeenCalledTimes(1);
  });
});

describe('refundPackagePayment — what SUMIT answers', () => {
  it('a clear refusal fails the row, alerts, and the refund may be tried again', async () => {
    vi.mocked(billingPaymentsCharge).mockRejectedValueOnce(new SumitError('rejected', 'SUMIT דחתה את הבקשה', false, undefined, 'לא ניתן לזכות'));
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'declined' });
    expect(refundRows()).toMatchObject([{ outcome: 'failed' }]);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn', category: 'campaign_billing' }));
    expect((await refundPackagePayment({ ...REQ, amount: 120 })).status).toBe('refunded');
    expect(refundRows().map((r) => r.outcome)).toEqual(['failed', 'succeeded']);
  });

  it.each([
    ['the network', () => new SumitError('unreachable', 'x', true)],
    ['a SUMIT technical error', () => new SumitError('provider_error', 'x', true)],
    ['an unreadable answer', () => new SumitError('bad_body', 'x', true)],
    ['an unknown status', () => new SumitError('unknown_status', 'x', true)],
    ['an unexpected error', () => new Error('boom')],
  ])('%s → REVIEW, an alert, and nothing retries on its own', async (_label, make) => {
    vi.mocked(billingPaymentsCharge).mockRejectedValueOnce(make());
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'review' });
    expect(refundRows()).toMatchObject([{ outcome: 'review' }]);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', category: 'campaign_billing' }));
    // the money may already be back: a second click must not send another credit
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'review' });
    expect(billingPaymentsCharge).toHaveBeenCalledTimes(1);
  });

  it('a request SUMIT could not even accept (invalid_request, nothing sent) fails the row', async () => {
    vi.mocked(billingPaymentsCharge).mockRejectedValueOnce(new SumitError('invalid_request', 'x', false));
    expect((await refundPackagePayment({ ...REQ, amount: 120 })).status).toBe('declined');
    expect(refundRows()).toMatchObject([{ outcome: 'failed' }]);
  });

  it('Status 0 with ValidPayment false is a refusal by the issuer: failed, can be tried again', async () => {
    vi.mocked(billingPaymentsCharge).mockResolvedValueOnce({ Status: 0, Data: { Payment: { ValidPayment: false, Status: '004' } } } as never);
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'declined' });
    expect(refundRows()).toMatchObject([{ outcome: 'failed' }]);
  });

  it.each([
    ['no ValidPayment flag', { Status: 0, Data: { Payment: { ID: 5, Amount: -120 }, DocumentID: 9 } }],
    ['no document', { Status: 0, Data: { Payment: { ID: 5, ValidPayment: true, Amount: -120 } } }],
    ['an amount that is not the refund we asked for', { Status: 0, Data: { Payment: { ID: 5, ValidPayment: true, Amount: -100 }, DocumentID: 9 } }],
    ['a positive amount (a CHARGE, not a credit)', { Status: 0, Data: { Payment: { ID: 5, ValidPayment: true, Amount: 120 }, DocumentID: 9 } }],
    ['an empty answer', { Status: 0 }],
  ])('%s → never "succeeded": REVIEW', async (_label, answer) => {
    vi.mocked(billingPaymentsCharge).mockResolvedValueOnce(answer as never);
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'review' });
    expect(refundRows()).toMatchObject([{ outcome: 'review' }]);
  });

  it('SUMIT confirmed but the row could not be closed: REVIEW with the provider references, a loud alert, no second refund', async () => {
    db.fail('payment_operations', '57014', 'update'); // the succeeded completion fails; the review fallback goes through
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'review' });
    expect(refundRows()[0]).toMatchObject({ outcome: 'review', provider_payment_id: 555, provider_document_number: 4023 });
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', fields: expect.objectContaining({ campaign_id: 'c1', document_number: 4023 }) }),
    );
    expect(billingPaymentsCharge).toHaveBeenCalledTimes(1);
  });

  it('when even the review fallback fails the row stays pending for the sweeper, and the alert still went out', async () => {
    db.fail('payment_operations', '57014', 'update');
    db.fail('payment_operations', '57014', 'update');
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'review' });
    expect(refundRows()[0].outcome).toBe('pending');
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});

describe('refundPackagePayment — closed gates and missing pieces: nothing written, nothing sent', () => {
  it.each([
    ['payments are off', () => vi.mocked(getPaymentsEnabled).mockResolvedValue(false)],
    ['the provider is not configured', () => vi.mocked(getSumitServerConfig).mockResolvedValue(null)],
  ])('%s → refused (disabled)', async (_label, close) => {
    close();
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'refused', reason: 'disabled' });
    expect(refundRows()).toHaveLength(0);
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
  });

  it('no SUMIT customer number for the payer: refused — a credit must never open a second customer', async () => {
    vi.mocked(getSumitCustomerId).mockResolvedValue(null);
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'refused', reason: 'no_customer' });
    expect(refundRows()).toHaveLength(0);
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
  });

  it('a purchase that does not say who paid: refused (no customer)', async () => {
    useDb([{ ...PURCHASE, meta: {} }]);
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'refused', reason: 'no_customer' });
  });

  it.each([
    ['no card was saved', () => useDb([{ ...PURCHASE, card_token_ref: null }])],
    ['the card has no expiry', () => useDb([{ ...PURCHASE, card_exp_month: null }])],
    ['the holder id is not in the vault', () => vi.mocked(readCitizenId).mockResolvedValue(null)],
  ])('%s → refused (no card), the admin refunds by hand', async (_label, arrange) => {
    arrange();
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'refused', reason: 'no_card' });
    expect(refundRows()).toHaveLength(0);
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
  });

  it('a ledger that cannot be read answers error and sends nothing', async () => {
    db.fail('payment_operations', '57014', 'select');
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'error' });
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
  });

  it('a refund lock that cannot be taken answers error and sends nothing', async () => {
    db.fail('payment_operations', '57014', 'insert');
    expect(await refundPackagePayment({ ...REQ, amount: 120 })).toEqual({ status: 'error' });
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
  });
});

// The caller (the admin's cancellation resolution) sends the customer an e-mail BEFORE any money moves, so it must
// know that the refund can go ahead before it promises one. checkPackageRefund is that look: it reads and writes
// nothing, and answers null when refundPackagePayment would proceed.
describe('checkPackageRefund — the look before the promise', () => {
  it('null when the refund can go ahead, and nothing is written or sent', async () => {
    expect(await checkPackageRefund({ ...REQ, amount: 120 })).toBeNull();
    expect(refundRows()).toHaveLength(0);
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
  });

  it.each([
    ['more than was paid', { amount: 121 }, { status: 'refused', reason: 'exceeds_refundable' }],
    ['an invalid amount', { amount: 0 }, { status: 'refused', reason: 'invalid_amount' }],
  ])('%s is reported without side effects', async (_label, over, expected) => {
    expect(await checkPackageRefund({ ...REQ, ...over })).toEqual(expected);
    expect(refundRows()).toHaveLength(0);
  });

  it('reports the same refusals the refund itself would: no card, no customer, closed gate', async () => {
    useDb([{ ...PURCHASE, card_token_ref: null }]);
    expect(await checkPackageRefund({ ...REQ, amount: 10 })).toEqual({ status: 'refused', reason: 'no_card' });
    useDb();
    vi.mocked(getSumitCustomerId).mockResolvedValueOnce(null);
    expect(await checkPackageRefund({ ...REQ, amount: 10 })).toEqual({ status: 'refused', reason: 'no_customer' });
    vi.mocked(getPaymentsEnabled).mockResolvedValueOnce(false);
    expect(await checkPackageRefund({ ...REQ, amount: 10 })).toEqual({ status: 'refused', reason: 'disabled' });
  });

  it('a request that already refunded is reported as refunded (so a retry resumes instead of refunding again)', async () => {
    useDb([PURCHASE, seed('refund', 'succeeded', { id: 'r1', amount: 50, meta: { cancellation_request_id: 'req1' }, parent_operation_id: 'pur1' })]);
    expect(await checkPackageRefund({ ...REQ, amount: 50 })).toMatchObject({ status: 'refunded', alreadyDone: true, amount: 50 });
  });

  it('an unreadable ledger is an error, never "fine"', async () => {
    db.fail('payment_operations', '57014', 'select');
    expect(await checkPackageRefund({ ...REQ, amount: 10 })).toEqual({ status: 'error' });
  });
});

// What the admin screen and the resolution need to know about a package campaign's money.
describe('packageRefundSummary', () => {
  it('what can still go back, whether a card is on file, and nothing refunded for a request yet', async () => {
    expect(await packageRefundSummary('c1', 'req1')).toEqual({ refundable: 120, refundedForRequest: 0, hasCard: true, refundDocument: null });
  });

  it('what was refunded for THIS request, apart from other refunds', async () => {
    useDb([
      PURCHASE,
      seed('refund', 'succeeded', { id: 'r1', amount: 50, meta: { cancellation_request_id: 'req1' }, parent_operation_id: 'pur1', provider_document_id: 7001, provider_document_number: 5001, provider_document_url: 'https://example.test/doc/7001' }),
      seed('refund', 'succeeded', { id: 'r2', amount: 10, meta: { cancellation_request_id: 'other' }, parent_operation_id: 'pur1' }),
    ]);
    // The credit document is THIS request's refund, never the other request's.
    expect(await packageRefundSummary('c1', 'req1')).toEqual({
      refundable: 60, refundedForRequest: 50, hasCard: true,
      refundDocument: { id: 7001, number: 5001, url: 'https://example.test/doc/7001' },
    });
  });

  it('without a request id it only reports the refundable amount', async () => {
    expect(await packageRefundSummary('c1')).toEqual({ refundable: 120, refundedForRequest: 0, hasCard: true, refundDocument: null });
  });

  it('no usable card → hasCard false', async () => {
    useDb([{ ...PURCHASE, citizen_id_secret: null }]);
    expect((await packageRefundSummary('c1')).hasCard).toBe(false);
    useDb([{ ...PURCHASE, card_exp_year: null }]);
    expect((await packageRefundSummary('c1')).hasCard).toBe(false);
  });

  it('a campaign that never paid: nothing refundable, no card', async () => {
    useDb([]);
    expect(await packageRefundSummary('c1')).toEqual({ refundable: 0, refundedForRequest: 0, hasCard: false, refundDocument: null });
  });

  it('throws when the ledger cannot be read — a screen must not show "nothing to refund" on a failed read', async () => {
    db.fail('payment_operations', '57014', 'select');
    await expect(packageRefundSummary('c1')).rejects.toThrow();
  });
});

describe('refundPackagePayment — nothing secret is ever logged or alerted', () => {
  it.each([
    ['a refund', () => undefined],
    ['a refusal by SUMIT', () => vi.mocked(billingPaymentsCharge).mockRejectedValueOnce(new SumitError('rejected', 'x', false, undefined, 'tok-reusable 316125434 test-api-key'))],
    ['an unclear answer', () => vi.mocked(billingPaymentsCharge).mockRejectedValueOnce(new Error('boom tok-reusable 316125434 test-api-key'))],
    ['a completion failure', () => db.fail('payment_operations', '57014', 'update')],
  ])('%s', async (_label, arrange) => {
    arrange();
    await refundPackagePayment({ ...REQ, amount: 120 });
    const logged = everythingLogged();
    for (const secret of SECRETS) expect(logged).not.toContain(secret);
  });
});

// The money goes back through the company that was PAID — read from the purchase itself, never from today's switch.
describe('which clearing company a refund goes to', () => {
  const CARDCOM_PURCHASE = { ...PURCHASE, meta: { provider: 'cardcom', payerUserId: 'u1' } };
  const asked = { ...REQ, amount: 120 };

  it('a CardCom purchase is refunded by the CardCom path — and SUMIT is never asked', async () => {
    useDb([CARDCOM_PURCHASE]);
    vi.mocked(refundCardcomPayment).mockResolvedValue({ status: 'declined' });
    await expect(refundPackagePayment(asked)).resolves.toEqual({ status: 'declined' });
    expect(refundCardcomPayment).toHaveBeenCalledWith(asked);
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
    expect(refundRows()).toHaveLength(0);
  });

  it('the look before the promise and the summary follow the same rule', async () => {
    useDb([CARDCOM_PURCHASE]);
    vi.mocked(checkCardcomRefund).mockResolvedValue(null);
    vi.mocked(cardcomRefundSummary).mockResolvedValue({ refundable: 120, refundedForRequest: 0, hasCard: true, refundDocument: null });
    await expect(checkPackageRefund(asked)).resolves.toBeNull();
    await expect(packageRefundSummary('c1', 'req1')).resolves.toEqual({ refundable: 120, refundedForRequest: 0, hasCard: true, refundDocument: null });
    expect(checkCardcomRefund).toHaveBeenCalledWith(asked);
    expect(cardcomRefundSummary).toHaveBeenCalledWith('c1', 'req1');
  });

  it('a purchase with no provider in its meta (everything before the pilot) stays a SUMIT refund', async () => {
    useDb([PURCHASE]);
    await refundPackagePayment({ ...REQ, amount: 120 });
    expect(refundCardcomPayment).not.toHaveBeenCalled();
    expect(billingPaymentsCharge).toHaveBeenCalled();
  });

  it('when the purchase cannot be read the refund is an ERROR, never a guess that sends the money to the wrong company', async () => {
    useDb([PURCHASE]);
    db.fail('payment_operations', '42501', 'select');
    await expect(refundPackagePayment(asked)).resolves.toEqual({ status: 'error' });
    useDb([PURCHASE]);
    db.fail('payment_operations', '42501', 'select');
    await expect(checkPackageRefund(asked)).resolves.toEqual({ status: 'error' });
    expect(billingPaymentsCharge).not.toHaveBeenCalled();
    expect(refundCardcomPayment).not.toHaveBeenCalled();
  });

  it('the summary throws when the purchase cannot be read, so "nothing to refund" is never the face of a failed read', async () => {
    useDb([PURCHASE]);
    db.fail('payment_operations', '42501', 'select');
    await expect(packageRefundSummary('c1')).rejects.toBeTruthy();
  });
});
