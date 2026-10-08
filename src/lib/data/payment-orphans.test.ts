import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/payments/cardcom-settle', () => ({ settleCardcomSession: vi.fn(), CARDCOM_ABANDON_AFTER_MINUTES: 60 }));
// The real completeOperation by default; a single test makes it lose the race or hit a database error.
vi.mock('@/lib/payments/ledger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/payments/ledger')>();
  return { ...actual, completeOperation: vi.fn(actual.completeOperation) };
});

import { sendSlackAlert } from '@/lib/alerts/slack';
import { settleCardcomSession } from '@/lib/payments/cardcom-settle';
import { beginOperation, completeOperation, OperationStateError } from '@/lib/payments/ledger';
import { createFakeTableClient, type TableRow } from '@/test/fake-table-client';

import { runPaymentOrphanSweep } from './payment-orphans';

// A payment operation is PENDING from just before the provider is called until just after it answers. A pending row
// that is old means the process died in between: SUMIT may or may not have charged. The sweep must (1) never auto-retry,
// (2) hand the row to a person (review), and (3) keep the "pay once" lock closed while it waits.

const NOW = new Date('2026-10-05T12:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

// The database facts the ledger relies on, as the double must reproduce them.
const ONCE_KINDS = new Set(['authorize', 'charge', 'package_purchase']);
const trigger = { beforeInsert: (_table: string, row: TableRow) => ({ ...row, once_slot: ONCE_KINDS.has(String(row.kind)) }) };
const INDEXES = [
  { columns: ['campaign_id', 'kind'], where: { once_slot: true, outcome: ['pending', 'review', 'succeeded'] } },
  { columns: ['campaign_id', 'kind'], where: { outcome: 'pending' } },
];

const op = (over: TableRow): TableRow => ({
  id: 'op-1',
  campaign_id: 'c1',
  event_id: 'e1',
  kind: 'package_purchase',
  outcome: 'pending',
  once_slot: true,
  recorded_at: ago(11),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runPaymentOrphanSweep', () => {
  it('a pending row older than 10 minutes becomes review, with an audit row and an alert that carry ids and no amounts', async () => {
    const db = createFakeTableClient({ payment_operations: [op({ amount: 120 })], activity_log: [] });

    const result = await runPaymentOrphanSweep(db.client as never, NOW);

    expect(result).toEqual({ found: 1, swept: 1, skipped: 0, failed: 0 });
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'review' });
    expect(String(db.rows('payment_operations')[0].note)).toContain('orphaned');
    expect(db.rows('activity_log')).toEqual([
      expect.objectContaining({
        event_id: 'e1',
        user_id: null,
        action: 'payment.operation_orphaned',
        meta: { operationId: 'op-1', campaignId: 'c1', kind: 'package_purchase' },
      }),
    ]);
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
    expect(alert).toMatchObject({ level: 'error', category: 'campaign_billing', source: 'payment-orphans' });
    expect(JSON.stringify(alert)).toContain('op-1');
    expect(JSON.stringify(alert)).not.toContain('120');
  });

  it('a pending row that is still young is left alone — the process that owns it may still be running', async () => {
    const db = createFakeTableClient({ payment_operations: [op({ recorded_at: ago(2) })], activity_log: [] });

    const result = await runPaymentOrphanSweep(db.client as never, NOW);

    expect(result).toEqual({ found: 0, swept: 0, skipped: 0, failed: 0 });
    expect(db.rows('payment_operations')[0].outcome).toBe('pending');
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('review, succeeded and failed rows are never touched, however old', async () => {
    const db = createFakeTableClient({
      payment_operations: [
        op({ id: 'r', outcome: 'review', recorded_at: ago(500) }),
        op({ id: 's', outcome: 'succeeded', recorded_at: ago(500) }),
        op({ id: 'f', outcome: 'failed', recorded_at: ago(500) }),
      ],
      activity_log: [],
    });

    const result = await runPaymentOrphanSweep(db.client as never, NOW);

    expect(result.found).toBe(0);
    expect(db.rows('payment_operations').map((r) => r.outcome)).toEqual(['review', 'succeeded', 'failed']);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('after the sweep the "pay once" lock is STILL closed: a new purchase cannot start until a person decides', async () => {
    const db = createFakeTableClient({ payment_operations: [op({})], activity_log: [] }, {}, { ...trigger, uniqueIndexes: INDEXES });

    await runPaymentOrphanSweep(db.client as never, NOW);

    expect(db.rows('payment_operations')[0].outcome).toBe('review');
    expect(await beginOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', kind: 'package_purchase', amount: 120 })).toEqual({ alreadyInProgress: true });
  });

  it('losing the race to the original process is a skip, not an error and not an alert', async () => {
    const db = createFakeTableClient({ payment_operations: [op({})], activity_log: [] });
    vi.mocked(completeOperation).mockRejectedValueOnce(new OperationStateError());

    const result = await runPaymentOrphanSweep(db.client as never, NOW);

    expect(result).toEqual({ found: 1, swept: 0, skipped: 1, failed: 0 });
    expect(db.rows('activity_log')).toHaveLength(0);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a real database error is counted as failed, the remaining rows are still swept, and the alert says so', async () => {
    const db = createFakeTableClient({ payment_operations: [op({ id: 'a' }), op({ id: 'b', campaign_id: 'c2' })], activity_log: [] });
    vi.mocked(completeOperation).mockRejectedValueOnce(new Error('עדכון פעולת התשלום נכשל'));

    const result = await runPaymentOrphanSweep(db.client as never, NOW);

    expect(result).toEqual({ found: 2, swept: 1, skipped: 0, failed: 1 });
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSlackAlert).mock.calls[0][0].fields).toMatchObject({ swept: 1, failed: 1 });
  });

  it('a failure to READ the candidates is thrown, so the job is retried and visible — not reported as "nothing to do"', async () => {
    const db = createFakeTableClient({ payment_operations: [], activity_log: [] });
    db.fail('payment_operations', '57014', 'select');

    await expect(runPaymentOrphanSweep(db.client as never, NOW)).rejects.toThrow();
  });
});

// A CardCom purchase is pending while the BUYER fills in the form: that is not a dead process, and ten minutes is nothing.
describe('runPaymentOrphanSweep: CardCom purchases', () => {
  const cardcomOp = (over: TableRow = {}): TableRow => op({ meta: { provider: 'cardcom', payerUserId: 'u1' }, ...over });
  const withSession = (rows: TableRow[]) => createFakeTableClient({ payment_operations: rows, cardcom_payment_sessions: [{ low_profile_id: 'lp-1', operation_id: 'op-1' }], activity_log: [] });

  it('asks CardCom instead of moving the row to review, and sends no "orphaned" alert of its own', async () => {
    const db = withSession([cardcomOp()]);
    vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'unpaid' });
    const result = await runPaymentOrphanSweep(db.client as never, NOW);
    expect(settleCardcomSession).toHaveBeenCalledWith('lp-1', { finalizeUnpaid: false });
    expect(db.rows('payment_operations')[0].outcome).toBe('pending');
    expect(db.rows('activity_log')).toHaveLength(0);
    expect(sendSlackAlert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ found: 1, swept: 0, failed: 0 });
  });

  it('lets CardCom close a session that is older than the abandon age, because then "unpaid" means walked away', async () => {
    const db = withSession([cardcomOp({ recorded_at: ago(61) })]);
    vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'settled', outcome: 'failed', alreadyDone: false });
    await runPaymentOrphanSweep(db.client as never, NOW);
    expect(settleCardcomSession).toHaveBeenCalledWith('lp-1', { finalizeUnpaid: true });
  });

  it('settles a payment that was made and never reported, whatever its age', async () => {
    const db = withSession([cardcomOp({ recorded_at: ago(30) })]);
    vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
    await runPaymentOrphanSweep(db.client as never, NOW);
    expect(settleCardcomSession).toHaveBeenCalledTimes(1);
  });

  it('closes a purchase that has no session as failed: the buyer was never given an id, so nothing can have been paid', async () => {
    const db = createFakeTableClient({ payment_operations: [cardcomOp()], cardcom_payment_sessions: [], activity_log: [] });
    await runPaymentOrphanSweep(db.client as never, NOW);
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'failed' });
    expect(settleCardcomSession).not.toHaveBeenCalled();
  });

  it('leaves the row alone when CardCom cannot be asked, to be tried again at the next run', async () => {
    const db = withSession([cardcomOp({ recorded_at: ago(90) })]);
    vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'error' });
    await runPaymentOrphanSweep(db.client as never, NOW);
    expect(db.rows('payment_operations')[0].outcome).toBe('pending');
  });

  it('still moves a SUMIT purchase (no provider in its meta) to review, as before', async () => {
    const db = createFakeTableClient({ payment_operations: [op({ meta: { payerUserId: 'u1' } })], activity_log: [] });
    await runPaymentOrphanSweep(db.client as never, NOW);
    expect(db.rows('payment_operations')[0].outcome).toBe('review');
    expect(settleCardcomSession).not.toHaveBeenCalled();
  });
});
