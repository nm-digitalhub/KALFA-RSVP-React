import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deterministicJobId } from '@/lib/queue/deterministic-id';

// meeting-confirm-dispatch.ts begins with `import 'server-only'` — stub it
// (convention: outreach-calls.test.ts). Mock every collaborator so the pure
// control flow runs with no DB/provider.
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

vi.mock('@/lib/data/callback-request-attempts', () => ({
  createCallbackDispatchAttempt: vi.fn(),
  listCallbackDispatchAttemptsBySlot: vi.fn(),
  recordCallbackDialConfirmed: vi.fn(),
  markCallbackDispatchFailed: vi.fn(),
  markCallbackDispatchUnknown: vi.fn(),
  recordCallbackDialAudit: vi.fn(),
  countRecentCallbackAuditedAttempts: vi.fn(),
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
  dispatchMeetingConfirmCall,
  enqueueMeetingConfirmDispatch,
  type MeetingConfirmDispatchConfig,
} from './meeting-confirm-dispatch';
import { evaluateSharedConsentGates } from '@/lib/data/console-calls';
import {
  createCallbackDispatchAttempt,
  listCallbackDispatchAttemptsBySlot,
  recordCallbackDialConfirmed,
  markCallbackDispatchFailed,
  markCallbackDispatchUnknown,
  recordCallbackDialAudit,
  countRecentCallbackAuditedAttempts,
} from '@/lib/data/callback-request-attempts';
import { countActiveCallsAllSurfaces } from '@/lib/data/voximplant-concurrency';
import { getAccountInfo, VoximplantApiError, VoximplantNetworkError } from '@/lib/voximplant/core';
import { startScenarios } from '@/lib/voximplant/mutations';
import { sendSlackAlert } from '@/lib/alerts/slack';

type Row = Record<string, unknown>;
type Admin = ReturnType<typeof createAdminClient>;

const REQ_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ATTEMPT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HISTORY = 987654;
const ORIGIN = 'https://beta.kalfa.me';

const CONFIG: MeetingConfirmDispatchConfig = {
  auth: { accountId: 1, keyId: 'KEY_ID', privateKey: 'PRIVATE_KEY_SECRET' },
  ruleId: '1520999',
  callerId: '972500000000',
  minCallReserve: 0.1,
  lowBalanceThreshold: 5,
  maxConcurrentCalls: 5,
  callsEnabled: true,
};

const acct = (balance: number) => ({
  result: { account_id: 1, account_name: 'x', account_email: 'x', active: true, currency: 'USD', balance, created: '' },
});

// Fully deterministic clock: dispatchMeetingConfirmCall now takes an injectable
// nowMs (added after the 218eb34 time-bomb incident — the suite shipped green
// with a literal '2026-08-23T10:00+03:00' fixture against a hidden Date.now()
// and 15 tests started failing the moment that instant passed). Every dispatch
// call below passes DISPATCH_NOW_MS, so these literals can never expire.
const DISPATCH_NOW_MS = Date.parse('2026-07-20T09:00:00+03:00');
const SCHEDULED_AT_FUTURE_ISO = new Date(DISPATCH_NOW_MS + 48 * 60 * 60 * 1000).toISOString();
const SCHEDULED_ROW = { id: REQ_ID, phone: '0501234567', status: 'scheduled', scheduled_at: SCHEDULED_AT_FUTURE_ISO };

function mockedAdmin(row: Row | null = SCHEDULED_ROW): { admin: Admin; builder: MockQueryBuilder<Row> } {
  const { client, builder } = createMockSupabase<Row>({ data: row, error: null });
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as Admin);
  return { admin: client as unknown as Admin, builder };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedAdmin();
  vi.mocked(countRecentCallbackAuditedAttempts).mockResolvedValue(0);
  vi.mocked(evaluateSharedConsentGates).mockResolvedValue({ ok: true });
  vi.mocked(countActiveCallsAllSurfaces).mockResolvedValue(0);
  vi.mocked(getAccountInfo).mockResolvedValue(acct(50) as never);
  vi.mocked(createCallbackDispatchAttempt).mockResolvedValue({ id: ATTEMPT_ID });
  vi.mocked(listCallbackDispatchAttemptsBySlot).mockResolvedValue([]);
  vi.mocked(recordCallbackDialConfirmed).mockResolvedValue({ applied: true });
  vi.mocked(markCallbackDispatchFailed).mockResolvedValue({ applied: true });
  vi.mocked(markCallbackDispatchUnknown).mockResolvedValue({ applied: true });
  vi.mocked(recordCallbackDialAudit).mockResolvedValue(undefined);
  vi.mocked(sendSlackAlert).mockResolvedValue(null);
  vi.mocked(startScenarios).mockResolvedValue({ result: 1, call_session_history_id: HISTORY } as never);
});

describe('gates (no dial)', () => {
  it('calls disabled → blocked, no dial, no row read side effects beyond the gate', async () => {
    const r = await dispatchMeetingConfirmCall(REQ_ID, { ...CONFIG, callsEnabled: false }, ORIGIN, DISPATCH_NOW_MS);
    expect(r).toEqual({ kind: 'blocked', reason: 'calls_disabled' });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('row not found → skipped not_scheduled', async () => {
    mockedAdmin(null);
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'skipped', reason: 'not_scheduled' });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('status no longer scheduled (released between enqueue and this tick) → skipped not_scheduled', async () => {
    mockedAdmin({ ...SCHEDULED_ROW, status: 'pending_schedule' });
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'skipped', reason: 'not_scheduled' });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('scheduled_at null → skipped not_scheduled (defensive — should not happen by construction)', async () => {
    mockedAdmin({ ...SCHEDULED_ROW, scheduled_at: null });
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'skipped', reason: 'not_scheduled' });
  });

  it('scheduled_at already in the past → skipped already_past, never dials', async () => {
    mockedAdmin({ ...SCHEDULED_ROW, scheduled_at: '2020-01-01T10:00:00+03:00' });
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'skipped', reason: 'already_past' });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('unnormalizable phone → skipped invalid_phone', async () => {
    mockedAdmin({ ...SCHEDULED_ROW, phone: 'not-a-phone' });
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'skipped', reason: 'invalid_phone' });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('at the 3-attempt cap → skipped attempt_cap, before any provider call', async () => {
    vi.mocked(countRecentCallbackAuditedAttempts).mockResolvedValue(3);
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'skipped', reason: 'attempt_cap' });
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('consent gate refuses (e.g. dnc) → skipped with the gate\'s own reason', async () => {
    vi.mocked(evaluateSharedConsentGates).mockResolvedValue({ ok: false, reason: 'dnc' });
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'skipped', reason: 'dnc' });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('consent gate is evaluated with DIAL_GATE_POLICY.callback and no hours override', async () => {
    await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS);
    expect(evaluateSharedConsentGates).toHaveBeenCalledWith(
      expect.anything(),
      '+972501234567',
      expect.any(Number),
      expect.objectContaining({ policy: { dnc: true, optOut: true, shabbat: true, dailyWindow: 'overridable' } }),
    );
  });
});

describe('concurrency', () => {
  it('at/over the combined cross-surface cap → max_concurrency, no attempt, no dial, warn', async () => {
    vi.mocked(countActiveCallsAllSurfaces).mockResolvedValue(5); // == cap
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'max_concurrency' });
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(createCallbackDispatchAttempt).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });
});

describe('balance', () => {
  it('transport error → transient_error, no attempt, no dial', async () => {
    vi.mocked(getAccountInfo).mockRejectedValue(new VoximplantNetworkError('timeout'));
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'transient_error', reason: 'balance_check_failed' });
    expect(createCallbackDispatchAttempt).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('below reserve → blocked, no attempt, Slack error', async () => {
    vi.mocked(getAccountInfo).mockResolvedValue(acct(0.05) as never);
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'blocked', reason: 'balance_below_reserve' });
    expect(createCallbackDispatchAttempt).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });

  it('warning band (≥reserve, <low) → dials + warns', async () => {
    vi.mocked(getAccountInfo).mockResolvedValue(acct(2) as never);
    expect((await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).kind).toBe('dialed');
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });
});

describe('outcome-aware slot dedup (incident 2026-08-23)', () => {
  it('prior attempt with a REAL outcome → already_dispatched, no provider call at all', async () => {
    vi.mocked(listCallbackDispatchAttemptsBySlot).mockResolvedValue([
      { id: ATTEMPT_ID, dispatch_status: 'concluded', confirmation_call_status: 'confirmed' } as never,
    ]);
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'already_dispatched', attemptId: ATTEMPT_ID });
    expect(createCallbackDispatchAttempt).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('prior attempt still in-flight → concurrent_owner, no new attempt', async () => {
    vi.mocked(listCallbackDispatchAttemptsBySlot).mockResolvedValue([
      { id: ATTEMPT_ID, dispatch_status: 'dialing', confirmation_call_status: 'not_sent' } as never,
    ]);
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'concurrent_owner' });
    expect(createCallbackDispatchAttempt).not.toHaveBeenCalled();
  });

  it('prior attempt concluded WITHOUT an outcome → RETRIES: creates a new attempt and dials (the 2026-08-23 09:00 regression)', async () => {
    vi.mocked(listCallbackDispatchAttemptsBySlot).mockResolvedValue([
      { id: ATTEMPT_ID, dispatch_status: 'concluded', finish_reason: 'completed', confirmation_call_status: 'not_sent' } as never,
    ]);
    const r = await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS);
    expect(r.kind).toBe('dialed');
    expect(createCallbackDispatchAttempt).toHaveBeenCalled();
    expect(startScenarios).toHaveBeenCalled();
  });
});

describe('atomic-create race (reconcile)', () => {
  it('lost race, winner in-flight (pre-terminal) → concurrent_owner, no dial, no status write', async () => {
    vi.mocked(createCallbackDispatchAttempt).mockResolvedValue(null);
    vi.mocked(listCallbackDispatchAttemptsBySlot)
      .mockResolvedValueOnce([]) // pre-check: slot empty when we looked
      .mockResolvedValueOnce([
        { id: ATTEMPT_ID, dispatch_status: 'dialing', confirmation_call_status: 'not_sent' } as never,
      ]);
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'concurrent_owner' });
    expect(startScenarios).not.toHaveBeenCalled();
    expect(markCallbackDispatchUnknown).not.toHaveBeenCalled(); // must NOT corrupt the winner
    expect(recordCallbackDialConfirmed).not.toHaveBeenCalled();
  });

  it('lost race, winner already reached an outcome → already_dispatched, no dial', async () => {
    vi.mocked(createCallbackDispatchAttempt).mockResolvedValue(null);
    vi.mocked(listCallbackDispatchAttemptsBySlot)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: ATTEMPT_ID, dispatch_status: 'concluded', confirmation_call_status: 'confirmed' } as never,
      ]);
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'already_dispatched', attemptId: ATTEMPT_ID });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('lost race, winner concluded this tick without an outcome yet → already_concluded, no immediate redial', async () => {
    vi.mocked(createCallbackDispatchAttempt).mockResolvedValue(null);
    vi.mocked(listCallbackDispatchAttemptsBySlot)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: ATTEMPT_ID, dispatch_status: 'failed_to_start', confirmation_call_status: 'not_sent' } as never,
      ]);
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({
      kind: 'already_concluded', attemptId: ATTEMPT_ID, dispatchStatus: 'failed_to_start',
    });
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('lost race, no reconcile row found at all → concurrent_owner (fail-closed)', async () => {
    vi.mocked(createCallbackDispatchAttempt).mockResolvedValue(null);
    vi.mocked(listCallbackDispatchAttemptsBySlot)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    expect(await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS)).toEqual({ kind: 'concurrent_owner' });
    expect(startScenarios).not.toHaveBeenCalled();
  });
});

describe('provider outcomes', () => {
  it('VoximplantApiError → failed_to_start, non-retryable, alerted', async () => {
    vi.mocked(startScenarios).mockRejectedValue(new VoximplantApiError('rejected', 42));
    const r = await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS);
    expect(r).toEqual({ kind: 'failed_to_start', attemptId: ATTEMPT_ID, code: 42 });
    expect(markCallbackDispatchFailed).toHaveBeenCalledWith(ATTEMPT_ID, 'rejected');
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });

  it('VoximplantNetworkError/timeout → start_unknown, no redial, alerted', async () => {
    vi.mocked(startScenarios).mockRejectedValue(new VoximplantNetworkError('timeout'));
    const r = await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS);
    expect(r).toEqual({ kind: 'start_unknown', attemptId: ATTEMPT_ID });
    expect(markCallbackDispatchUnknown).toHaveBeenCalledWith(ATTEMPT_ID, 'network_error_during_start');
  });

  it('result===1 without a history id → start_unknown', async () => {
    vi.mocked(startScenarios).mockResolvedValue({ result: 1, call_session_history_id: null } as never);
    const r = await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS);
    expect(r).toEqual({ kind: 'start_unknown', attemptId: ATTEMPT_ID });
    expect(markCallbackDispatchUnknown).toHaveBeenCalledWith(ATTEMPT_ID, 'ambiguous_start_response');
  });

  it('full success → recordCallbackDialConfirmed + audit written + dialed', async () => {
    const r = await dispatchMeetingConfirmCall(REQ_ID, CONFIG, ORIGIN, DISPATCH_NOW_MS);
    expect(r).toEqual({ kind: 'dialed', attemptId: ATTEMPT_ID, callSessionHistoryId: HISTORY });
    expect(recordCallbackDialConfirmed).toHaveBeenCalledWith(ATTEMPT_ID, HISTORY);
    expect(recordCallbackDialAudit).toHaveBeenCalledWith(REQ_ID);
    expect(startScenarios).toHaveBeenCalledWith(
      CONFIG.auth,
      { rule_id: CONFIG.ruleId, script_custom_data: expect.stringContaining('"to":"+972501234567"') },
      expect.any(Number),
    );
  });
});

describe('enqueueMeetingConfirmDispatch', () => {
  // Real clampIntoCallbackWindow (pure, already unit-tested in
  // schedule-policy.test.ts) — deliberately not mocked, so these tests catch
  // a real wiring mistake, not just that boss.send was called with SOMETHING.
  const fakeBoss = () => ({ send: vi.fn().mockResolvedValue('job-id') });
  // A Tuesday 09:00 Israel time — comfortably inside DEFAULT_CALLBACK_POLICY's
  // window, so the target (24h earlier) needs no clamping in most cases below.
  const SCHEDULED_ISO = '2026-07-28T09:00:00+03:00';
  const NOW_MS = Date.parse('2026-07-20T00:00:00+03:00');

  it('topic=מכירות → never enqueues (B1: reserved for the sales-closing agent)', async () => {
    const boss = fakeBoss();
    await enqueueMeetingConfirmDispatch(
      boss as never,
      { id: REQ_ID, topic: 'מכירות', scheduledAtIso: SCHEDULED_ISO },
      NOW_MS,
    );
    expect(boss.send).not.toHaveBeenCalled();
  });

  it('any other topic → enqueues with a deterministic id keyed on (request, scheduled instant)', async () => {
    const boss = fakeBoss();
    await enqueueMeetingConfirmDispatch(
      boss as never,
      { id: REQ_ID, topic: 'תמיכה', scheduledAtIso: SCHEDULED_ISO },
      NOW_MS,
    );
    expect(boss.send).toHaveBeenCalledTimes(1);
    const [queueName, payload, opts] = boss.send.mock.calls[0];
    expect(queueName).toBe('meeting-confirm-dispatch');
    expect(payload).toEqual({ callbackRequestId: REQ_ID });
    // pgboss.job.id is a strict uuid column — the raw composite string must
    // be hashed through deterministicJobId, never passed verbatim (that
    // throws 22P02 at insert time; this was a real, live bug — see the
    // deterministic-id.ts module comment).
    expect(opts.id).toBe(deterministicJobId(`meeting-confirm:${REQ_ID}:${Date.parse(SCHEDULED_ISO)}`));
    expect(opts.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('a null topic (no legitimate exclusion reason) still enqueues', async () => {
    const boss = fakeBoss();
    await enqueueMeetingConfirmDispatch(
      boss as never,
      { id: REQ_ID, topic: null, scheduledAtIso: SCHEDULED_ISO },
      NOW_MS,
    );
    expect(boss.send).toHaveBeenCalledTimes(1);
  });

  it('targets ~24h before the slot, clamped into business hours', async () => {
    const boss = fakeBoss();
    await enqueueMeetingConfirmDispatch(
      boss as never,
      { id: REQ_ID, topic: null, scheduledAtIso: SCHEDULED_ISO },
      NOW_MS,
    );
    const opts = boss.send.mock.calls[0][2];
    // 24h before Tue 09:00 lands exactly on Mon 09:00 — already inside the
    // window, so no clamping should have moved it.
    expect((opts.startAfter as Date).toISOString()).toBe(new Date(Date.parse(SCHEDULED_ISO) - 24 * 60 * 60 * 1000).toISOString());
  });

  it('a slot booked for later TODAY still enqueues promptly, not in the past', async () => {
    const boss = fakeBoss();
    const soonIso = new Date(NOW_MS + 60 * 60 * 1000).toISOString(); // 1h from now
    await enqueueMeetingConfirmDispatch(
      boss as never,
      { id: REQ_ID, topic: null, scheduledAtIso: soonIso },
      NOW_MS,
    );
    const opts = boss.send.mock.calls[0][2];
    expect((opts.startAfter as Date).getTime()).toBeGreaterThan(NOW_MS);
  });

  it('an unparsable scheduledAtIso → never enqueues (defensive)', async () => {
    const boss = fakeBoss();
    await enqueueMeetingConfirmDispatch(
      boss as never,
      { id: REQ_ID, topic: null, scheduledAtIso: 'not-a-date' },
      NOW_MS,
    );
    expect(boss.send).not.toHaveBeenCalled();
  });
});
