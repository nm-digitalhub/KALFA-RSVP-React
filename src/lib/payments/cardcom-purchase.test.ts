import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/data/payments', () => ({ getPaymentsEnabled: vi.fn(), getPackageModelEnabled: vi.fn() }));
vi.mock('@/lib/data/cardcom-config', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/data/cardcom-config')>()), getCardcomServerConfig: vi.fn() }));
vi.mock('@/lib/data/billing', () => ({ getCampaignCreditTotal: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn(async (path: string) => `https://beta.kalfa.me${path}`) }));
vi.mock('@/lib/cardcom/generated/low-profile/low-profile', () => ({ lowProfileCreate: vi.fn() }));
vi.mock('./package-paid', () => ({ getPackagePaymentState: vi.fn() }));
vi.mock('./cardcom-settle', () => ({ settleCardcomSession: vi.fn(), CARDCOM_ABANDON_AFTER_MINUTES: 60 }));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { CardcomError } from '@/lib/cardcom/mutator';
import { lowProfileCreate } from '@/lib/cardcom/generated/low-profile/low-profile';
import { getCampaignCreditTotal } from '@/lib/data/billing';
import { getCardcomServerConfig } from '@/lib/data/cardcom-config';
import { getPackageModelEnabled, getPaymentsEnabled } from '@/lib/data/payments';
import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';
import { withLedgerStamp } from '@/test/ledger-stamp-trigger';

let fake: FakeTableClient;
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }));

import { settleCardcomSession } from './cardcom-settle';
import { startCardcomPurchase, type CardcomStartInput } from './cardcom-purchase';
import { getPackagePaymentState } from './package-paid';

// Opens a CardCom Open Fields session for a package purchase. The order is the safety argument (same as the SUMIT
// purchase): gates fail closed, the price is the campaign's own, the PENDING ledger row is written BEFORE CardCom is
// asked for anything, and a failure to OPEN a session closes that row as failed — safe, because without a LowProfileId
// the buyer cannot pay, so nothing could have been charged.

const NOW = new Date('2026-10-07T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const input = (over: Partial<CardcomStartInput> = {}): CardcomStartInput => ({
  campaign: { id: 'c1', event_id: 'e1', status: 'approved', package_price: 149, capture_status: null, charge_status: null },
  payer: { userId: 'u1', email: 'dana@example.com', name: 'דנה כהן' },
  mayUseTestTerminal: false,
  ...over,
});

const ONCE = new Set(['package_purchase']);
const ledgerOptions = {
  // The database's trigger: the once_slot snapshot, and the stamp (is_test from the terminal, a child from its parent).
  beforeInsert: withLedgerStamp((_t: string, row: TableRow) => ({ ...row, once_slot: ONCE.has(String(row.kind)) })),
  uniqueIndexes: [
    { table: 'payment_operations', columns: ['campaign_id', 'kind'], where: { once_slot: true, outcome: ['pending', 'review', 'succeeded'] } },
    { table: 'payment_operations', columns: ['campaign_id', 'kind'], where: { outcome: 'pending' } },
  ],
};
const lineRows = () => fake.rows('payment_operation_lines');
const ops = () => fake.rows('payment_operations');

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(getPaymentsEnabled).mockResolvedValue(true);
  vi.mocked(getPackageModelEnabled).mockResolvedValue(true);
  vi.mocked(getCardcomServerConfig).mockResolvedValue({ terminalNumber: 1001, apiName: 'kalfa-api', enabled: true });
  vi.mocked(getCampaignCreditTotal).mockResolvedValue(0);
  vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'none' } as never);
  vi.mocked(lowProfileCreate).mockResolvedValue({ ResponseCode: 0, Description: 'ok', LowProfileId: 'lp-new', Url: 'https://secure.cardcom.solutions/EA/LPC6/1001/x' } as never);
  fake = createFakeTableClient({ payment_operations: [], payment_operation_lines: [], cardcom_payment_sessions: [] }, {}, ledgerOptions);
});

describe('startCardcomPurchase: gates (all fail closed)', () => {
  it.each([
    ['payments are off', () => vi.mocked(getPaymentsEnabled).mockResolvedValue(false)],
    ['the package model is off', () => vi.mocked(getPackageModelEnabled).mockResolvedValue(false)],
    ['CardCom is not configured', () => vi.mocked(getCardcomServerConfig).mockResolvedValue(null)],
    ['the pilot switch is off', () => vi.mocked(getCardcomServerConfig).mockResolvedValue({ terminalNumber: 1001, apiName: 'x', enabled: false })],
    ['it is the test terminal and the buyer is not an admin', () => vi.mocked(getCardcomServerConfig).mockResolvedValue({ terminalNumber: 1000, apiName: 'x', enabled: true })],
  ])('refuses when %s, and touches nothing', async (_label, arrange) => {
    arrange();
    await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'disabled' });
    expect(ops()).toHaveLength(0);
    expect(lowProfileCreate).not.toHaveBeenCalled();
  });

  it('lets a platform admin buy on the test terminal', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue({ terminalNumber: 1000, apiName: 'x', enabled: true });
    await expect(startCardcomPurchase(input({ mayUseTestTerminal: true }))).resolves.toMatchObject({ status: 'ready' });
  });

  it.each([
    ['no price (a pay-per-result campaign)', { package_price: null }],
    ['a zero price', { package_price: 0 }],
    ['a campaign that is not approved', { status: 'draft' }],
    ['a campaign that already carries an old-style hold', { capture_status: 'authorized' }],
    ['a campaign that already carries a final-charge state', { charge_status: 'charged' }],
  ])('refuses %s as not purchasable', async (_label, over) => {
    const base = input();
    await expect(startCardcomPurchase({ ...base, campaign: { ...base.campaign, ...over } as never })).resolves.toEqual({ status: 'not_purchasable' });
    expect(ops()).toHaveLength(0);
  });

  it('refuses a customer with unspent credit rather than overcharge them', async () => {
    vi.mocked(getCampaignCreditTotal).mockResolvedValue(30);
    await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'credit_unsupported' });
    expect(ops()).toHaveLength(0);
  });

  it('is an error, and nothing is written, when the ledger cannot be read', async () => {
    vi.mocked(getPackagePaymentState).mockRejectedValue(new Error('boom'));
    await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'error' });
    expect(lowProfileCreate).not.toHaveBeenCalled();
  });
});

describe('startCardcomPurchase: what the ledger already says', () => {
  it.each([
    ['collected', 'already_paid'],
    ['review', 'review'],
    ['refunded', 'not_purchasable'],
  ])('a %s payment answers %s without opening anything', async (state, expected) => {
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: state } as never);
    await expect(startCardcomPurchase(input())).resolves.toEqual({ status: expected });
    expect(lowProfileCreate).not.toHaveBeenCalled();
  });

  it('a pending SUMIT charge is "in progress"; CardCom is not asked', async () => {
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'pending' } as never);
    fake = createFakeTableClient({ payment_operations: [{ id: 'op0', campaign_id: 'c1', kind: 'package_purchase', outcome: 'pending', recorded_at: minutesAgo(1), meta: { payerUserId: 'u0' } }], payment_operation_lines: [], cardcom_payment_sessions: [] }, {}, ledgerOptions);
    await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'in_progress' });
    expect(settleCardcomSession).not.toHaveBeenCalled();
  });

  describe('a pending CardCom session (the buyer is still on the form, or left)', () => {
    const pending = (age: number) => {
      vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'pending' } as never);
      fake = createFakeTableClient(
        {
          payment_operations: [{ id: 'op0', campaign_id: 'c1', event_id: 'e1', kind: 'package_purchase', outcome: 'pending', once_slot: true, recorded_at: minutesAgo(age), meta: { provider: 'cardcom', payerUserId: 'u1' } }],
          payment_operation_lines: [],
          cardcom_payment_sessions: [{ low_profile_id: 'lp-old', operation_id: 'op0' }],
        },
        {},
        ledgerOptions,
      );
    };

    it('that CardCom says is paid is "already paid"', async () => {
      pending(5);
      vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
      await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'already_paid' });
    });

    it('that is not paid YET and young is RESUMED: the same session id comes back, and nothing new is written or opened', async () => {
      pending(5);
      vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'unpaid' });
      await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'ready', lowProfileId: 'lp-old' });
      expect(settleCardcomSession).toHaveBeenCalledWith('lp-old', { finalizeUnpaid: false });
      expect(lowProfileCreate).not.toHaveBeenCalled();
      expect(ops()).toHaveLength(1);
    });

    it('that is old and unpaid is closed as failed, and a fresh session opens', async () => {
      pending(90);
      vi.mocked(settleCardcomSession).mockImplementation(async () => {
        ops()[0].outcome = 'failed';
        return { status: 'settled', outcome: 'failed', alreadyDone: false };
      });
      await expect(startCardcomPurchase(input())).resolves.toMatchObject({ status: 'ready', lowProfileId: 'lp-new' });
      expect(settleCardcomSession).toHaveBeenCalledWith('lp-old', { finalizeUnpaid: true });
    });

    it('whose answer cannot be had is "in progress": it is never overwritten on a guess', async () => {
      pending(90);
      vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'error' });
      await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'in_progress' });
      expect(lowProfileCreate).not.toHaveBeenCalled();
    });
  });
});

describe('startCardcomPurchase: opening the session', () => {
  it('writes the pending row (with its lines) BEFORE asking CardCom, then records the session and hands back the id only', async () => {
    let rowsWhenCardcomWasAsked = 0;
    vi.mocked(lowProfileCreate).mockImplementation(async () => {
      rowsWhenCardcomWasAsked = ops().length;
      return { ResponseCode: 0, LowProfileId: 'lp-new', Url: 'https://x' } as never;
    });
    const out = await startCardcomPurchase(input());
    expect(out).toEqual({ status: 'ready', lowProfileId: 'lp-new' });
    expect(JSON.stringify(out)).not.toContain('https://');
    expect(rowsWhenCardcomWasAsked).toBe(1);
    expect(ops()).toMatchObject([{ kind: 'package_purchase', outcome: 'pending', amount: 149, campaign_id: 'c1', meta: { provider: 'cardcom', payerUserId: 'u1' } }]);
    expect(lineRows()).toMatchObject([{ description: expect.stringContaining('KALFA'), unit_price: 149 }]);
    expect(fake.rows('cardcom_payment_sessions')).toMatchObject([{ low_profile_id: 'lp-new', operation_id: ops()[0].id }]);
  });

  it('asks CardCom for the campaign\'s own price, with the operation as the reference and the app\'s URLs', async () => {
    await startCardcomPurchase(input());
    const sent = vi.mocked(lowProfileCreate).mock.calls[0][0];
    expect(sent).toMatchObject({
      TerminalNumber: 1001,
      ApiName: 'kalfa-api',
      Operation: 'ChargeOnly',
      Amount: 149,
      ReturnValue: ops()[0].id,
      WebHookUrl: 'https://beta.kalfa.me/api/cardcom/webhook',
      SuccessRedirectUrl: 'https://beta.kalfa.me/app/events/e1/campaign/c1/payment',
    });
    expect(vi.mocked(lowProfileCreate).mock.calls[0][1]).toEqual({ cardcom: { timeoutMs: 10_000 } });
  });

  it('stamps the pending row with the provider and the terminal the session is asked to open on - the very terminal in the Create request', async () => {
    await startCardcomPurchase(input());
    const sent = vi.mocked(lowProfileCreate).mock.calls[0][0];
    expect(ops()).toMatchObject([{ provider: 'cardcom', provider_terminal: 1001, is_test: false }]);
    expect(sent).toMatchObject({ TerminalNumber: ops()[0].provider_terminal });
  });

  it('on the test terminal the row is born as test money, and the request names the same terminal', async () => {
    vi.mocked(getCardcomServerConfig).mockResolvedValue({ terminalNumber: 1000, apiName: 'kalfa-api', enabled: true });
    await expect(startCardcomPurchase(input({ mayUseTestTerminal: true }))).resolves.toMatchObject({ status: 'ready' });
    expect(ops()).toMatchObject([{ provider: 'cardcom', provider_terminal: 1000, is_test: true }]);
    expect(vi.mocked(lowProfileCreate).mock.calls[0][0]).toMatchObject({ TerminalNumber: 1000 });
  });

  it('the stamp is on the row even when the session never opens: the failed row still says where it was meant to go', async () => {
    vi.mocked(lowProfileCreate).mockResolvedValue({ ResponseCode: 5, Description: 'terminal not allowed' } as never);
    await startCardcomPurchase(input());
    expect(ops()).toMatchObject([{ outcome: 'failed', provider: 'cardcom', provider_terminal: 1001 }]);
  });

  it('a second click (or a reload) while the first session is still open gets the SAME session back, never a second row', async () => {
    await startCardcomPurchase(input());
    vi.mocked(getPackagePaymentState).mockResolvedValue({ status: 'pending' } as never);
    vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'unpaid' });
    await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'ready', lowProfileId: 'lp-new' });
    expect(ops()).toHaveLength(1);
    expect(lowProfileCreate).toHaveBeenCalledTimes(1);
  });

  it('CardCom refusing to open the session closes the row as failed, tells an admin, and says "error" to the buyer', async () => {
    vi.mocked(lowProfileCreate).mockResolvedValue({ ResponseCode: 5, Description: 'terminal not allowed' } as never);
    await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'error' });
    expect(ops()).toMatchObject([{ outcome: 'failed', provider_status: '5', provider_status_description: 'terminal not allowed' }]);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
    expect(fake.rows('cardcom_payment_sessions')).toHaveLength(0);
  });

  it('a call that failed to reach CardCom closes the row as failed too: with no id handed out, nothing can be paid', async () => {
    vi.mocked(lowProfileCreate).mockRejectedValue(new CardcomError('unreachable', 'x', true));
    await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'error' });
    expect(ops()).toMatchObject([{ outcome: 'failed', note: expect.stringContaining('could not reach CardCom') }]);
  });

  // A 4xx is CardCom answering "no" — not "could not reach". Until the connection is fixed every purchase fails the same
  // way, so the reason is kept and staff hear of it.
  it('a request CardCom refused (a 4xx) is recorded as refused, with its reason, and staff are alerted', async () => {
    vi.mocked(lowProfileCreate).mockRejectedValue(new CardcomError('http_error', 'x', false, 401, { ResponseCode: 7, Description: 'Invalid username' }));
    await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'error' });
    expect(ops()).toMatchObject([{
      outcome: 'failed', note: expect.stringContaining('CardCom refused the request to open a payment session (HTTP 401)'),
      provider_status: '7', provider_status_description: 'Invalid username',
    }]);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error', fields: expect.objectContaining({ http_status: 401, response_code: 7, description: 'Invalid username' }),
    }));
    expect(fake.rows('cardcom_payment_sessions')).toHaveLength(0);
  });

  it('an answer with no LowProfileId is an error, and the row is closed as failed', async () => {
    vi.mocked(lowProfileCreate).mockResolvedValue({ ResponseCode: 0 } as never);
    await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'error' });
    expect(ops()).toMatchObject([{ outcome: 'failed' }]);
  });

  it('a session that cannot be recorded closes the row as failed and the buyer is not given the id', async () => {
    fake.fail('cardcom_payment_sessions', 'XX000', 'insert');
    await expect(startCardcomPurchase(input())).resolves.toEqual({ status: 'error' });
    expect(ops()).toMatchObject([{ outcome: 'failed' }]);
  });

  it('after a failed attempt the buyer can try again with a new session', async () => {
    vi.mocked(lowProfileCreate).mockResolvedValueOnce({ ResponseCode: 5, Description: 'x' } as never);
    await startCardcomPurchase(input());
    await expect(startCardcomPurchase(input())).resolves.toMatchObject({ status: 'ready' });
    expect(ops().map((o) => o.outcome)).toEqual(['failed', 'pending']);
  });
});
