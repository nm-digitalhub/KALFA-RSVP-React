import { beforeEach, describe, expect, it, vi } from 'vitest';

// sales-call-dispatch.ts begins with `import 'server-only'` — stub it.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

vi.mock('@/lib/data/console-calls', () => ({
  evaluateSharedConsentGates: vi.fn(),
  DIAL_GATE_POLICY: {
    callback: { dnc: true, optOut: true, shabbat: true, dailyWindow: 'overridable' },
  },
}));

vi.mock('@/lib/callbacks/policy-config', () => ({
  getCallbackPolicy: vi.fn().mockResolvedValue({ maxAttempts: 3, attemptWindowMs: 30 * 24 * 60 * 60 * 1000 }),
}));

vi.mock('@/lib/data/sales-call-attempts', () => ({
  createSalesDispatchAttempt: vi.fn(),
  getSalesDispatchAttemptBySlot: vi.fn(),
  getUnresolvedSalesAttempt: vi.fn(),
  recordSalesDialConfirmed: vi.fn(),
  markSalesDispatchFailed: vi.fn(),
  markSalesDispatchUnknown: vi.fn(),
  recordSalesDialAudit: vi.fn(),
  countRecentSalesAuditedAttempts: vi.fn(),
  DISPATCH_PRE_TERMINAL: ['queued', 'dialing', 'in_progress'],
}));

vi.mock('@/lib/data/voximplant-concurrency', () => ({
  countActiveCallsAllSurfaces: vi.fn(),
}));

vi.mock('@/lib/voximplant/mutations', () => ({ startScenarios: vi.fn() }));
vi.mock('@/lib/voximplant/core', () => ({
  getAccountInfo: vi.fn(),
  VoximplantApiError: class VoximplantApiError extends Error {
    constructor(message: string, readonly code: number | null) {
      super(message);
      this.name = 'VoximplantApiError';
    }
  },
  VoximplantNetworkError: class VoximplantNetworkError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'VoximplantNetworkError';
    }
  },
}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { createMockSupabase, type MockQueryBuilder } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  dispatchSalesCall,
  enqueueSalesCallDispatch,
  type SalesCallDispatchConfig,
} from './sales-call-dispatch';
import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { evaluateSharedConsentGates } from '@/lib/data/console-calls';
import {
  createSalesDispatchAttempt,
  getSalesDispatchAttemptBySlot,
  getUnresolvedSalesAttempt,
  recordSalesDialConfirmed,
  markSalesDispatchFailed,
  markSalesDispatchUnknown,
  recordSalesDialAudit,
  countRecentSalesAuditedAttempts,
} from '@/lib/data/sales-call-attempts';
import { countActiveCallsAllSurfaces } from '@/lib/data/voximplant-concurrency';
import { getAccountInfo, VoximplantApiError, VoximplantNetworkError } from '@/lib/voximplant/core';
import { startScenarios } from '@/lib/voximplant/mutations';
import { sendSlackAlert } from '@/lib/alerts/slack';

type Row = Record<string, unknown>;
type Admin = ReturnType<typeof createAdminClient>;

const REQ_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ATTEMPT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const HISTORY = 123456;
const ORIGIN = 'https://beta.kalfa.me';

const CONFIG: SalesCallDispatchConfig = {
  auth: { accountId: 1, keyId: 'KEY_ID', privateKey: 'PRIVATE_KEY_SECRET' },
  ruleId: '1521000',
  callerId: '972500000000',
  minCallReserve: 0.1,
  lowBalanceThreshold: 5,
  maxConcurrentCalls: 5,
  callsEnabled: true,
};

const acct = (balance: number) => ({
  result: { account_id: 1, account_name: 'x', account_email: 'x', active: true, currency: 'USD', balance, created: '' },
});

const SCHEDULED_ROW = { id: REQ_ID, phone: '0501234567', status: 'scheduled', scheduled_at: '2026-08-23T10:00:00+03:00' };

function mockedAdmin(row: Row | null = SCHEDULED_ROW): { admin: Admin; builder: MockQueryBuilder<Row> } {
  const { client, builder } = createMockSupabase<Row>({ data: row, error: null });
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as Admin);
  return { admin: client as unknown as Admin, builder };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmin();
  vi.mocked(getUnresolvedSalesAttempt).mockResolvedValue(null);
  vi.mocked(countRecentSalesAuditedAttempts).mockResolvedValue(0);
  vi.mocked(evaluateSharedConsentGates).mockResolvedValue({ ok: true });
  vi.mocked(countActiveCallsAllSurfaces).mockResolvedValue(0);
  vi.mocked(getAccountInfo).mockResolvedValue(acct(50) as never);
  vi.mocked(createSalesDispatchAttempt).mockResolvedValue({ id: ATTEMPT_ID });
  vi.mocked(getSalesDispatchAttemptBySlot).mockResolvedValue(null);
  vi.mocked(recordSalesDialConfirmed).mockResolvedValue({ applied: true });
  vi.mocked(markSalesDispatchFailed).mockResolvedValue({ applied: true });
  vi.mocked(markSalesDispatchUnknown).mockResolvedValue({ applied: true });
  vi.mocked(recordSalesDialAudit).mockResolvedValue(undefined);
  vi.mocked(sendSlackAlert).mockResolvedValue(null);
  vi.mocked(startScenarios).mockResolvedValue({ result: 1, call_session_history_id: HISTORY } as never);
});

describe('gates (no dial)', () => {
  it('calls disabled → blocked, no dial', async () => {
    const r = await dispatchSalesCall(REQ_ID, { ...CONFIG, callsEnabled: false }, ORIGIN);
    expect(r).toEqual({ kind: 'blocked', reason: 'calls_disabled' });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('row not found → skipped not_scheduled', async () => {
    mockedAdmin(null);
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({ kind: 'skipped', reason: 'not_scheduled' });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('status no longer scheduled → skipped not_scheduled', async () => {
    mockedAdmin({ ...SCHEDULED_ROW, status: 'pending_schedule' });
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({ kind: 'skipped', reason: 'not_scheduled' });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('unnormalizable phone → skipped invalid_phone', async () => {
    mockedAdmin({ ...SCHEDULED_ROW, phone: 'not-a-phone' });
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({ kind: 'skipped', reason: 'invalid_phone' });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('at the 3-attempt cap → skipped attempt_cap, before any provider call', async () => {
    vi.mocked(countRecentSalesAuditedAttempts).mockResolvedValue(3);
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({ kind: 'skipped', reason: 'attempt_cap' });
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('consent gate refuses (e.g. dnc) → skipped with the gate\'s own reason', async () => {
    vi.mocked(evaluateSharedConsentGates).mockResolvedValue({ ok: false, reason: 'dnc' });
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({ kind: 'skipped', reason: 'dnc' });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('a prior dispatched call on this request is still unresolved (reschedule-mid-confirmation) → skipped prior_call_unresolved, before the attempt cap or any provider call', async () => {
    vi.mocked(getUnresolvedSalesAttempt).mockResolvedValue(
      { id: 'prior-attempt', vox_call_session_history_id: '999', outcome_recorded_at: null } as never,
    );
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({ kind: 'skipped', reason: 'prior_call_unresolved' });
    expect(countRecentSalesAuditedAttempts).not.toHaveBeenCalled();
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(createSalesDispatchAttempt).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
  });
});

describe('concurrency', () => {
  it('at/over the combined cross-surface cap → max_concurrency, no attempt, no dial, warn', async () => {
    vi.mocked(countActiveCallsAllSurfaces).mockResolvedValue(5); // == cap
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({ kind: 'max_concurrency' });
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(createSalesDispatchAttempt).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });
});

describe('balance', () => {
  it('transport error → transient_error, no attempt, no dial', async () => {
    vi.mocked(getAccountInfo).mockRejectedValue(new VoximplantNetworkError('timeout'));
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({ kind: 'transient_error', reason: 'balance_check_failed' });
    expect(createSalesDispatchAttempt).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('below reserve → blocked, no attempt, Slack error', async () => {
    vi.mocked(getAccountInfo).mockResolvedValue(acct(0.05) as never);
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({ kind: 'blocked', reason: 'balance_below_reserve' });
    expect(createSalesDispatchAttempt).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('warning band (≥reserve, <low) → dials + warns', async () => {
    vi.mocked(getAccountInfo).mockResolvedValue(acct(2) as never);
    expect((await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).kind).toBe('dialed');
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });
});

describe('atomic-create race (reconcile)', () => {
  it('lost race, winner in-flight → concurrent_owner, no dial, no status write', async () => {
    vi.mocked(createSalesDispatchAttempt).mockResolvedValue(null);
    vi.mocked(getSalesDispatchAttemptBySlot).mockResolvedValue(
      { id: ATTEMPT_ID, dispatch_status: 'dialing', vox_call_session_history_id: null } as never,
    );
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({ kind: 'concurrent_owner' });
    expect(startScenarios).not.toHaveBeenCalled();
    expect(markSalesDispatchUnknown).not.toHaveBeenCalled();
    expect(recordSalesDialConfirmed).not.toHaveBeenCalled();
  });

  it('lost race, winner already has a history id → already_dispatched, no dial', async () => {
    vi.mocked(createSalesDispatchAttempt).mockResolvedValue(null);
    vi.mocked(getSalesDispatchAttemptBySlot).mockResolvedValue(
      { id: ATTEMPT_ID, dispatch_status: 'dialing', vox_call_session_history_id: String(HISTORY) } as never,
    );
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({ kind: 'already_dispatched', attemptId: ATTEMPT_ID });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('lost race, winner already concluded → already_concluded, no dial', async () => {
    vi.mocked(createSalesDispatchAttempt).mockResolvedValue(null);
    vi.mocked(getSalesDispatchAttemptBySlot).mockResolvedValue(
      { id: ATTEMPT_ID, dispatch_status: 'failed_to_start', vox_call_session_history_id: null } as never,
    );
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({
      kind: 'already_concluded', attemptId: ATTEMPT_ID, dispatchStatus: 'failed_to_start',
    });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('lost race, no reconcile row found at all → concurrent_owner (fail-closed)', async () => {
    vi.mocked(createSalesDispatchAttempt).mockResolvedValue(null);
    vi.mocked(getSalesDispatchAttemptBySlot).mockResolvedValue(null);
    expect(await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN)).toEqual({ kind: 'concurrent_owner' });
    expect(startScenarios).not.toHaveBeenCalled();
  });
});

describe('provider outcomes', () => {
  it('VoximplantApiError → failed_to_start, non-retryable, alerted', async () => {
    vi.mocked(startScenarios).mockRejectedValue(new VoximplantApiError('rejected', 42));
    const r = await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN);
    expect(r).toEqual({ kind: 'failed_to_start', attemptId: ATTEMPT_ID, code: 42 });
    expect(markSalesDispatchFailed).toHaveBeenCalledWith(ATTEMPT_ID, 'rejected');
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });

  it('VoximplantNetworkError/timeout → start_unknown, no redial, alerted', async () => {
    vi.mocked(startScenarios).mockRejectedValue(new VoximplantNetworkError('timeout'));
    const r = await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN);
    expect(r).toEqual({ kind: 'start_unknown', attemptId: ATTEMPT_ID });
    expect(markSalesDispatchUnknown).toHaveBeenCalledWith(ATTEMPT_ID, 'network_error_during_start');
  });

  it('result===1 without a history id → start_unknown', async () => {
    vi.mocked(startScenarios).mockResolvedValue({ result: 1, call_session_history_id: null } as never);
    const r = await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN);
    expect(r).toEqual({ kind: 'start_unknown', attemptId: ATTEMPT_ID });
    expect(markSalesDispatchUnknown).toHaveBeenCalledWith(ATTEMPT_ID, 'ambiguous_start_response');
  });

  it('full success → recordSalesDialConfirmed + audit written + dialed', async () => {
    const r = await dispatchSalesCall(REQ_ID, CONFIG, ORIGIN);
    expect(r).toEqual({ kind: 'dialed', attemptId: ATTEMPT_ID, callSessionHistoryId: HISTORY });
    expect(recordSalesDialConfirmed).toHaveBeenCalledWith(ATTEMPT_ID, HISTORY);
    expect(recordSalesDialAudit).toHaveBeenCalledWith(REQ_ID);
    expect(startScenarios).toHaveBeenCalledWith(
      CONFIG.auth,
      { rule_id: CONFIG.ruleId, script_custom_data: expect.stringContaining('"to":"+972501234567"') },
      expect.any(Number),
    );
  });
});

describe('enqueueSalesCallDispatch', () => {
  const fakeBoss = () => ({ send: vi.fn().mockResolvedValue('job-id') });
  const SCHEDULED_ISO = '2026-08-23T10:00:00+03:00';
  const NOW_MS = Date.parse('2026-08-22T09:00:00+03:00'); // well before scheduledMs

  it("topic !== 'מכירות' → never enqueues", async () => {
    const boss = fakeBoss();
    await enqueueSalesCallDispatch(
      boss as never,
      { id: REQ_ID, topic: 'תמיכה', scheduledAtIso: SCHEDULED_ISO },
      NOW_MS,
    );
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('a null topic (no legitimate exclusion reason) never enqueues', async () => {
    const boss = fakeBoss();
    await enqueueSalesCallDispatch(
      boss as never,
      { id: REQ_ID, topic: null, scheduledAtIso: SCHEDULED_ISO },
      NOW_MS,
    );
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('an unreadable scheduledAtIso never enqueues', async () => {
    const boss = fakeBoss();
    await enqueueSalesCallDispatch(
      boss as never,
      { id: REQ_ID, topic: 'מכירות', scheduledAtIso: 'not-a-date' },
      NOW_MS,
    );
    expect(boss.send).not.toHaveBeenCalled();
  });

  it("topic='מכירות' → enqueues at scheduled_at with a real uuid job id, never the raw composite string", async () => {
    const boss = fakeBoss();
    await enqueueSalesCallDispatch(
      boss as never,
      { id: REQ_ID, topic: 'מכירות', scheduledAtIso: SCHEDULED_ISO },
      NOW_MS,
    );
    expect(boss.send).toHaveBeenCalledTimes(1);
    const [queueName, payload, opts] = boss.send.mock.calls[0];
    expect(queueName).toBe('sales-call-dispatch');
    expect(payload).toEqual({ callbackRequestId: REQ_ID });
    const scheduledMs = Date.parse(SCHEDULED_ISO);
    // pgboss.job.id is a strict uuid column — the raw composite string must
    // be hashed through deterministicJobId, never passed verbatim (that
    // throws 22P02 at insert time; the exact live bug found 2026-08-22 —
    // see deterministic-id.ts's own module comment).
    expect(opts.id).toBe(deterministicJobId(`sales-call-dispatch:${REQ_ID}:${scheduledMs}`));
    expect(opts.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(opts.startAfter).toEqual(new Date(scheduledMs));
  });

  it('a scheduled_at already in the past clamps startAfter to now + min delay, not the stale past instant', async () => {
    const boss = fakeBoss();
    const pastIso = new Date(NOW_MS - 60 * 60 * 1000).toISOString(); // 1h before "now"
    await enqueueSalesCallDispatch(
      boss as never,
      { id: REQ_ID, topic: 'מכירות', scheduledAtIso: pastIso },
      NOW_MS,
    );
    expect(boss.send).toHaveBeenCalledTimes(1);
    const [, , opts] = boss.send.mock.calls[0];
    expect((opts.startAfter as Date).getTime()).toBeGreaterThan(NOW_MS);
  });
});
