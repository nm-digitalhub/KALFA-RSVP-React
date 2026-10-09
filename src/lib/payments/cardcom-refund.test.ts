import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';
import { withLedgerStamp } from '@/test/ledger-stamp-trigger';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({ getPaymentsEnabled: vi.fn() }));
vi.mock('@/lib/data/cardcom-config', () => ({ getCardcomServerConfig: vi.fn(), getCardcomApiPassword: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/cardcom/generated/transactions/transactions', () => ({ transactionsTransaction: vi.fn() }));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { CardcomError } from '@/lib/cardcom/mutator';
import type { TransactionReq } from '@/lib/cardcom/generated/models';
import { transactionsTransaction } from '@/lib/cardcom/generated/transactions/transactions';
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
//   - the API password and the card token never reach a log line or an alert.
// And CardCom's own (a Do Transaction refund, owner's choice 9.10.2026): the money goes back to the payment's TOKEN, any amount
// up to what is refundable; the credit document is the counterpart of the payment's own; our row id is the idempotency key;
// and an answer that is not a refund that created that document is not believed.

const PASSWORD = 'API-PASSWORD-SECRET-123';
const TOKEN = '4cf8e168-261e-4613-8d20-000332986b24';
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
  payment_operation_kinds: { effect: EFFECT[kind] }, occurred_at: '2026-10-01T10:00:00.000Z', recorded_at: '2026-10-01T10:00:00.000Z', meta: {},
  // Stamped the way the database stamps a CardCom row: the terminal the payment was opened on (the connection's, 1001) and its class.
  provider: 'cardcom', provider_terminal: 1001, is_test: false, ...over,
});
// The purchase: paid 149 through CardCom, a receipt issued by it, the card's token and expiry and the cardholder CardCom recorded.
const PURCHASE = seed('package_purchase', 'succeeded', {
  id: 'pur1', provider_payment_id: 555, provider_document_number: 77,
  meta: { provider: 'cardcom', payerUserId: 'u1', cardcom_document_type: 'Receipt' },
  card_token_ref: TOKEN, card_exp_month: 9, card_exp_year: 2031, card_owner_name: 'דנה כהן', card_owner_email: 'dana@example.test',
});
const DOC_URL = 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=x';
const okAnswer = (over: Record<string, unknown> = {}) => ({
  ResponseCode: 0, Description: 'העסקה בוצעה בהצלחה', TranzactionId: 777, IsRefund: true,
  DocumentNumber: 78, DocumentType: 'ReceiptRefund', DocumentUrl: DOC_URL, ...over,
});

let db: FakeTableClient;
let errorLog: ReturnType<typeof vi.spyOn>;
function useDb(rows: TableRow[] = [PURCHASE]) {
  db = createFakeTableClient({ payment_operations: rows }, {}, { beforeInsert: withLedgerStamp(trigger), uniqueIndexes: INDEXES });
  vi.mocked(createAdminClient).mockReturnValue(db.client as never);
}
const REQ = { campaignId: 'c1', eventId: 'e1', cancellationRequestId: 'req1' };
const refundRows = () => db.rows('payment_operations').filter((r) => r.kind === 'refund');
const everythingLogged = () => JSON.stringify([errorLog.mock.calls, vi.mocked(sendSlackAlert).mock.calls, vi.mocked(logActivity).mock.calls]);
const sent = (): TransactionReq => {
  const request = vi.mocked(transactionsTransaction).mock.calls[0][0];
  if (!request) throw new Error('no request was sent');
  return request;
};

beforeEach(() => {
  vi.resetAllMocks();
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  useDb();
  vi.mocked(getPaymentsEnabled).mockResolvedValue(true);
  vi.mocked(getCardcomServerConfig).mockResolvedValue({ terminalNumber: 1001, apiName: 'kalfa-api', enabled: true });
  vi.mocked(getCardcomApiPassword).mockResolvedValue(PASSWORD);
  vi.mocked(logActivity).mockResolvedValue(undefined);
  vi.mocked(transactionsTransaction).mockResolvedValue(okAnswer() as never);
});

describe('refundCardcomPayment: a refund', () => {
  it('writes the pending row BEFORE asking CardCom, then records the refund with its transaction and credit document', async () => {
    let pendingWhenAsked = 0;
    vi.mocked(transactionsTransaction).mockImplementation(async () => {
      pendingWhenAsked = refundRows().filter((r) => r.outcome === 'pending').length;
      return okAnswer() as never;
    });
    const result = await refundCardcomPayment({ ...REQ, amount: 149 });
    expect(pendingWhenAsked).toBe(1);
    expect(result).toEqual({ status: 'refunded', amount: 149, document: { id: null, number: 78, url: DOC_URL }, alreadyDone: false });
    // The credit document's type is recorded with the row's own keys (meta is replaced on completion), so the ledger's
    // generated provider_document_type column and the document report can tell it from a receipt with the same number.
    expect(refundRows()).toMatchObject([{
      outcome: 'succeeded', amount: 149, parent_operation_id: 'pur1', provider_payment_id: 777,
      provider_document_number: 78, provider_document_url: DOC_URL,
      meta: { cancellation_request_id: 'req1', provider: 'cardcom', cardcom_document_type: 'ReceiptRefund' },
    }]);
  });

  it('sends a Do Transaction REFUND to the payment\'s token, with the password, the credit document and our row id as the idempotency key', async () => {
    await refundCardcomPayment({ ...REQ, amount: 149 });
    const rowId = refundRows()[0].id;
    expect(transactionsTransaction).toHaveBeenCalledWith(
      {
        TerminalNumber: 1001, ApiName: 'kalfa-api', Amount: 149, Token: TOKEN, CardExpirationMMYY: '0931',
        ExternalUniqTranId: rowId, ExternalUniqUniqTranIdResponse: true, NumOfPayments: 1, ISOCoinId: 1,
        Advanced: { IsRefund: true, ApiPassword: PASSWORD },
        Document: {
          DocumentTypeToCreate: 'ReceiptRefund', Name: 'דנה כהן', Email: 'dana@example.test', Languge: 'he',
          Products: [{ Description: 'KALFA — זיכוי ביטול חבילת אישורי הגעה לאירוע', Quantity: 1, UnitCost: 149 }],
        },
      },
      { cardcom: { timeoutMs: 30_000 } },
    );
  });

  it('a PARTIAL refund (a cancellation fee stays with us) goes back as its own amount, with a credit document for it', async () => {
    vi.mocked(transactionsTransaction).mockResolvedValue(okAnswer() as never);
    await expect(refundCardcomPayment({ ...REQ, amount: 129 })).resolves.toMatchObject({ status: 'refunded', amount: 129 });
    expect(sent()).toMatchObject({ Amount: 129, Document: { Products: [{ UnitCost: 129 }] } });
    expect(refundRows()).toMatchObject([{ outcome: 'succeeded', amount: 129 }]);
  });

  it('a second partial refund is possible up to what is left', async () => {
    useDb([PURCHASE, seed('refund', 'succeeded', { id: 'r1', amount: 20, parent_operation_id: 'pur1', meta: { cancellation_request_id: 'other' } })]);
    // 149 paid, 20 already back: 100 more goes back, then only 29 is left.
    await expect(refundCardcomPayment({ ...REQ, amount: 100 })).resolves.toMatchObject({ status: 'refunded', amount: 100 });
    await expect(refundCardcomPayment({ ...REQ, cancellationRequestId: 'req2', amount: 30 })).resolves.toEqual({ status: 'refused', reason: 'exceeds_refundable' });
  });

  it('records the audit trail, tells an admin, and never puts the password or the token anywhere', async () => {
    await refundCardcomPayment({ ...REQ, amount: 149 });
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'e1', action: 'campaign.package_refunded' }));
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'info' }));
    expect(everythingLogged()).not.toContain(PASSWORD);
    expect(everythingLogged()).not.toContain(TOKEN);
  });

  it('a retry of the same request that already refunded returns what went back, and does not ask CardCom again', async () => {
    await refundCardcomPayment({ ...REQ, amount: 149 });
    vi.mocked(transactionsTransaction).mockClear();
    const again = await refundCardcomPayment({ ...REQ, amount: 149 });
    expect(again).toMatchObject({ status: 'refunded', amount: 149, alreadyDone: true });
    expect(transactionsTransaction).not.toHaveBeenCalled();
    expect(refundRows()).toHaveLength(1);
  });

  it('a tax invoice + receipt is credited by its own counterpart', async () => {
    useDb([{ ...PURCHASE, meta: { provider: 'cardcom', cardcom_document_type: 'TaxInvoiceAndReceipt' } }]);
    vi.mocked(transactionsTransaction).mockResolvedValue(okAnswer({ DocumentType: 'TaxInvoiceAndReceiptRefund' }) as never);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toMatchObject({ status: 'refunded' });
    expect(sent().Document).toMatchObject({ DocumentTypeToCreate: 'TaxInvoiceAndReceiptRefund' });
  });

  it('a cardholder with no email gets a credit document with no email field', async () => {
    useDb([{ ...PURCHASE, card_owner_email: null }]);
    await refundCardcomPayment({ ...REQ, amount: 149 });
    expect(sent().Document).not.toHaveProperty('Email');
  });

  it('refunds a TEST payment on the test terminal like any other: the refund row is test money too (the database copies it from the parent), and every alert says so', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue({ terminalNumber: 1000, apiName: 'kalfa-api', enabled: true });
    useDb([{ ...PURCHASE, provider_terminal: 1000, is_test: true }]);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toMatchObject({ status: 'refunded', amount: 149 });
    expect(refundRows()).toMatchObject([{ outcome: 'succeeded', provider: 'cardcom', provider_terminal: 1000, is_test: true }]);
    expect(vi.mocked(sendSlackAlert).mock.calls.map(([a]) => a.title)).toEqual([expect.stringMatching(/^\[בדיקה\] /)]);
    expect(logActivity).toHaveBeenCalledWith(expect.objectContaining({ meta: expect.objectContaining({ testMoney: true }) }));
  });

  it('the refund of REAL money is a real row, with no test mark anywhere', async () => {
    await refundCardcomPayment({ ...REQ, amount: 149 });
    expect(refundRows()).toMatchObject([{ provider: 'cardcom', provider_terminal: 1001, is_test: false }]);
    expect(vi.mocked(sendSlackAlert).mock.calls.map(([a]) => a.title).join()).not.toContain('[בדיקה]');
    expect(vi.mocked(logActivity).mock.calls[0][0].meta).not.toHaveProperty('testMoney');
  });

  it('still refunds when the pilot switch was turned off after the payment: the money goes back through the company that was paid', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue({ terminalNumber: 1001, apiName: 'kalfa-api', enabled: false });
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toMatchObject({ status: 'refunded' });
  });
});

describe('refundCardcomPayment: refused before anything is written or sent', () => {
  const nothingHappened = () => {
    expect(refundRows()).toHaveLength(0);
    expect(transactionsTransaction).not.toHaveBeenCalled();
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

  it('refuses a payment made on ANOTHER terminal than the connection uses now: its token belongs to that terminal', async () => {
    useDb([{ ...PURCHASE, provider_terminal: 1000, is_test: true }]);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'refused', reason: 'terminal_changed' });
    nothingHappened();
  });

  it('refuses a payment with NO recorded terminal (a row from before the stamp existed): it cannot be vouched for', async () => {
    useDb([{ ...PURCHASE, provider: 'sumit', provider_terminal: null }]);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'refused', reason: 'terminal_changed' });
    nothingHappened();
  });

  it('still reports the older, plainer refusals first: no payment, and more than was paid', async () => {
    useDb([{ ...PURCHASE, provider_terminal: 1000, is_test: true }]);
    await expect(refundCardcomPayment({ ...REQ, amount: 150 })).resolves.toEqual({ status: 'refused', reason: 'exceeds_refundable' });
    useDb([]);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'refused', reason: 'no_payment' });
  });

  it.each([
    ['no token', { card_token_ref: null }],
    ['a token that is not CardCom\'s guid', { card_token_ref: 'tok-abc' }],
    ['no expiry month', { card_exp_month: null }],
    ['an impossible expiry month', { card_exp_month: 13 }],
    ['no expiry year', { card_exp_year: null }],
    ['no cardholder name', { card_owner_name: null }],
    ['a blank cardholder name', { card_owner_name: '  ' }],
  ])('refuses a payment with %s: there is no card to send the money back to', async (_label, over) => {
    useDb([{ ...PURCHASE, ...over }]);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'refused', reason: 'no_card' });
    nothingHappened();
  });

  it.each([
    ['a document type that is not stored', { meta: { provider: 'cardcom', payerUserId: 'u1' } }],
    ['a document type with no credit counterpart we can name', { meta: { provider: 'cardcom', cardcom_document_type: 'SiteCustomerOrder' } }],
  ])('refuses a payment with %s: no tax document is issued by guess', async (_label, over) => {
    useDb([{ ...PURCHASE, ...over }]);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'refused', reason: 'no_document' });
    nothingHappened();
  });

  it('says "in progress" for a refund of this request that is running, and "review" for one that needs a person — and sends nothing', async () => {
    useDb([PURCHASE, seed('refund', 'pending', { id: 'r1', amount: 149, meta: { cancellation_request_id: 'req1' } })]);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'in_progress' });
    useDb([PURCHASE, seed('refund', 'review', { id: 'r1', amount: 149, meta: { cancellation_request_id: 'req1' } })]);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'review' });
    expect(transactionsTransaction).not.toHaveBeenCalled();
  });

  it('an unreadable ledger is an error, and nothing is sent', async () => {
    db.fail('payment_operations', '42501', 'select');
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'error' });
    expect(transactionsTransaction).not.toHaveBeenCalled();
  });
});

describe('refundCardcomPayment: what CardCom answers', () => {
  it('a refusal (ResponseCode not 0) closes the row as failed, so it may be tried again — and CardCom\'s text stays with the ledger', async () => {
    vi.mocked(transactionsTransaction).mockResolvedValue({ ResponseCode: 5, Description: 'card blocked' } as never);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'declined' });
    expect(refundRows()).toMatchObject([{ outcome: 'failed', provider_status: '5', provider_status_description: 'card blocked' }]);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });

  it('a request CardCom rejected outright (a 4xx) is a clear refusal too', async () => {
    vi.mocked(transactionsTransaction).mockRejectedValue(new CardcomError('http_error', 'x', false, 401));
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'declined' });
    expect(refundRows()[0].outcome).toBe('failed');
  });

  // 9.10.2026: two refusals were recorded with no reason. The reason CardCom gives (its ErrorInfo body) is kept in the row and
  // the staff alert; the log gets the numbers only.
  it('a 4xx keeps WHY: the HTTP status in the note, CardCom\'s code and text in the row and the alert, numbers only in the log', async () => {
    vi.mocked(transactionsTransaction).mockRejectedValue(
      new CardcomError('http_error', 'x', false, 400, { ResponseCode: 7, Description: 'ApiPassword is not valid' }),
    );
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'declined' });
    expect(refundRows()[0]).toMatchObject({
      outcome: 'failed', provider_status: '7', provider_status_description: 'ApiPassword is not valid',
      note: expect.stringContaining('(HTTP 400)'),
    });
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn', fields: expect.objectContaining({ http_status: 400, response_code: 7, description: 'ApiPassword is not valid' }),
    }));
    expect(errorLog).toHaveBeenCalledWith('[cardcom-refund] refused', expect.objectContaining({ httpStatus: 400, responseCode: 7 }));
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('ApiPassword is not valid');
  });

  it('a 4xx with no reason in it keeps the status and claims no CardCom code', async () => {
    vi.mocked(transactionsTransaction).mockRejectedValue(new CardcomError('http_error', 'x', false, 403));
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'declined' });
    expect(refundRows()[0]).toMatchObject({ outcome: 'failed', note: expect.stringContaining('(HTTP 403)') });
    expect(refundRows()[0].provider_status ?? null).toBeNull();
  });

  it('a 5xx goes to REVIEW and keeps what it carried, too', async () => {
    vi.mocked(transactionsTransaction).mockRejectedValue(new CardcomError('http_error', 'x', true, 502, { ResponseCode: 99, Description: 'gateway' }));
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'review' });
    expect(refundRows()[0]).toMatchObject({
      outcome: 'review', provider_status: '99', provider_status_description: 'gateway', note: expect.stringContaining('(HTTP 502)'),
    });
  });

  it('a call that may have been processed (timeout, 5xx) goes to REVIEW and is never retried by this code', async () => {
    vi.mocked(transactionsTransaction).mockRejectedValue(new CardcomError('unreachable', 'x', true));
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'review' });
    expect(refundRows()[0].outcome).toBe('review');
    expect(transactionsTransaction).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
    // ...and a second attempt of the same request is stopped by that review row.
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'review' });
    expect(transactionsTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no document number', okAnswer({ DocumentNumber: null })],
    ['an answer that is not a refund', okAnswer({ IsRefund: false })],
    ['a document that is not the credit of a receipt', okAnswer({ DocumentType: 'Receipt' })],
    ['a document of an unrelated type', okAnswer({ DocumentType: 'TaxInvoiceAndReceiptRefund' })],
  ])('success with %s is not believed: the row goes to review WITH what CardCom said, and an admin is told', async (_label, answer) => {
    vi.mocked(transactionsTransaction).mockResolvedValue(answer as never);
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'review' });
    expect(refundRows()[0]).toMatchObject({ outcome: 'review', provider_status: '0', meta: { cancellation_request_id: 'req1', provider: 'cardcom' } });
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('a confirmed refund that cannot be recorded is parked in review with CardCom\'s references, never lost', async () => {
    let fail = true;
    vi.mocked(transactionsTransaction).mockImplementation(async () => {
      if (fail) {
        db.fail('payment_operations', 'XX000', 'update');
        fail = false;
      }
      return okAnswer() as never;
    });
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'review' });
    expect(refundRows()[0]).toMatchObject({ outcome: 'review', provider_document_number: 78, provider_payment_id: 777 });
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('a failure of the audit row does not undo a confirmed refund', async () => {
    vi.mocked(logActivity).mockRejectedValue(new Error('activity down'));
    await expect(refundCardcomPayment({ ...REQ, amount: 149 })).resolves.toMatchObject({ status: 'refunded' });
    expect(refundRows()[0].outcome).toBe('succeeded');
  });

  it('never writes the API password or the token to any log or alert, in any outcome', async () => {
    vi.mocked(transactionsTransaction).mockRejectedValue(new Error(`boom ${PASSWORD} ${TOKEN}`));
    await refundCardcomPayment({ ...REQ, amount: 149 });
    useDb();
    vi.mocked(transactionsTransaction).mockResolvedValue({ ResponseCode: 9, Description: `echo ${PASSWORD}` } as never);
    await refundCardcomPayment({ ...REQ, cancellationRequestId: 'req2', amount: 149 });
    expect(everythingLogged()).not.toContain(PASSWORD);
    expect(everythingLogged()).not.toContain(TOKEN);
  });
});

describe('checkCardcomRefund: the look before the promise', () => {
  it('answers null when a refund would go ahead — a full one or a partial one — and writes and sends nothing', async () => {
    await expect(checkCardcomRefund({ ...REQ, amount: 149 })).resolves.toBeNull();
    await expect(checkCardcomRefund({ ...REQ, amount: 129 })).resolves.toBeNull();
    expect(refundRows()).toHaveLength(0);
    expect(transactionsTransaction).not.toHaveBeenCalled();
  });

  it('answers with the same refusal the refund would give', async () => {
    useDb([{ ...PURCHASE, card_token_ref: null }]);
    await expect(checkCardcomRefund({ ...REQ, amount: 149 })).resolves.toEqual({ status: 'refused', reason: 'no_card' });
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
    await expect(cardcomRefundSummary('c1', 'req1')).resolves.toEqual({ refundable: 149, refundedForRequest: 0, hasCard: true, refundDocument: null });
    await refundCardcomPayment({ ...REQ, amount: 149 });
    await expect(cardcomRefundSummary('c1', 'req1')).resolves.toEqual({
      refundable: 0, refundedForRequest: 149, hasCard: true, refundDocument: { id: null, number: 78, url: DOC_URL },
    });
  });

  it.each([
    ['no token', { card_token_ref: null }],
    ['a document type with no credit counterpart', { meta: { provider: 'cardcom', cardcom_document_type: 'SiteCustomerOrder' } }],
  ])('says a payment with %s cannot be refunded by itself (the screen\'s "no card" state)', async (_label, over) => {
    useDb([{ ...PURCHASE, ...over }]);
    await expect(cardcomRefundSummary('c1')).resolves.toMatchObject({ hasCard: false });
  });

  it('says a payment the connection cannot refund (another terminal, none recorded, or no connection) is a payment with "no card": the screen never promises a refund the server will refuse', async () => {
    useDb([{ ...PURCHASE, provider_terminal: 1000, is_test: true }]);
    await expect(cardcomRefundSummary('c1')).resolves.toMatchObject({ refundable: 149, hasCard: false });
    useDb([{ ...PURCHASE, provider: 'sumit', provider_terminal: null }]);
    await expect(cardcomRefundSummary('c1')).resolves.toMatchObject({ hasCard: false });
    useDb();
    vi.mocked(getCardcomServerConfig).mockResolvedValue(null);
    await expect(cardcomRefundSummary('c1')).resolves.toMatchObject({ hasCard: false });
  });

  it('throws when the ledger cannot be read, so "nothing to refund" is never the face of a failed read', async () => {
    db.fail('payment_operations', '42501');
    await expect(cardcomRefundSummary('c1')).rejects.toBeTruthy();
  });
});
