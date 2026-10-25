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
import { withLedgerStamp } from '@/test/ledger-stamp-trigger';

import { PACKAGE_ACTIVATION_RETRY, packageActivationJobId, QUEUES } from '@/lib/queue/queues';

import { type ActivationJobs, runPaymentOrphanSweep } from './payment-orphans';

// A payment operation is PENDING from just before the provider is called until just after it answers. A pending row
// that is old means the process died in between: SUMIT may or may not have charged. The sweep must (1) never auto-retry,
// (2) hand the row to a person (review), and (3) keep the "pay once" lock closed while it waits.

const NOW = new Date('2026-10-05T12:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

// The database facts the ledger relies on, as the double must reproduce them.
const ONCE_KINDS = new Set(['authorize', 'charge', 'package_purchase']);
const trigger = { beforeInsert: withLedgerStamp((_table: string, row: TableRow) => ({ ...row, once_slot: ONCE_KINDS.has(String(row.kind)) })) };
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

// The first pass's tests have no approved campaign, so the second pass finds nothing and never calls pg-boss.
const NO_JOBS = {
  getJobById: vi.fn(async () => null),
  send: vi.fn(async () => null),
  retry: vi.fn(async () => ({ jobs: [], requested: 0, affected: 0 })),
} as unknown as ActivationJobs;
const NO_ACTIVATIONS = { found: 0, queued: 0, retried: 0, failed: 0 };

describe('runPaymentOrphanSweep', () => {
  it('a pending row older than 10 minutes becomes review, with an audit row and an alert that carry ids and no amounts', async () => {
    const db = createFakeTableClient({ payment_operations: [op({ amount: 120 })], activity_log: [] });

    const result = await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);

    expect(result).toEqual({ found: 1, swept: 1, skipped: 0, failed: 0, activations: NO_ACTIVATIONS });
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

    const result = await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);

    expect(result).toEqual({ found: 0, swept: 0, skipped: 0, failed: 0, activations: NO_ACTIVATIONS });
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

    const result = await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);

    expect(result.found).toBe(0);
    expect(db.rows('payment_operations').map((r) => r.outcome)).toEqual(['review', 'succeeded', 'failed']);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('after the sweep the "pay once" lock is STILL closed: a new purchase cannot start until a person decides', async () => {
    const db = createFakeTableClient({ payment_operations: [op({})], activity_log: [] }, {}, { ...trigger, uniqueIndexes: INDEXES });

    await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);

    expect(db.rows('payment_operations')[0].outcome).toBe('review');
    expect(await beginOperation(db.client as never, { campaignId: 'c1', eventId: 'e1', provider: 'sumit', kind: 'package_purchase', amount: 120 })).toEqual({ alreadyInProgress: true });
  });

  it('losing the race to the original process is a skip, not an error and not an alert', async () => {
    const db = createFakeTableClient({ payment_operations: [op({})], activity_log: [] });
    vi.mocked(completeOperation).mockRejectedValueOnce(new OperationStateError());

    const result = await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);

    expect(result).toEqual({ found: 1, swept: 0, skipped: 1, failed: 0, activations: NO_ACTIVATIONS });
    expect(db.rows('activity_log')).toHaveLength(0);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a real database error is counted as failed, the remaining rows are still swept, and the alert says so', async () => {
    const db = createFakeTableClient({ payment_operations: [op({ id: 'a' }), op({ id: 'b', campaign_id: 'c2' })], activity_log: [] });
    vi.mocked(completeOperation).mockRejectedValueOnce(new Error('עדכון פעולת התשלום נכשל'));

    const result = await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);

    expect(result).toEqual({ found: 2, swept: 1, skipped: 0, failed: 1, activations: NO_ACTIVATIONS });
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSlackAlert).mock.calls[0][0].fields).toMatchObject({ swept: 1, failed: 1 });
  });

  it('a failure to READ the candidates is thrown, so the job is retried and visible — not reported as "nothing to do"', async () => {
    const db = createFakeTableClient({ payment_operations: [], activity_log: [] });
    db.fail('payment_operations', '57014', 'select');

    await expect(runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW)).rejects.toThrow();
  });
});

// A CardCom purchase is pending while the BUYER fills in the form: that is not a dead process, and ten minutes is nothing.
describe('runPaymentOrphanSweep: CardCom purchases', () => {
  const cardcomOp = (over: TableRow = {}): TableRow => op({ meta: { provider: 'cardcom', payerUserId: 'u1' }, ...over });
  const withSession = (rows: TableRow[]) => createFakeTableClient({ payment_operations: rows, cardcom_payment_sessions: [{ low_profile_id: 'lp-1', operation_id: 'op-1' }], activity_log: [] });

  it('asks CardCom instead of moving the row to review, and sends no "orphaned" alert of its own', async () => {
    const db = withSession([cardcomOp()]);
    vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'unpaid' });
    const result = await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);
    expect(settleCardcomSession).toHaveBeenCalledWith('lp-1', { finalizeUnpaid: false });
    expect(db.rows('payment_operations')[0].outcome).toBe('pending');
    expect(db.rows('activity_log')).toHaveLength(0);
    expect(sendSlackAlert).not.toHaveBeenCalled();
    expect(result).toMatchObject({ found: 1, swept: 0, failed: 0 });
  });

  it('lets CardCom close a session that is older than the abandon age, because then "unpaid" means walked away', async () => {
    const db = withSession([cardcomOp({ recorded_at: ago(61) })]);
    vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'settled', outcome: 'failed', alreadyDone: false });
    await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);
    expect(settleCardcomSession).toHaveBeenCalledWith('lp-1', { finalizeUnpaid: true });
  });

  it('settles a payment that was made and never reported, whatever its age', async () => {
    const db = withSession([cardcomOp({ recorded_at: ago(30) })]);
    vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
    await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);
    expect(settleCardcomSession).toHaveBeenCalledTimes(1);
  });

  it('closes a purchase that has no session as failed: the buyer was never given an id, so nothing can have been paid', async () => {
    const db = createFakeTableClient({ payment_operations: [cardcomOp()], cardcom_payment_sessions: [], activity_log: [] });
    await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);
    expect(db.rows('payment_operations')[0]).toMatchObject({ outcome: 'failed' });
    expect(settleCardcomSession).not.toHaveBeenCalled();
  });

  it('leaves the row alone when CardCom cannot be asked, to be tried again at the next run', async () => {
    const db = withSession([cardcomOp({ recorded_at: ago(90) })]);
    vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'error' });
    await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);
    expect(db.rows('payment_operations')[0].outcome).toBe('pending');
  });

  it('moves a pending CardCom REFUND to review — never to failed: the money may already be back', async () => {
    const db = createFakeTableClient({
      payment_operations: [op({ kind: 'refund', meta: { provider: 'cardcom', cancellation_request_id: 'r1' } })],
      cardcom_payment_sessions: [],
      activity_log: [],
    });
    await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);
    expect(db.rows('payment_operations')[0].outcome).toBe('review');
    expect(settleCardcomSession).not.toHaveBeenCalled();
  });

  it('still moves a SUMIT purchase (no provider in its meta) to review, as before', async () => {
    const db = createFakeTableClient({ payment_operations: [op({ meta: { payerUserId: 'u1' } })], activity_log: [] });
    await runPaymentOrphanSweep(db.client as never, NO_JOBS, NOW);
    expect(db.rows('payment_operations')[0].outcome).toBe('review');
    expect(settleCardcomSession).not.toHaveBeenCalled();
  });
});

// SECOND PASS (D23): a paid campaign whose service is still waiting to start.
describe('runPaymentOrphanSweep: paid packages still waiting to start', () => {
  const paidOp = (over: TableRow = {}): TableRow => ({
    id: 'op-paid',
    campaign_id: 'c1',
    event_id: 'e1',
    kind: 'package_purchase',
    outcome: 'succeeded',
    amount: 149,
    credit_applied: 0,
    occurred_at: ago(11),
    recorded_at: ago(11),
    payment_operation_kinds: { effect: 'collect' },
    payment_operation_lines: [],
    ...over,
  });
  // Every fixture event is active and 30 days after NOW unless a test says otherwise.
  const IN_A_MONTH = new Date(NOW.getTime() + 30 * 86_400_000).toISOString();
  const event = (id: string, over: TableRow = {}): TableRow => ({ id, event_date: IN_A_MONTH, status: 'active', ...over });
  const db = (over: { ops?: TableRow[]; campaigns?: TableRow[]; activity?: TableRow[]; events?: TableRow[] } = {}) =>
    createFakeTableClient({
      payment_operations: over.ops ?? [paidOp()],
      campaigns: over.campaigns ?? [{ id: 'c1', event_id: 'e1', status: 'approved' }],
      activity_log: over.activity ?? [],
      events: over.events ?? ['e1', 'e2', 'e3', 'e4'].map((id) => event(id)),
    });
  const jobs = (state: string | null) =>
    ({
      getJobById: vi.fn(async () => (state === null ? null : { id: 'j', state })),
      send: vi.fn(async () => 'j'),
      retry: vi.fn(async () => ({ jobs: [], requested: 1, affected: 1 })),
    }) as unknown as ActivationJobs & Record<'getJobById' | 'send' | 'retry', ReturnType<typeof vi.fn>>;
  const JOB_ID = packageActivationJobId('op-paid');

  it('no job under the payment\'s id: queues it again with the same id and policy, no alert', async () => {
    const j = jobs(null);
    const r = await runPaymentOrphanSweep(db().client as never, j, NOW);
    expect(r.activations).toEqual({ found: 1, queued: 1, retried: 0, failed: 0 });
    expect(j.getJobById).toHaveBeenCalledWith(QUEUES.packageActivation, JOB_ID);
    expect(j.send).toHaveBeenCalledWith(
      QUEUES.packageActivation,
      { campaignId: 'c1', operationId: 'op-paid' },
      { id: JOB_ID, ...PACKAGE_ACTIVATION_RETRY },
    );
    expect(j.retry).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it.each(['created', 'retry', 'active'])('a job in state %s is still on its way: nothing', async (state) => {
    const j = jobs(state);
    const r = await runPaymentOrphanSweep(db().client as never, j, NOW);
    expect(r.activations).toEqual({ found: 1, queued: 0, retried: 0, failed: 0 });
    expect(j.send).not.toHaveBeenCalled();
    expect(j.retry).not.toHaveBeenCalled();
  });

  it('a failed job is retried once, with an audit row and one alert naming the campaign and the event', async () => {
    const j = jobs('failed');
    const d = db();
    const r = await runPaymentOrphanSweep(d.client as never, j, NOW);
    expect(r.activations).toEqual({ found: 1, queued: 0, retried: 1, failed: 0 });
    expect(j.retry).toHaveBeenCalledWith(QUEUES.packageActivation, JOB_ID);
    expect(d.rows('activity_log')).toMatchObject([
      { event_id: 'e1', user_id: null, action: 'campaign.activation_retried', meta: { campaignId: 'c1', operationId: 'op-paid' } },
    ]);
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', fields: { campaign_id: 'c1', event_id: 'e1', operation_id: 'op-paid' } }),
    );
  });

  it('a failed job already retried within the day is left alone: no second retry, no second alert', async () => {
    const j = jobs('failed');
    const activity = [{ id: 'a1', action: 'campaign.activation_retried', meta: { campaignId: 'c1' }, created_at: ago(23 * 60) }];
    const r = await runPaymentOrphanSweep(db({ activity }).client as never, j, NOW);
    expect(r.activations).toEqual({ found: 1, queued: 0, retried: 0, failed: 0 });
    expect(j.retry).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a retry older than a day, or of another campaign, does not hold this one back', async () => {
    const j = jobs('failed');
    const activity = [
      { id: 'a1', action: 'campaign.activation_retried', meta: { campaignId: 'c1' }, created_at: ago(25 * 60) },
      { id: 'a2', action: 'campaign.activation_retried', meta: { campaignId: 'c2' }, created_at: ago(5) },
    ];
    const r = await runPaymentOrphanSweep(db({ activity }).client as never, j, NOW);
    expect(r.activations.retried).toBe(1);
  });

  it('a payment younger than the grace period is left to its own job', async () => {
    const j = jobs(null);
    const r = await runPaymentOrphanSweep(db({ ops: [paidOp({ occurred_at: ago(5), recorded_at: ago(5) })] }).client as never, j, NOW);
    expect(r.activations.found).toBe(0);
    expect(j.getJobById).not.toHaveBeenCalled();
  });

  it('only approved campaigns with a collected ledger: active, paused, refunded and unpaid ones are not touched', async () => {
    const j = jobs(null);
    const campaigns = [
      { id: 'c1', event_id: 'e1', status: 'active' },
      { id: 'c2', event_id: 'e2', status: 'paused' },
      { id: 'c3', event_id: 'e3', status: 'approved' }, // refunded in full
      { id: 'c4', event_id: 'e4', status: 'approved' }, // never paid
    ];
    const ops = [
      paidOp({ id: 'o1', campaign_id: 'c1' }),
      paidOp({ id: 'o2', campaign_id: 'c2' }),
      paidOp({ id: 'o3', campaign_id: 'c3' }),
      paidOp({ id: 'o3r', campaign_id: 'c3', kind: 'refund', occurred_at: ago(10), recorded_at: ago(10), payment_operation_kinds: { effect: 'return' } }),
    ];
    const r = await runPaymentOrphanSweep(db({ campaigns, ops }).client as never, j, NOW);
    expect(r.activations).toEqual({ found: 0, queued: 0, retried: 0, failed: 0 });
    expect(j.getJobById).not.toHaveBeenCalled();
  });

  it('a pg-boss error for one campaign is counted and the next campaign is still handled', async () => {
    const j = jobs(null);
    j.getJobById.mockRejectedValueOnce(new Error('connection reset'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const campaigns = [{ id: 'c1', event_id: 'e1', status: 'approved' }, { id: 'c2', event_id: 'e2', status: 'approved' }];
    const ops = [paidOp({ id: 'o1', campaign_id: 'c1' }), paidOp({ id: 'o2', campaign_id: 'c2' })];
    const r = await runPaymentOrphanSweep(db({ campaigns, ops }).client as never, j, NOW);
    expect(r.activations).toEqual({ found: 2, queued: 1, retried: 0, failed: 1 });
  });

  it('an event whose day has passed is left out: no job looked up, queued or retried, and no alert', async () => {
    for (const state of [null, 'failed']) {
      const j = jobs(state);
      const r = await runPaymentOrphanSweep(db({ events: [event('e1', { event_date: ago(2 * 24 * 60) })] }).client as never, j, NOW);
      expect(r.activations).toEqual({ found: 0, queued: 0, retried: 0, failed: 0 });
      expect(j.getJobById).not.toHaveBeenCalled();
      expect(j.send).not.toHaveBeenCalled();
      expect(j.retry).not.toHaveBeenCalled();
    }
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('the event day itself still counts: an event later today is handled', async () => {
    const j = jobs(null);
    const laterToday = new Date(NOW.getTime() + 2 * 60 * 60_000).toISOString();
    const r = await runPaymentOrphanSweep(db({ events: [event('e1', { event_date: laterToday })] }).client as never, j, NOW);
    expect(r.activations.queued).toBe(1);
  });

  it.each(['draft', 'closed'])('an event in status %s is left out', async (status) => {
    const j = jobs('failed');
    const r = await runPaymentOrphanSweep(db({ events: [event('e1', { status })] }).client as never, j, NOW);
    expect(r.activations.found).toBe(0);
    expect(j.retry).not.toHaveBeenCalled();
  });

  it('a failure to READ the events is thrown, never read as "nothing to start"', async () => {
    const d = db();
    d.fail('events', 'XX000');
    await expect(runPaymentOrphanSweep(d.client as never, jobs(null), NOW)).rejects.toThrow('סריקת השירותים');
  });

  it('a failure to READ the campaigns is thrown, so the job is retried and visible', async () => {
    const d = db();
    d.fail('campaigns', 'XX000');
    await expect(runPaymentOrphanSweep(d.client as never, jobs(null), NOW)).rejects.toThrow('סריקת השירותים');
  });

  it('an unreadable retry log skips the retry: one missed retry is safe, paging every ten minutes is not', async () => {
    const j = jobs('failed');
    const d = db();
    d.fail('activity_log', 'XX000', 'select');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const r = await runPaymentOrphanSweep(d.client as never, j, NOW);
    expect(r.activations.retried).toBe(0);
    expect(j.retry).not.toHaveBeenCalled();
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});
