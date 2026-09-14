import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  purposeMock, configMock, gatesMock, concurrencyMock, accountMock, startMock, adminMock, alertMock,
} = vi.hoisted(() => ({
  purposeMock: vi.fn(), configMock: vi.fn(), gatesMock: vi.fn(), concurrencyMock: vi.fn(),
  accountMock: vi.fn(), startMock: vi.fn(), adminMock: vi.fn(), alertMock: vi.fn(),
}));

vi.mock('@/lib/data/voice-purposes', () => ({ getVoicePurpose: purposeMock }));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantConfig: configMock }));
vi.mock('@/lib/data/console-calls', () => ({
  evaluateSharedConsentGates: gatesMock,
  DIAL_GATE_POLICY: { guest_service: { dnc: true, optOut: true, shabbat: true, dailyWindow: 'apply' } },
}));
vi.mock('@/lib/data/voximplant-concurrency', () => ({ countActiveCallsAllSurfaces: concurrencyMock }));
vi.mock('@/lib/voximplant/core', () => ({
  getAccountInfo: accountMock,
  VoximplantApiError: class extends Error {},
  VoximplantNetworkError: class extends Error {},
}));
vi.mock('@/lib/voximplant/mutations', () => ({ startScenarios: startMock }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: alertMock }));
vi.mock('@/lib/url', () => ({ getAppOrigin: async () => 'https://x.test' }));

import { dispatchVoicePurposeCall } from './voice-purpose-dispatch';

// ⚠️ THE GATE ORDER IS THE PRODUCT HERE. Each one is copied from the three
// hand-written dispatchers, and the ORDER — permission, identity, consent,
// capacity, money, and only then a provider call — is what keeps a refusal from
// costing an attempt row or a dial. A gate that ran after `startScenarios` would
// be a gate that already telephoned somebody.

const PURPOSE = {
  key: 'feedback', displayName: 'משוב', description: null, ruleId: '999',
  enabled: true, isBuiltin: false, leadMs: 0, minDelayMs: 60000, tokenTtlSec: 7200, active: true,
};

function mockDb(contactPhone: string | null = '+972500000000') {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  adminMock.mockReturnValue({
    from: (table: string) => {
      if (table === 'contacts') {
        const c: Record<string, unknown> = {
          select: () => c, eq: () => c,
          maybeSingle: async () => ({ data: { id: 'c1', normalized_phone: contactPhone } }),
        };
        return c;
      }
      return {
        insert: (v: Record<string, unknown>) => {
          inserted.push(v);
          return { select: () => ({ single: async () => ({ data: { id: 'att-1' }, error: null }) }) };
        },
        update: (v: Record<string, unknown>) => {
          updated.push(v);
          return { eq: async () => ({ error: null }) };
        },
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }),
      };
    },
  });
  return { inserted, updated };
}

beforeEach(() => {
  vi.clearAllMocks();
  purposeMock.mockResolvedValue(PURPOSE);
  configMock.mockResolvedValue({
    auth: {}, callbackSecret: 's', callerId: '+97233301505',
    liveCallsEnabled: true, maxConcurrentCalls: 5, minCallReserve: 1, lowBalanceThreshold: 5,
  });
  gatesMock.mockResolvedValue({ ok: true });
  concurrencyMock.mockResolvedValue(0);
  accountMock.mockResolvedValue({ result: { balance: 50 } });
  startMock.mockResolvedValue({ result: 1, call_session_history_id: 7 });
  mockDb();
});

const call = () =>
  dispatchVoicePurposeCall({ purposeKey: 'feedback', eventId: 'e1', contactId: 'c1', runId: 'r1', nodeId: 'n1' });

describe('dispatchVoicePurposeCall', () => {
  it('dials when every gate passes', async () => {
    await expect(call()).resolves.toMatchObject({ kind: 'dialed', callSessionHistoryId: 7 });
    expect(startMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rule_id: '999' }),
      expect.any(Number),
    );
  });

  it('⚠️ REFUSES a built-in purpose — those have their own dispatchers', async () => {
    // RSVP, meeting-confirm and sales carry rules this dispatcher does not: a
    // campaign touchpoint, a 24-hour lead, an unresolved-prior-call check.
    // Dialling them through here would be a second, thinner way into a working
    // path.
    purposeMock.mockResolvedValue({ ...PURPOSE, isBuiltin: true });
    await expect(call()).resolves.toMatchObject({ reason: 'purpose_is_builtin' });
    expect(startMock).not.toHaveBeenCalled();
  });

  it('⚠️ tells "switched off" apart from "never existed"', async () => {
    purposeMock.mockResolvedValue({ ...PURPOSE, enabled: false });
    await expect(call()).resolves.toMatchObject({ reason: 'purpose_disabled' });
    purposeMock.mockResolvedValue(null);
    await expect(call()).resolves.toMatchObject({ reason: 'purpose_not_found' });
  });

  it('⚠️ a purpose with no rule NEVER falls back to another rule', async () => {
    purposeMock.mockResolvedValue({ ...PURPOSE, ruleId: null });
    await expect(call()).resolves.toMatchObject({ reason: 'purpose_rule_missing' });
    expect(startMock).not.toHaveBeenCalled();
  });

  it('⚠️ credentials alone never dial — the live switch is separate', async () => {
    configMock.mockResolvedValue({ auth: {}, callbackSecret: 's', liveCallsEnabled: false });
    await expect(call()).resolves.toMatchObject({ reason: 'live_calls_disabled' });
    expect(startMock).not.toHaveBeenCalled();
  });

  it('⚠️ honours the consent gates, and stops BEFORE any attempt row', async () => {
    gatesMock.mockResolvedValue({ ok: false, reason: 'dnc' });
    const { inserted } = mockDb();
    await expect(call()).resolves.toMatchObject({ reason: 'dnc' });
    expect(inserted).toEqual([]);
    expect(startMock).not.toHaveBeenCalled();
  });

  it('⚠️ uses the STRICTEST consent policy — a guest asked for nothing', async () => {
    await call();
    expect(gatesMock.mock.calls[0]![3]).toEqual({
      policy: { dnc: true, optOut: true, shabbat: true, dailyWindow: 'apply' },
    });
  });

  it('stops on concurrency and on a balance below reserve, before dialling', async () => {
    concurrencyMock.mockResolvedValue(99);
    await expect(call()).resolves.toMatchObject({ reason: 'max_concurrency' });
    concurrencyMock.mockResolvedValue(0);
    accountMock.mockResolvedValue({ result: { balance: 0 } });
    await expect(call()).resolves.toMatchObject({ reason: 'balance_below_reserve' });
    expect(startMock).not.toHaveBeenCalled();
  });

  it('⚠️ stamps the run and node on the attempt — the replay guard', async () => {
    const { inserted } = mockDb();
    await call();
    expect(inserted[0]).toMatchObject({ run_id: 'r1', node_id: 'n1', contact_id: 'c1', purpose_key: 'feedback' });
    // And the payload carries NO guest data — the scenario fetches context.
    const payload = JSON.parse(startMock.mock.calls[0]![1].script_custom_data as string);
    expect(Object.keys(payload).sort()).toEqual(['from', 'to', 'tok', 'u'].sort());
  });

  it('⚠️ an ambiguous start is UNKNOWN, never failed — in the ROW as well', async () => {
    // The call may well be ringing. Marking it failed invites a retry that
    // telephones the person twice, and the RETRY READS THE ROW, not the return
    // value — so asserting only the returned kind would miss exactly that.
    // Fault injection on 2026-09-14 proved it: flipping the recorded status to
    // 'failed' left every test green.
    startMock.mockResolvedValue({ result: 0 });
    const { updated } = mockDb();
    await expect(call()).resolves.toMatchObject({ kind: 'start_unknown' });
    expect(updated[0]).toMatchObject({ dispatch_status: 'unknown' });
  });

  it('records a CONFIRMED dial with its session id', async () => {
    const { updated } = mockDb();
    await call();
    expect(updated[0]).toMatchObject({
      dispatch_status: 'confirmed',
      vox_call_session_history_id: 7,
    });
  });

  it('skips a contact with no usable phone', async () => {
    mockDb(null);
    await expect(call()).resolves.toMatchObject({ reason: 'invalid_phone' });
  });
});
