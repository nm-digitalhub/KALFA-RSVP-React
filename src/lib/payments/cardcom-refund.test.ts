import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({ getPaymentsEnabled: vi.fn() }));
vi.mock('@/lib/data/cardcom-config', () => ({ getCardcomServerConfig: vi.fn(), getCardcomApiPassword: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/cardcom/generated/documents/documents', () => ({ documentsCancelDoc: vi.fn() }));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { CardcomError } from '@/lib/cardcom/mutator';
import { documentsCancelDoc } from '@/lib/cardcom/generated/documents/documents';
import { logActivity } from '@/lib/data/activity';
import { getCardcomApiPassword, getCardcomServerConfig } from '@/lib/data/cardcom-config';
import { getPaymentsEnabled } from '@/lib/data/payments';
import { createAdminClient } from '@/lib/supabase/admin';

import { cardcomRefundSummary, checkCardcomRefund, refundCardcomPayment } from './cardcom-refund';

// Giving a customer's money back is the one thing here that can never be taken back. The properties defended are the same
// as the SUMIT refund's, against the same database double:
//   - the PENDING refund row exists before CardCom is asked to move any money;
//   - never more than the card paid, checked before AND after the row is taken;
//   - one refund per cancellation request: a double click or a retry cannot refund twice;
//   - a clear refusal can be retried; "we do not know" goes to REVIEW and is never retried by the code;
//   - a confirmed refund is never downgraded by a failure of something that comes after it;
//   - the API password never reaches a log line or an alert.
// And three that are CardCom's own: only a FULL refund is built (CancelDoc cancels a document whole); it needs a document
// we can name; and a CancelDoc that answers with a document that is not the refund of the one we asked about is not believed.

const PASSWORD = 'API-PASSWORD-SECRET-123';
const ONCE = new Set(['package_purchase']);
const EFFECT: Record<string, string> = { package_purchase: 'collect', refund: 'return' };
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 9, 7, 12, 0, clock++)).toISOString();
const trigger = (_t: string, row: TableRow): TableRow => ({ occurred_at: stamp(), recorded_at: stamp(), ...row, once_slot: ONCE.has(String(row.kind)), payment_operation_kinds: { effect: EFFECT[String(row.kind)] } });
const INDEXES = [
  { columns: ['campaign_id', 'kind'], where: { outcome: 'pending' } },
  { columns: ['campaign_id', 'kind'], where: { once_slot: true, outcome: ['pending', 'review', 'succeeded'] } },
];

const seed = (kind: string, outcome: string, over: TableRow = {}): TableRow => ({
  id: `seed-${kind}-${outcome}`, campaign_id: 'c1', event_id: 'e1', kind, outcome, amount: 149, credit_applied: 0, once_slot: ONCE.has(kind),
  payment_operation_kinds: { effect: EFFECT[kind] }, occurred_at: '2026-10-01T10:00:00.000Z', recorded_at: '2026-10-01T10:00:00.000Z', meta: {}, ...over,
});
// The purchase: paid 149 through CardCom, a receipt (number 77) issued by it.
const PURCHASE = seed('package_purchase', 'succeeded', {
  id: 'pur1', provider_payment_id: 555, provider_document_number: 77,
  meta: { provider: 'cardcom', payerUserId: 'u1', cardcom_document_type: 'Receipt' },
});
const okAnswer = { ResponseCode: 0, Description: 'ok', NewDocumentNumber: 78, NewDocumentType: 4 };

let db: FakeTableClient;
let errorLog: ReturnType<typeof vi.spyOn>;
function useDb(rows: TableRow[] = [PURCHASE]) {
  db = createFakeTableClient({ payment_operations: rows }, {}, { beforeInsert: trigger, uniqueIndexes: INDEXES });
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
  vi.mocked(getCardcomServerConfig).mockResolvedValue({ terminalNumber: 1001, apiName: 'kalfa-api', enabled: true });
  vi.mocked(getCardcomApiPassword).mockResolvedValue(PASSWORD);
  vi.mocked(logActivity).mockResolvedValue(undefined);
  vi.mocked(documentsCancelDoc).mockResolvedValue(okAnswer as never);
});

describe('refundCardcomPayment: a full refund', () => {
  it('writes the pending row BEFORE asking CardCom, then cancels the document and records the refund with the new document', async () => {
    let pendingWhenAsked = 0;
    vi.mocked(documentsCancelDoc).mockImplementation(async () => {
      pendingWhenAsked = refundRows().filter((r) => r.outcome === 'pending').length;
      return okAnswer as never;
    });
    const result = await refundCardcomPayment({ ...REQ, amount: 149 });
    expect(pendingWhenAsked).toBe(1);
    expect(result).toEqual({ status: 'refunded', amount: 149, document: { id: null, number: 78, url: null }, alreadyDone: false });
    expect(refundRows()).toMatchObject([{ outcome: 'succeeded', amount: 149, parent_operation_id: 'pur1', provider_document_number: 78, meta: { cancellation_request_id: 'req1', provider: 'cardcom' } }]);
  });

  it('asks CardCom to cancel THE document the payment issued — its number and its type — with the API credentials, within 30 seconds', async () => {
    await refundCardcomPayment({ ...REQ, amount: 149 });
    expect(documentsCancelDoc).toHaveBeenCalledWith(
      { ApiName: 'kalfa-api', ApiPassword: PASSWORD, DocumentNumber: 77, DocumentType: 3 },
      { cardcom: { timeoutMs: 30_000 } },
    );
  });

  it('records the audit trail, tells an admin, and never puts the password anywhere', async () => {
    await refundCardcomPayment({ ...REQ, amount: 149 });
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'e1', action: 'campaign.package_refunded' }));
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'info' }));
    expect(everythingLogged()).not.toContain(PASSWORD);
  });

  it('a retry of the same request that already refunded returns what went back, and does not ask CardCom again', async () => {
    await refundCardcomPayment({ ...REQ, amount: 149 });
    vi.mocked(documentsCancelDoc).mockClear();
    const again = await refundCardcomPayment({ ...REQ, amount: 149 });
    expect(again).toMatchObject({ status: 'refunded', amount: 149, alreadyDone: true });
    expect(documentsCancelDoc).not.toHaveBeenCalled();
    expect(refundRows()).toHaveLength(1);
  });

  it('works for a tax invoice + receipt too (its own type numbers)', async () => {
    useDb([seed('package_purchase', 'succeeded', { id: 'pur1', provider_document_number: 90, meta: { provider: 'cardcom', cardcom_document_type: 'TaxInvoiceAndReceipt' } })]);
    vi.mocked(documentsCancelDoc).mockResolvedValue({ ResponseCode: 0, NewDocumentNumber: 91, NewDocumentType: 2 } as never);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toMatchObject({ status: 'refunded' });
    expect(vi.mocked(documentsCancelDoc).mock.calls[0][0]).toMatchObject({ DocumentNumber: 90, DocumentType: 1 });
  });

  it('still refunds when the pilot switch was turned off after the payment: the money goes back through the company that was paid', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue({ terminalNumber: 1001, apiName: 'kalfa-api', enabled: false });
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toMatchObject({ status: 'refunded' });
  });
});

describe('refundCardcomPayment: refused before anything is written or sent', () => {
  const nothingHappened = () => {
    expect(refundRows()).toHaveLength(0);
    expect(documentsCancelDoc).not.toHaveBeenCalled();
  };

  it.each([
    ['payments are off', () => vi.mocked(getPaymentsEnabled).mockResolvedValue(false)],
    ['CardCom is not configured', () => vi.mocked(getCardcomServerConfig).mockResolvedValue(null)],
    ['there is no API password stored', () => vi.mocked(getCardcomApiPassword).mockResolvedValue(null)],
  ])('is "disabled" when %s', async (_label, arrange) => {
    arrange();
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'refused', reason: 'disabled' });
    nothingHappened();
  });

  it.each([0, -5, 1.005, Number.NaN])('refuses an amount that is not whole agorot above zero (%s)', async (amount) => {
    await expect(refundCardcomPayment({ ...REQ, amount })).resolves.toEqual({ status: 'refused', reason: 'invalid_amount' });
    nothingHappened();
  });

  it('refuses more than the card paid', async () => {
    await expect(refundCardcomPayment({ ...REQ, amount: 150 })).resolves.toEqual({ status: 'refused', reason: 'exceeds_refundable' });
    nothingHappened();
  });

  it('refuses a campaign with no succeeded CardCom payment', async () => {
    useDb([]);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'refused', reason: 'no_payment' });
    nothingHappened();
  });

  it('refuses a PARTIAL refund (a cancellation fee): CancelDoc cancels a document whole, and a partial one waits for plan item U9', async () => {
    await expect(refundCardcomPayment({ ...REQ, amount: 129 })).resolves.toEqual({ status: 'refused', reason: 'partial_unsupported' });
    nothingHappened();
  });

  it('refuses a second refund once part of the payment already went back, for the same reason', async () => {
    useDb([PURCHASE, seed('refund', 'succeeded', { id: 'r1', amount: 20, parent_operation_id: 'pur1', meta: { cancellation_request_id: 'other' } })]);
    await expect(refundCardcomPayment({ ...REQ, amount: 129 })).resolves.toEqual({ status: 'refused', reason: 'partial_unsupported' });
    // the seeded refund is the only one: nothing new was written, and CardCom was not asked
    expect(refundRows()).toHaveLength(1);
    expect(documentsCancelDoc).not.toHaveBeenCalled();
  });

  it.each([
    ['no document number', { provider_document_number: null }],
    ['a document type that is not stored', { meta: { provider: 'cardcom', payerUserId: 'u1' } }],
    ['a document type we cannot map to a number', { meta: { provider: 'cardcom', cardcom_document_type: 'Quote' } }],
  ])('refuses a payment with %s: nothing can be cancelled by guess', async (_label, over) => {
    useDb([{ ...PURCHASE, ...over }]);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'refused', reason: 'no_document' });
    nothingHappened();
  });

  it('says "in progress" for a refund of this request that is running, and "review" for one that needs a person — and sends nothing', async () => {
    useDb([PURCHASE, seed('refund', 'pending', { id: 'r1', amount: 149, meta: { cancellation_request_id: 'req1' } })]);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'in_progress' });
    useDb([PURCHASE, seed('refund', 'review', { id: 'r1', amount: 149, meta: { cancellation_request_id: 'req1' } })]);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'review' });
    expect(documentsCancelDoc).not.toHaveBeenCalled();
  });

  it('an unreadable ledger is an error, and nothing is sent', async () => {
    db.fail('payment_operations', '42501', 'select');
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'error' });
    expect(documentsCancelDoc).not.toHaveBeenCalled();
  });
});

describe('refundCardcomPayment: what CardCom answers', () => {
  it('a refusal (ResponseCode not 0) closes the row as failed, so it may be tried again — and CardCom\'s text stays with the ledger', async () => {
    vi.mocked(documentsCancelDoc).mockResolvedValue({ ResponseCode: 5, Description: 'document already cancelled' } as never);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'declined' });
    expect(refundRows()).toMatchObject([{ outcome: 'failed', provider_status: '5', provider_status_description: 'document already cancelled' }]);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });

  it('a request CardCom rejected outright (a 4xx) is a clear refusal too', async () => {
    vi.mocked(documentsCancelDoc).mockRejectedValue(new CardcomError('http_error', 'x', false, 401));
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'declined' });
    expect(refundRows()[0].outcome).toBe('failed');
  });

  it('a call that may have been processed (timeout, 5xx) goes to REVIEW and is never retried by this code', async () => {
    vi.mocked(documentsCancelDoc).mockRejectedValue(new CardcomError('unreachable', 'x', true));
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'review' });
    expect(refundRows()[0].outcome).toBe('review');
    expect(documentsCancelDoc).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
    // ...and a second attempt of the same request is stopped by that review row.
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'review' });
    expect(documentsCancelDoc).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no new document number', { ResponseCode: 0, NewDocumentType: 4 }],
    ['a new document that is not the refund of a receipt', { ResponseCode: 0, NewDocumentNumber: 78, NewDocumentType: 3 }],
    ['a new document of an unrelated type', { ResponseCode: 0, NewDocumentNumber: 78, NewDocumentType: 1 }],
  ])('success with %s is not believed: the row goes to review WITH what CardCom said, and an admin is told', async (_label, answer) => {
    vi.mocked(documentsCancelDoc).mockResolvedValue(answer as never);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'review' });
    expect(refundRows()[0]).toMatchObject({ outcome: 'review', provider_status: '0' });
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('a confirmed refund that cannot be recorded is parked in review with CardCom\'s references, never lost', async () => {
    let fail = true;
    vi.mocked(documentsCancelDoc).mockImplementation(async () => {
      if (fail) {
        db.fail('payment_operations', 'XX000', 'update');
        fail = false;
      }
      return okAnswer as never;
    });
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'review' });
    expect(refundRows()[0]).toMatchObject({ outcome: 'review', provider_document_number: 78 });
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('a failure of the audit row does not undo a confirmed refund', async () => {
    vi.mocked(logActivity).mockRejectedValue(new Error('activity down'));
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toMatchObject({ status: 'refunded' });
    expect(refundRows()[0].outcome).toBe('succeeded');
  });

  it('never writes the API password to any log or alert, in any outcome', async () => {
    vi.mocked(documentsCancelDoc).mockRejectedValue(new Error(`boom ${PASSWORD}`));
    await refundCardcomPayment({ ...REQ, amount: 149 });
    useDb();
    vi.mocked(documentsCancelDoc).mockResolvedValue({ ResponseCode: 9, Description: `echo ${PASSWORD}` } as never);
    await refundCardcomPayment({ ...REQ, cancellationRequestId: 'req2', amount: 149 });
    expect(everythingLogged()).not.toContain(PASSWORD);
  });
});

describe('checkCardcomRefund: the look before the promise', () => {
  it('answers null when a refund would go ahead, and writes and sends nothing', async () => {
    await expect(checkCardcomRefund({ ...REQ, amount: 149 })).resolves.toBeNull();
    expect(refundRows()).toHaveLength(0);
    expect(documentsCancelDoc).not.toHaveBeenCalled();
  });

  it('answers with the same refusal the refund would give', async () => {
    await expect(checkCardcomRefund({ ...REQ, amount: 129 })).resolves.toEqual({ status: 'refused', reason: 'partial_unsupported' });
    vi.mocked(getCardcomApiPassword).mockResolvedValue(null);
    await expect(checkCardcomRefund({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'refused', reason: 'disabled' });
  });

  it('answers with what already went back for this request, so a retry is not stopped', async () => {
    await refundCardcomPayment({ ...REQ, amount: 149 });
    await expect(checkCardcomRefund({ ...REQ, amount: 149 })).resolves.toMatchObject({ status: 'refunded', alreadyDone: true });
  });
});

describe('cardcomRefundSummary', () => {
  it('reports what is refundable, what this request already returned, and whether the payment can be refunded', async () => {
    await expect(cardcomRefundSummary('c1', 'req1')).resolves.toEqual({ refundable: 149, refundedForRequest: 0, hasCard: true });
    await refundCardcomPayment({ ...REQ, amount: 149 });
    await expect(cardcomRefundSummary('c1', 'req1')).resolves.toEqual({ refundable: 0, refundedForRequest: 149, hasCard: true });
  });

  it('says a payment with no cancellable document cannot be refunded (the screen\'s "no card" state)', async () => {
    useDb([{ ...PURCHASE, provider_document_number: null }]);
    await expect(cardcomRefundSummary('c1')).resolves.toMatchObject({ hasCard: false });
  });

  it('throws when the ledger cannot be read, so "nothing to refund" is never the face of a failed read', async () => {
    db.fail('payment_operations', '42501');
    await expect(cardcomRefundSummary('c1')).rejects.toBeTruthy();
  });
});
