import { beforeEach, describe, expect, it, vi } from 'vitest';

// outreach-calls.ts begins with `import 'server-only'` — stub it (convention:
// call-result-processing.test.ts). Mock every collaborator so the pure control
// flow runs with no DB/provider.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/data/outreach-config', () => ({ getOutreachEnabled: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({
  getVoximplantConfig: vi.fn(),
  getVoximplantLiveEnabled: vi.fn(),
}));
vi.mock('@/lib/data/call-attempts', () => ({
  createCallAttempt: vi.fn(),
  getCallAttemptByTouchpoint: vi.fn(),
  recordDialConfirmed: vi.fn(),
  markFailedToStart: vi.fn(),
  markStartUnknown: vi.fn(),
}));
vi.mock('@/lib/data/outreach-engine', () => ({
  getCampaignContext: vi.fn(),
  hasCallConsent: vi.fn(),
  isContactReached: vi.fn(),
  isDncListed: vi.fn(),
}));
vi.mock('@/lib/data/interactions', () => ({
  getGuestsForContact: vi.fn(),
  insertInteraction: vi.fn(),
  setContactOpStatus: vi.fn(),
}));
vi.mock('@/lib/voximplant/core', () => ({
  getAccountInfo: vi.fn(),
  startScenarios: vi.fn(),
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
vi.mock('@/lib/voximplant/call-token', () => ({ signCallToken: vi.fn(() => 'sig.tok') }));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn(async (p: string) => `https://beta.kalfa.me${p}`) }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { dispatchOutreachCall, buildScriptCustomData } from './outreach-calls';
import { getOutreachEnabled } from '@/lib/data/outreach-config';
import { getVoximplantConfig, getVoximplantLiveEnabled } from '@/lib/data/voximplant-config';
import {
  createCallAttempt,
  getCallAttemptByTouchpoint,
  recordDialConfirmed,
  markFailedToStart,
  markStartUnknown,
} from '@/lib/data/call-attempts';
import {
  getCampaignContext,
  hasCallConsent,
  isContactReached,
  isDncListed,
} from '@/lib/data/outreach-engine';
import { getGuestsForContact, insertInteraction, setContactOpStatus } from '@/lib/data/interactions';
import { getAccountInfo, startScenarios, VoximplantApiError, VoximplantNetworkError } from '@/lib/voximplant/core';
import { sendSlackAlert } from '@/lib/alerts/slack';
import type { OutreachCallRequest } from '@/lib/queue/queues';

const CID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CTID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HISTORY = 987654;

function job(o: Partial<OutreachCallRequest> = {}): OutreachCallRequest {
  return { campaignId: CID, eventId: EID, contactId: CTID, normalizedPhone: '+972501234567', scriptKey: 'rsvp_v1', touchpointIndex: 0, ...o };
}
const CONFIG = {
  auth: { accountId: 1, keyId: 'KEY_ID', privateKey: 'PRIVATE_KEY_SECRET' },
  ruleId: '1494311', callerId: '972500000000',
  callbackSecret: 'CALLBACK_SECRET', groqApiKey: 'GROQ_SECRET',
  lowBalanceThreshold: 5, minCallReserve: 0.1, maxConcurrentCalls: 5, maxCallsPerCampaignHour: 200,
};
const acct = (balance: number) => ({ result: { account_id: 1, account_name: 'x', account_email: 'x', active: true, currency: 'USD', balance, created: '' } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOutreachEnabled).mockResolvedValue(true);
  vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG as never);
  vi.mocked(getVoximplantLiveEnabled).mockReturnValue(true);
  vi.mocked(hasCallConsent).mockResolvedValue(true);
  vi.mocked(isDncListed).mockResolvedValue(false);
  vi.mocked(isContactReached).mockResolvedValue(false);
  vi.mocked(getCampaignContext).mockResolvedValue({ status: 'active', allowed_channels: ['call'] } as never);
  vi.mocked(getGuestsForContact).mockResolvedValue([{ id: 'g1', full_name: 'א', rsvp_token: 't1' }] as never);
  vi.mocked(getAccountInfo).mockResolvedValue(acct(50) as never);
  vi.mocked(createCallAttempt).mockResolvedValue({ id: AID });
  vi.mocked(getCallAttemptByTouchpoint).mockResolvedValue(null);
  vi.mocked(recordDialConfirmed).mockResolvedValue({ applied: true });
  vi.mocked(markFailedToStart).mockResolvedValue({ applied: true });
  vi.mocked(markStartUnknown).mockResolvedValue({ applied: true });
  vi.mocked(insertInteraction).mockResolvedValue(true);
  vi.mocked(setContactOpStatus).mockResolvedValue(undefined);
  vi.mocked(sendSlackAlert).mockResolvedValue(undefined);
  vi.mocked(startScenarios).mockResolvedValue({ result: 1, call_session_history_id: HISTORY } as never);
});

describe('gates (no dial)', () => {
  it('1. config null → blocked, no dial', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(null);
    expect((await dispatchOutreachCall(job())).kind).toBe('blocked');
    expect(startScenarios).not.toHaveBeenCalled();
  });
  it('2. live gate false (creds present) → blocked, no dial', async () => {
    vi.mocked(getVoximplantLiveEnabled).mockReturnValue(false);
    const r = await dispatchOutreachCall(job());
    expect(r).toEqual({ kind: 'blocked', reason: 'live_calls_disabled' });
    expect(getVoximplantConfig).toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
  });
  it('3. no consent → skipped', async () => {
    vi.mocked(hasCallConsent).mockResolvedValue(false);
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'skipped', reason: 'no_call_consent' });
    expect(startScenarios).not.toHaveBeenCalled();
  });
  it('4. DNC → skipped', async () => {
    vi.mocked(isDncListed).mockResolvedValue(true);
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'skipped', reason: 'dnc_listed' });
    expect(startScenarios).not.toHaveBeenCalled();
  });
  it('5. already reached → skipped', async () => {
    vi.mocked(isContactReached).mockResolvedValue(true);
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'skipped', reason: 'already_reached' });
    expect(startScenarios).not.toHaveBeenCalled();
  });
  it('6. campaign not active → skipped', async () => {
    vi.mocked(getCampaignContext).mockResolvedValue({ status: 'paused', allowed_channels: ['call'] } as never);
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'skipped', reason: 'campaign_not_active' });
    expect(startScenarios).not.toHaveBeenCalled();
  });
});

describe('guest binding', () => {
  it('7a. no guest → guestId null, still dials', async () => {
    vi.mocked(getGuestsForContact).mockResolvedValue([]);
    expect((await dispatchOutreachCall(job())).kind).toBe('dialed');
    expect(createCallAttempt).toHaveBeenCalledWith(expect.objectContaining({ guestId: null }));
  });
  it('7b. multiple guests → guestId null, still dials', async () => {
    vi.mocked(getGuestsForContact).mockResolvedValue([
      { id: 'g1', full_name: 'א', rsvp_token: 't1' }, { id: 'g2', full_name: 'ב', rsvp_token: 't2' },
    ] as never);
    expect((await dispatchOutreachCall(job())).kind).toBe('dialed');
    expect(createCallAttempt).toHaveBeenCalledWith(expect.objectContaining({ guestId: null }));
  });
});

describe('balance', () => {
  it('8. transport error → transient_error, no dial, no attempt', async () => {
    vi.mocked(getAccountInfo).mockRejectedValue(new VoximplantNetworkError('timeout'));
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'transient_error', reason: 'balance_check_failed' });
    expect(createCallAttempt).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
  });
  it('9. below reserve → blocked, NO interaction, Slack error', async () => {
    vi.mocked(getAccountInfo).mockResolvedValue(acct(0.05) as never);
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'blocked', reason: 'balance_below_reserve' });
    expect(createCallAttempt).not.toHaveBeenCalled();
    expect(insertInteraction).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
  it('10. warning (≥reserve, <low) → dials + warn', async () => {
    vi.mocked(getAccountInfo).mockResolvedValue(acct(2) as never);
    expect((await dispatchOutreachCall(job())).kind).toBe('dialed');
    expect(startScenarios).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });
});

describe('concurrency / reconcile', () => {
  it('11a. lost race, winner in-flight (pre-terminal, no history) → concurrent_owner, NO dial, NO status write', async () => {
    vi.mocked(createCallAttempt).mockResolvedValue(null);
    vi.mocked(getCallAttemptByTouchpoint).mockResolvedValue({ id: AID, status: 'dialing', vox_call_session_history_id: null } as never);
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'skipped', reason: 'concurrent_owner' });
    expect(startScenarios).not.toHaveBeenCalled();
    expect(markStartUnknown).not.toHaveBeenCalled(); // must NOT corrupt the winner
    expect(recordDialConfirmed).not.toHaveBeenCalled();
  });
  it('11b. lost race, winner already has history id → already_dispatched, completes bookkeeping, NO dial', async () => {
    vi.mocked(createCallAttempt).mockResolvedValue(null);
    vi.mocked(getCallAttemptByTouchpoint).mockResolvedValue({ id: AID, status: 'dialing', vox_call_session_history_id: String(HISTORY) } as never);
    const r = await dispatchOutreachCall(job());
    expect(r).toEqual({ kind: 'already_dispatched', attemptId: AID });
    expect(startScenarios).not.toHaveBeenCalled();
    expect(insertInteraction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'call_dialed', provider_id: String(HISTORY) }));
    expect(setContactOpStatus).toHaveBeenCalledWith(CTID, 'call_dialed');
  });
});

describe('provider outcomes', () => {
  it('12. VoximplantApiError → failed_to_start, non-retryable', async () => {
    vi.mocked(startScenarios).mockRejectedValue(new VoximplantApiError('rejected', 42));
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'failed_to_start', attemptId: AID, code: 42 });
    expect(markFailedToStart).toHaveBeenCalledWith(AID, 'rejected');
    expect(recordDialConfirmed).not.toHaveBeenCalled();
  });
  it('13. VoximplantNetworkError/timeout → start_unknown, no redial', async () => {
    vi.mocked(startScenarios).mockRejectedValue(new VoximplantNetworkError('timeout'));
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'start_unknown', attemptId: AID });
    expect(markStartUnknown).toHaveBeenCalledWith(AID, 'network_error_during_start');
    expect(recordDialConfirmed).not.toHaveBeenCalled();
  });
  it('14. result===1 without history id → start_unknown', async () => {
    vi.mocked(startScenarios).mockResolvedValue({ result: 1 } as never);
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'start_unknown', attemptId: AID });
    expect(recordDialConfirmed).not.toHaveBeenCalled();
  });
  it('15. full success → recordDialConfirmed + call_dialed(billable:false) + op_status', async () => {
    const r = await dispatchOutreachCall(job());
    expect(r).toEqual({ kind: 'dialed', attemptId: AID, callSessionHistoryId: HISTORY });
    expect(recordDialConfirmed).toHaveBeenCalledWith(AID, expect.objectContaining({ callSessionHistoryId: HISTORY }));
    expect(insertInteraction).toHaveBeenCalledWith(expect.objectContaining({ channel: 'call', kind: 'call_dialed', billable: false, provider_id: String(HISTORY) }));
    expect(setContactOpStatus).toHaveBeenCalledWith(CTID, 'call_dialed');
  });
  it('16. dial ok then interaction throws → dispatch throws; retry completes WITHOUT a second StartScenarios', async () => {
    vi.mocked(insertInteraction).mockRejectedValueOnce(new Error('db down'));
    await expect(dispatchOutreachCall(job())).rejects.toThrow();
    expect(startScenarios).toHaveBeenCalledTimes(1);
    expect(recordDialConfirmed).toHaveBeenCalledTimes(1);
    // retry: row already exists WITH the history id → reconcile, no second dial
    vi.mocked(createCallAttempt).mockResolvedValue(null);
    vi.mocked(getCallAttemptByTouchpoint).mockResolvedValue({ id: AID, status: 'dialing', vox_call_session_history_id: String(HISTORY) } as never);
    const r2 = await dispatchOutreachCall(job());
    expect(startScenarios).toHaveBeenCalledTimes(1); // STILL 1 — no re-dial
    expect(r2).toEqual({ kind: 'already_dispatched', attemptId: AID });
    expect(insertInteraction).toHaveBeenCalledTimes(2);
    expect(setContactOpStatus).toHaveBeenCalledWith(CTID, 'call_dialed');
  });
});

describe('payload hygiene', () => {
  it('17a. buildScriptCustomData: valid JSON + Buffer.byteLength(utf8)', () => {
    const { payload, bytes } = buildScriptCustomData({ to: '+972', from: '972', iid: AID, cb: 'https://x/cb/t', ctx: 'https://x/ctx/t', gk: 'GROQ_SECRET' });
    expect(() => JSON.parse(payload)).not.toThrow();
    expect(bytes).toBe(Buffer.byteLength(payload, 'utf8'));
  });
  it('17b. no secret (Groq/callbackSecret/privateKey) reaches Slack or console', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secrets = [CONFIG.groqApiKey, CONFIG.callbackSecret, CONFIG.auth.privateKey];
    const noSecret = (s: string) => secrets.forEach((sec) => expect(s).not.toContain(sec));
    try {
      await dispatchOutreachCall(job()); // success path: console.log {payloadBytes}
      vi.mocked(startScenarios).mockRejectedValue(new VoximplantApiError('x', 1));
      await dispatchOutreachCall(job()); // failed_to_start: Slack alert
      for (const call of vi.mocked(sendSlackAlert).mock.calls) {
        const a = call[0];
        noSecret(JSON.stringify(a));
        if (a.fields) for (const v of Object.values(a.fields)) expect(['string', 'number']).toContain(typeof v);
      }
      for (const spy of [logSpy, errSpy]) {
        for (const call of spy.mock.calls) noSecret(call.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
      }
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});
