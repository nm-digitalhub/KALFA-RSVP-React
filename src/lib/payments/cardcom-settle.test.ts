import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/data/tax-ceiling', () => ({ checkOsekPaturCeilingAfterCharge: vi.fn() }));
vi.mock('@/lib/data/cardcom-config', () => ({ getCardcomServerConfig: vi.fn() }));
vi.mock('@/lib/cardcom/generated/low-profile/low-profile', () => ({ lowProfileGetLpResult: vi.fn() }));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { CardcomError } from '@/lib/cardcom/mutator';
import { lowProfileGetLpResult } from '@/lib/cardcom/generated/low-profile/low-profile';
import { getCardcomServerConfig } from '@/lib/data/cardcom-config';
import { checkOsekPaturCeilingAfterCharge } from '@/lib/data/tax-ceiling';
import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';

let fake: FakeTableClient;
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }));

import { settleCardcomSession } from './cardcom-settle';

// settleCardcomSession is the ONE thing that closes a CardCom payment: the webhook, the buyer's own "I submitted" call
// and the sweeper all end here. CardCom's GetLpResult is the only authority — nothing the browser or the webhook body
// says marks money as received. The ledger row moves from pending exactly once (compare-and-set), so any number of
// callers, in any order, produce one outcome.

const LP = 'lp-1';
const op = (over: TableRow = {}): TableRow => ({
  id: 'op1', campaign_id: 'c1', event_id: 'e1', kind: 'package_purchase', outcome: 'pending', amount: 149,
  meta: { provider: 'cardcom', payerUserId: 'u1' }, recorded_at: '2026-10-07T10:00:00.000Z', ...over,
});
const session = (over: TableRow = {}): TableRow => ({ low_profile_id: LP, operation_id: 'op1', created_at: '2026-10-07T10:00:00.000Z', ...over });
const PAID = {
  ResponseCode: 0, Description: 'The transaction was successful', Operation: 'ChargeOnly', TranzactionId: 555,
  DocumentInfo: { ResponseCode: 0, DocumentNumber: 77, DocumentType: 'Receipt' },
  TranzactionInfo: { ApprovalNumber: '0123456' },
};
// The extra fields CardCom returned on the first real run (terminal 1000, 7.10.2026): the card's facts, a reusable card token
// (which must never be stored) and a working document link under TranzactionInfo while DocumentInfo's came back null.
const DOC_LINK = 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=abc';
const PAID_WITH_CARD = {
  ...PAID,
  TranzactionInfo: {
    ApprovalNumber: '0123456', Last4CardDigitsString: '0008', CardMonth: 12, CardYear: 30, Brand: 'Visa', Issuer: 'CAL',
    Token: 'tok-secret', FirstCardDigits: 458028, DocumentUrl: DOC_LINK,
  },
};
const DECLINED = { ResponseCode: 5033, Description: 'declined by issuer', Operation: 'ChargeOnly' };

const answer = (value: unknown) => vi.mocked(lowProfileGetLpResult).mockResolvedValue(value as never);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCardcomServerConfig).mockResolvedValue({ terminalNumber: 1001, apiName: 'kalfa-api', enabled: true });
  fake = createFakeTableClient({ payment_operations: [op()], cardcom_payment_sessions: [session()], activity_log: [] });
  answer(PAID);
});

const ledger = () => fake.rows('payment_operations')[0];

describe('settleCardcomSession: a paid session', () => {
  it('asks CardCom (the only authority) with the terminal, API name and LowProfileId, within 5 seconds', async () => {
    await settleCardcomSession(LP);
    expect(lowProfileGetLpResult).toHaveBeenCalledWith(
      { TerminalNumber: 1001, ApiName: 'kalfa-api', LowProfileId: LP },
      { cardcom: { timeoutMs: 5_000 } },
    );
  });

  it('closes the ledger row as succeeded with CardCom\'s references, and keeps the document type for a later refund', async () => {
    await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
    expect(ledger()).toMatchObject({
      outcome: 'succeeded',
      provider_payment_id: 555,
      provider_auth_ref: '0123456',
      provider_status: '0',
      provider_document_number: 77,
      meta: { provider: 'cardcom', payerUserId: 'u1', cardcom_document_type: 'Receipt' },
    });
    // This answer carries no card facts and no link: nothing is invented for them.
    expect(ledger().provider_document_url ?? null).toBeNull();
    expect(ledger().card_last4 ?? null).toBeNull();
  });

  it('keeps what the card looks like and the link to the document, so an admin screen can show them', async () => {
    answer(PAID_WITH_CARD);
    await settleCardcomSession(LP);
    expect(ledger()).toMatchObject({
      outcome: 'succeeded',
      card_last4: '0008', card_exp_month: 12, card_exp_year: 2030, card_brand: 'Visa', card_issuer: 'CAL',
      provider_document_number: 77, provider_document_url: DOC_LINK,
    });
  });

  it('records a confirmed payment even when the card facts or the link are unusable: those fields stay empty, the payment is still recorded', async () => {
    answer({ ...PAID, TranzactionInfo: { ApprovalNumber: '0123456', Last4CardDigitsString: 'x', CardMonth: 99, CardYear: 99999, Brand: { n: 1 }, Issuer: 7, DocumentUrl: 'http://evil.example/doc' } });
    await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
    expect(ledger()).toMatchObject({ outcome: 'succeeded', provider_payment_id: 555, provider_document_number: 77 });
    for (const column of ['card_last4', 'card_exp_month', 'card_exp_year', 'card_brand', 'card_issuer', 'provider_document_url']) expect(ledger()[column] ?? null).toBeNull();
  });

  it('records the purchase in the activity log (no session here, so a direct insert) and re-checks the tax ceiling', async () => {
    await settleCardcomSession(LP);
    expect(fake.rows('activity_log')).toMatchObject([{ event_id: 'e1', user_id: null, action: 'campaign.package_purchased' }]);
    expect(checkOsekPaturCeilingAfterCharge).toHaveBeenCalledTimes(1);
  });

  it('does not ask CardCom again once the row is closed, whoever calls (webhook, buyer, sweeper)', async () => {
    await settleCardcomSession(LP);
    vi.mocked(lowProfileGetLpResult).mockClear();
    await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: true });
    expect(lowProfileGetLpResult).not.toHaveBeenCalled();
    expect(fake.rows('activity_log')).toHaveLength(1);
  });

  it('answers a lost race with what the winner wrote, not with an error', async () => {
    // Between our read and our update another caller closed the row.
    vi.mocked(lowProfileGetLpResult).mockImplementation(async () => {
      fake.rows('payment_operations')[0].outcome = 'succeeded';
      return PAID as never;
    });
    await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: true });
    expect(fake.rows('activity_log')).toHaveLength(0);
  });
});

describe('settleCardcomSession: what CardCom says about the card is mapped onto the payment row', () => {
  const FULL = {
    ...PAID_WITH_CARD,
    UIValues: { CardOwnerIdentityNumber: '123456782 ' },
    TranzactionInfo: { ...PAID_WITH_CARD.TranzactionInfo, CardOwnerIdentityNumber: '123456782', CreateDate: '2026-10-07T23:36:52' },
  };
  const vaultCalls: unknown[][] = [];
  const settleWithVault = async (handler: () => unknown = () => ({ data: 'vault-secret-1', error: null })) => {
    vaultCalls.length = 0;
    fake = createFakeTableClient(
      { payment_operations: [op()], cardcom_payment_sessions: [session()], activity_log: [] },
      { payment_citizen_id_write: ((args: unknown) => { vaultCalls.push([args]); return handler(); }) as never },
    );
    return settleCardcomSession(LP);
  };

  it('keeps the token in the token column, the holder ID as a Vault secret (only its id on the row), and CardCom\'s own time as the time of the payment', async () => {
    answer(FULL);
    await expect(settleWithVault()).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
    expect(ledger()).toMatchObject({
      outcome: 'succeeded', card_token_ref: 'tok-secret', citizen_id_secret: 'vault-secret-1', occurred_at: '2026-10-07T20:36:52.000Z',
    });
    expect(vaultCalls).toEqual([[{ p_citizen_id: '123456782', p_campaign_id: 'c1' }]]);
    // The ID itself is nowhere on the row.
    expect(JSON.stringify(ledger())).not.toContain('123456782');
  });

  it('does not write what it does not map (first digits, card product name): no mask, no payment-method type', async () => {
    answer(FULL);
    await settleWithVault();
    expect(ledger().card_mask ?? null).toBeNull();
    expect(ledger().payment_method_type ?? null).toBeNull();
  });

  it('a payment is recorded even when the Vault cannot keep the holder ID: that column stays empty, and the log names no ID', async () => {
    answer(FULL);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(settleWithVault(() => ({ data: null, error: { message: 'vault down' } }))).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
    expect(ledger()).toMatchObject({ outcome: 'succeeded', provider_payment_id: 555, card_token_ref: 'tok-secret' });
    expect(ledger().citizen_id_secret ?? null).toBeNull();
    expect(JSON.stringify(logged.mock.calls)).not.toMatch(/123456782|tok-secret/);
    logged.mockRestore();
  });

  it('maps the rest of CardCom\'s answer — cardholder, card class, payment type, its own references — onto the row\'s columns', async () => {
    answer({
      ...FULL,
      UIValues: { CardOwnerIdentityNumber: '123456782 ', CardOwnerName: 'Dana Cohen', CardOwnerEmail: 'dana@example.com', CardOwnerPhone: '0501234567' },
      TranzactionInfo: {
        ...FULL.TranzactionInfo, CardName: 'ויזה זהב', CardInfo: 'Israeli', FirstCardDigits: 458028, IsAbroadCard: false, NumberOfPayments: 1,
        CouponNumber: '74002281', Uid: '21121517002429612920744', Rrn: '', Acquire: 'Laumicard', PaymentType: 'Standard',
        CardNumberEntryMode: 'Phone', DealType: 'Debit', AccountId: 0, IssuerAuthCodeDescription: 'approved',
      },
    });
    await settleWithVault();
    expect(ledger()).toMatchObject({
      outcome: 'succeeded',
      card_owner_name: 'Dana Cohen', card_owner_email: 'dana@example.com', card_owner_phone: '0501234567',
      card_name: 'ויזה זהב', card_info: 'Israeli', card_first_digits: '458028', card_is_abroad: false, number_of_payments: 1,
      provider_coupon_number: '74002281', provider_unique_id: '21121517002429612920744', provider_acquirer: 'Laumicard',
      provider_payment_type: 'Standard', provider_entry_mode: 'Phone', provider_deal_type: 'Debit', provider_auth_description: 'approved',
    });
    // An empty RRN and "no customer card" (0) are not values: those columns stay empty.
    expect(ledger().provider_rrn ?? null).toBeNull();
    expect(ledger().provider_account_id ?? null).toBeNull();
  });

  it('a payment is recorded even when CardCom\'s extra fields are unusable: they stay empty, the payment does not', async () => {
    answer({ ...PAID, TranzactionInfo: { ApprovalNumber: '0123456', CardOwnerName: 7, NumberOfPayments: -3, FirstCardDigits: 'x', Uid: { a: 1 }, AccountId: 2 ** 40 } });
    await expect(settleWithVault()).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
    expect(ledger()).toMatchObject({ outcome: 'succeeded', provider_payment_id: 555, provider_document_number: 77 });
    for (const column of ['card_owner_name', 'number_of_payments', 'card_first_digits', 'provider_unique_id', 'provider_account_id']) expect(ledger()[column] ?? null).toBeNull();
  });

  it('writes no Vault secret for an answer that carries no holder ID', async () => {
    answer(PAID);
    await settleWithVault();
    expect(vaultCalls).toHaveLength(0);
    expect(ledger()).toMatchObject({ outcome: 'succeeded' });
  });

  it('a decline writes no card column and no Vault secret: nothing was charged', async () => {
    answer({ ...DECLINED, UIValues: { CardOwnerIdentityNumber: '123456782' } });
    await settleWithVault();
    expect(vaultCalls).toHaveLength(0);
    expect(ledger().card_token_ref ?? null).toBeNull();
  });
});

describe('settleCardcomSession: a payment that did not happen', () => {
  it('a decline closes the row as failed, so the buyer may try again; CardCom\'s text stays with the admin', async () => {
    answer(DECLINED);
    await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'failed', alreadyDone: false });
    expect(ledger()).toMatchObject({ outcome: 'failed', provider_status: '5033', provider_status_description: 'declined by issuer' });
  });

  it('with finalizeUnpaid off (the sweeper, a retry) a non-zero answer leaves the row pending: it may just not be paid YET', async () => {
    answer(DECLINED);
    await expect(settleCardcomSession(LP, { finalizeUnpaid: false })).resolves.toEqual({ status: 'unpaid' });
    expect(ledger().outcome).toBe('pending');
  });
});

describe('settleCardcomSession: money that arrives after the row was closed as failed', () => {
  // A row is closed as failed when CardCom says "no payment" after a submit. If a payment then lands on the same session
  // (a forged early webhook, a slow bank), the ledger must not be rewritten — it is append-only — but a person must hear.
  const closedFailed = () => {
    fake = createFakeTableClient({ payment_operations: [op({ outcome: 'failed' })], cardcom_payment_sessions: [session()], activity_log: [] });
  };

  it('raises an error alert when CardCom says the session WAS paid, and leaves the ledger as it is', async () => {
    closedFailed();
    await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'failed', alreadyDone: true });
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', fields: expect.objectContaining({ operation_id: 'op1' }) }));
    expect(ledger().outcome).toBe('failed');
  });

  it('says nothing when CardCom agrees it was not paid', async () => {
    closedFailed();
    answer(DECLINED);
    await settleCardcomSession(LP);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('says nothing, and does not throw, when CardCom cannot be asked', async () => {
    closedFailed();
    vi.mocked(lowProfileGetLpResult).mockRejectedValue(new CardcomError('unreachable', 'x', true));
    await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'failed', alreadyDone: true });
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('does not ask CardCom about a row that succeeded or is in review', async () => {
    fake = createFakeTableClient({ payment_operations: [op({ outcome: 'review' })], cardcom_payment_sessions: [session()] });
    await settleCardcomSession(LP);
    expect(lowProfileGetLpResult).not.toHaveBeenCalled();
  });
});

describe('settleCardcomSession: when it cannot tell', () => {
  it('an unknown LowProfileId is "not found", and CardCom is not asked', async () => {
    await expect(settleCardcomSession('lp-other')).resolves.toEqual({ status: 'not_found' });
    expect(lowProfileGetLpResult).not.toHaveBeenCalled();
  });

  it('retries a failed call once, and settles on the second answer', async () => {
    vi.mocked(lowProfileGetLpResult).mockRejectedValueOnce(new CardcomError('unreachable', 'x', true)).mockResolvedValueOnce(PAID as never);
    await expect(settleCardcomSession(LP)).resolves.toMatchObject({ status: 'settled', outcome: 'succeeded' });
    expect(lowProfileGetLpResult).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry and leaves the row exactly as it was', async () => {
    vi.mocked(lowProfileGetLpResult).mockRejectedValue(new CardcomError('unreachable', 'x', true));
    await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'error' });
    expect(lowProfileGetLpResult).toHaveBeenCalledTimes(2);
    expect(ledger().outcome).toBe('pending');
  });

  it('an answer it cannot read is an error, never a success or a failure', async () => {
    answer({ Description: 'no code' });
    await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'error' });
    expect(ledger().outcome).toBe('pending');
  });

  it('is an error, without calling CardCom, when the connection is not configured', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue(null);
    await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'error' });
    expect(lowProfileGetLpResult).not.toHaveBeenCalled();
  });

  it.each([
    ['a success for another kind of operation', { ...PAID, Operation: 'CreateTokenOnly' }],
    ['a success with no transaction id', { ...PAID, TranzactionId: null }],
  ])('%s goes to review, never to "paid"', async (_label, odd) => {
    answer(odd);
    await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'review', alreadyDone: false });
    expect(ledger().outcome).toBe('review');
    expect(sendSlackAlert).toHaveBeenCalled();
  });

  it('a confirmed payment that cannot be recorded as succeeded is parked in review with CardCom\'s references, and an alert goes out', async () => {
    fake.fail('payment_operations', 'XX000', 'update');
    await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'review', alreadyDone: false });
    expect(ledger()).toMatchObject({ outcome: 'review', provider_payment_id: 555, provider_document_number: 77 });
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
});

// THE TERMINAL. A row is born stamped with the terminal its session was opened on (`provider_terminal`) and the database gives it its
// class (`is_test`) from that; settle keeps CardCom's own report of the terminal and compares the two. The table (plan section 2):
//   no stamp                       -> as before, whatever CardCom reports
//   test terminal, same report     -> succeeded (test money)        test terminal, no report / another -> review
//   real terminal, same or no report -> succeeded (real money)       real terminal, another report      -> review
// and a session is asked about only on the terminal it was opened on.
describe('settleCardcomSession: the terminal of the payment', () => {
  const stamped = (terminal: number | null, over: TableRow = {}) => {
    fake = createFakeTableClient({
      // A row with no terminal is one from BEFORE the stamp existed: provider 'sumit' (the default) with the CardCom marker in its meta -
      // the database cannot hold provider 'cardcom' without a terminal (payment_operations_provider_stamp_coherent).
      payment_operations: [op({ provider: terminal === null ? 'sumit' : 'cardcom', provider_terminal: terminal, is_test: terminal === 1000, ...over })],
      cardcom_payment_sessions: [session()],
      activity_log: [],
    });
  };
  const connectedTo = (terminalNumber: number) => vi.mocked(getCardcomServerConfig).mockResolvedValue({ terminalNumber, apiName: 'kalfa-api', enabled: true });
  const paidReporting = (terminal: unknown) => answer({ ...PAID, TerminalNumber: terminal });
  const alertsSent = () => vi.mocked(sendSlackAlert).mock.calls.map(([a]) => a);

  describe('on a real terminal (1001)', () => {
    beforeEach(() => stamped(1001));

    it('a payment that reports the terminal it was opened on is recorded as succeeded, and the report is kept', async () => {
      paidReporting(1001);
      await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
      expect(ledger()).toMatchObject({ outcome: 'succeeded', provider_terminal: 1001, provider_terminal_echo: 1001 });
      expect(checkOsekPaturCeilingAfterCharge).toHaveBeenCalledTimes(1);
      expect(fake.rows('activity_log')[0].meta).not.toHaveProperty('testMoney');
    });

    it('a payment that reports no terminal is believed, as before; nothing is written to the report column', async () => {
      await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
      expect(ledger().provider_terminal_echo ?? null).toBeNull();
      expect(fake.ops.filter((o) => o.op === 'update')[0].patch).not.toHaveProperty('provider_terminal_echo');
    });

    it.each([['a string', '1001'], ['zero', 0], ['a negative number', -1001], ['an object', { n: 1001 }], ['a number the 32-bit column cannot hold', 5_000_000_000]])(
      'a report that is %s counts as not reported: the answer is still readable and the payment is recorded',
      async (_label, odd) => {
        paidReporting(odd);
        await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
        expect(ledger().provider_terminal_echo ?? null).toBeNull();
      },
    );

    it('a payment that reports ANOTHER terminal (even the test one) is not counted: it goes to review with everything a person needs, and an error alert names both terminals', async () => {
      paidReporting(1000);
      await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'review', alreadyDone: false });
      expect(ledger()).toMatchObject({
        outcome: 'review', provider_terminal_echo: 1000, provider_payment_id: 555, provider_auth_ref: '0123456', provider_document_number: 77,
        meta: { provider: 'cardcom', cardcom_document_type: 'Receipt' },
      });
      expect(String(ledger().note)).toContain('1000');
      expect(String(ledger().note)).toContain('1001');
      expect(alertsSent()).toEqual([expect.objectContaining({ level: 'error', fields: expect.objectContaining({ operation_id: 'op1', terminal_opened_on: 1001, terminal_reported: 1000 }) })]);
      expect(fake.rows('activity_log')).toHaveLength(0);
      expect(checkOsekPaturCeilingAfterCharge).not.toHaveBeenCalled();
    });
  });

  describe('on the test terminal (1000)', () => {
    beforeEach(() => {
      stamped(1000);
      connectedTo(1000);
    });

    it('a payment that reports the test terminal is recorded as succeeded: test money, so no tax-ceiling check, and the activity row says so', async () => {
      paidReporting(1000);
      await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
      expect(ledger()).toMatchObject({ outcome: 'succeeded', provider_terminal: 1000, provider_terminal_echo: 1000, is_test: true });
      expect(checkOsekPaturCeilingAfterCharge).not.toHaveBeenCalled();
      expect(fake.rows('activity_log')).toMatchObject([{ action: 'campaign.package_purchased', meta: { testMoney: true } }]);
    });

    it('says in the alert what really happened: a report that is missing is not worded as a report that differs', async () => {
      await settleCardcomSession(LP);
      expect(alertsSent()[0]?.title).toContain('לא דיווח');
      expect(alertsSent()[0]?.title).not.toContain('המסוף שדווח');
      vi.clearAllMocks();
      stamped(1000);
      connectedTo(1000);
      paidReporting(1001);
      await settleCardcomSession(LP);
      expect(alertsSent()[0]?.title).toContain('המסוף שדווח אינו המסוף שבו נפתח');
    });

    it('a payment that reports no terminal must prove where it went: review, with an error alert marked as a test', async () => {
      await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'review', alreadyDone: false });
      expect(ledger()).toMatchObject({ outcome: 'review', provider_payment_id: 555, provider_document_number: 77 });
      expect(ledger().provider_terminal_echo ?? null).toBeNull();
      expect(String(ledger().note)).toContain('did not report');
      expect(alertsSent()).toEqual([expect.objectContaining({ level: 'error', title: expect.stringMatching(/^\[בדיקה\] /) })]);
      expect(fake.rows('activity_log')).toHaveLength(0);
    });

    it('a payment that reports another terminal goes to review too, with that report kept', async () => {
      paidReporting(1001);
      await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'review', alreadyDone: false });
      expect(ledger()).toMatchObject({ outcome: 'review', provider_terminal_echo: 1001 });
    });

    it('a decline is information, not a warning, and is marked as a test', async () => {
      answer(DECLINED);
      await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'failed', alreadyDone: false });
      expect(alertsSent()).toEqual([expect.objectContaining({ level: 'info', title: expect.stringMatching(/^\[בדיקה\] /) })]);
    });
  });

  it('a decline on a real terminal is still a warning, with no test mark', async () => {
    stamped(1001);
    answer(DECLINED);
    await settleCardcomSession(LP);
    expect(alertsSent()).toEqual([expect.objectContaining({ level: 'warn', title: expect.not.stringMatching(/^\[בדיקה\]/) })]);
  });

  describe('a row with no stamp (written before the stamp existed)', () => {
    it('is believed whatever CardCom reports, and the report is kept when it came', async () => {
      stamped(null);
      paidReporting(1000);
      await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
      expect(ledger()).toMatchObject({ outcome: 'succeeded', provider_terminal_echo: 1000 });
    });

    it('is real money even while the connection points at the test terminal: the class comes from the ROW, never from the connection', async () => {
      stamped(null);
      connectedTo(1000);
      paidReporting(1000);
      await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
      expect(checkOsekPaturCeilingAfterCharge).toHaveBeenCalledTimes(1);
      expect(fake.rows('activity_log')[0].meta).not.toHaveProperty('testMoney');
    });

    it('is asked about on whatever terminal the connection uses, as before', async () => {
      stamped(null);
      connectedTo(1234);
      await settleCardcomSession(LP);
      expect(lowProfileGetLpResult).toHaveBeenCalledWith({ TerminalNumber: 1234, ApiName: 'kalfa-api', LowProfileId: LP }, expect.anything());
    });
  });

  describe('what CardCom reports is kept on every close', () => {
    beforeEach(() => stamped(1001));

    it('a decline that carries the terminal keeps it', async () => {
      answer({ ...DECLINED, TerminalNumber: 1001 });
      await settleCardcomSession(LP);
      expect(ledger()).toMatchObject({ outcome: 'failed', provider_terminal_echo: 1001 });
    });

    it('a success that is not a charge (so it goes to review) keeps it', async () => {
      answer({ ...PAID, Operation: 'CreateTokenOnly', TerminalNumber: 1001 });
      await settleCardcomSession(LP);
      expect(ledger()).toMatchObject({ outcome: 'review', provider_terminal_echo: 1001 });
    });

    it('a confirmed payment that cannot be recorded as succeeded is parked in review with it', async () => {
      paidReporting(1001);
      fake.fail('payment_operations', 'XX000', 'update');
      await settleCardcomSession(LP);
      expect(ledger()).toMatchObject({ outcome: 'review', provider_payment_id: 555, provider_terminal_echo: 1001 });
    });
  });

  describe('a session is asked about only on the terminal it was opened on', () => {
    it('a pending row opened on another terminal than the connection uses is NOT asked about, is NOT closed as failed, and goes to a person', async () => {
      stamped(1000);
      await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'review', alreadyDone: false });
      expect(lowProfileGetLpResult).not.toHaveBeenCalled();
      expect(ledger().outcome).toBe('review');
      expect(String(ledger().note)).toContain('1000');
      expect(String(ledger().note)).toContain('1001');
      expect(alertsSent()).toEqual([
        expect.objectContaining({ level: 'error', title: expect.stringMatching(/^\[בדיקה\] /), fields: expect.objectContaining({ terminal_opened_on: 1000, terminal_now: 1001 }) }),
      ]);
    });

    it('also for a caller that would only leave an unpaid row alone (the sweeper): the row cannot be judged at all', async () => {
      stamped(1001);
      connectedTo(1000);
      await expect(settleCardcomSession(LP, { finalizeUnpaid: false })).resolves.toEqual({ status: 'settled', outcome: 'review', alreadyDone: false });
      expect(lowProfileGetLpResult).not.toHaveBeenCalled();
    });

    it('a row already closed as failed on another terminal is not asked about either: a person hears, the ledger is untouched', async () => {
      stamped(1000, { outcome: 'failed' });
      await expect(settleCardcomSession(LP)).resolves.toEqual({ status: 'settled', outcome: 'failed', alreadyDone: true });
      expect(lowProfileGetLpResult).not.toHaveBeenCalled();
      expect(ledger().outcome).toBe('failed');
      expect(alertsSent()).toEqual([expect.objectContaining({ level: 'error', fields: expect.objectContaining({ terminal_opened_on: 1000, terminal_now: 1001 }) })]);
    });

    it('a row already closed as failed on the same terminal is asked about, and a payment found is marked as a test when the row is one', async () => {
      stamped(1000, { outcome: 'failed' });
      connectedTo(1000);
      await settleCardcomSession(LP);
      expect(lowProfileGetLpResult).toHaveBeenCalledTimes(1);
      expect(alertsSent()).toEqual([expect.objectContaining({ level: 'error', title: expect.stringMatching(/^\[בדיקה\] /) })]);
    });
  });
});

