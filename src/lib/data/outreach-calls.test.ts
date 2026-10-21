import { beforeEach, describe, expect, it, vi } from 'vitest';

// outreach-calls.ts begins with `import 'server-only'` — stub it (convention:
// call-result-processing.test.ts). Mock every collaborator so the pure control
// flow runs with no DB/provider.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/data/outreach-config', () => ({ getOutreachEnabled: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({
  getVoximplantConfig: vi.fn(),
}));
vi.mock('@/lib/data/call-attempts', () => ({
  createCallAttempt: vi.fn(),
  nextManualTouchpoint: vi.fn(),
  getCallAttemptByTouchpoint: vi.fn(),
  getCallAttemptByDispatchId: vi.fn(),
  recordDialConfirmed: vi.fn(),
  markFailedToStart: vi.fn(),
  markStartUnknown: vi.fn(),
  countCampaignCallsSince: vi.fn(),
}));
vi.mock('@/lib/data/voximplant-concurrency', () => ({
  countActiveCallsAllSurfaces: vi.fn(),
}));
vi.mock('@/lib/data/outreach-engine', () => ({
  getCampaignContext: vi.fn(),
  hasCallConsent: vi.fn(),
  isContactReached: vi.fn(),
  isDncListed: vi.fn(),
}));
// Contact-quota seat gate (4a). Defaulted to "allowed" in beforeEach so every pre-existing test
// exercises its own gate undisturbed; the gate's own behaviour has dedicated tests below.
vi.mock('@/lib/data/contact-quota', () => ({ checkContactSeat: vi.fn() }));
vi.mock('@/lib/data/interactions', () => ({
  getGuestsForContact: vi.fn(),
  insertInteraction: vi.fn(),
  setContactOpStatus: vi.fn(),
}));
vi.mock('@/lib/data/console-calls', () => ({
  findRoutableAgentVoxUsernames: vi.fn(),
  consoleDtmfHandoffEnabled: vi.fn(),
  isWithinHumanCallWindow: vi.fn(),
  nextHumanCallWindowStart: vi.fn(),
}));
// Dial-hours policy read (gate 3b). Mocked so beforeEach can default every test
// to "inside the window" — the gate's own behaviour gets dedicated tests below.
vi.mock('@/lib/callbacks/policy-config', () => ({ getCallbackPolicy: vi.fn() }));
// startScenarios lives in the separated mutations module.
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
vi.mock('@/lib/url', () => ({ getAppOrigin: vi.fn(async () => 'https://beta.kalfa.me') }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { dispatchOutreachCall, buildScriptCustomData } from './outreach-calls';
import { getOutreachEnabled } from '@/lib/data/outreach-config';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import {
  createCallAttempt,
  nextManualTouchpoint,
  getCallAttemptByTouchpoint,
  getCallAttemptByDispatchId,
  recordDialConfirmed,
  markFailedToStart,
  markStartUnknown,
  countCampaignCallsSince,
} from '@/lib/data/call-attempts';
import { countActiveCallsAllSurfaces } from '@/lib/data/voximplant-concurrency';
import {
  getCampaignContext,
  hasCallConsent,
  isContactReached,
  isDncListed,
} from '@/lib/data/outreach-engine';
import { getGuestsForContact, insertInteraction, setContactOpStatus } from '@/lib/data/interactions';
import { checkContactSeat } from '@/lib/data/contact-quota';
import {
  findRoutableAgentVoxUsernames,
  consoleDtmfHandoffEnabled,
  isWithinHumanCallWindow,
  nextHumanCallWindowStart,
} from '@/lib/data/console-calls';
import { getCallbackPolicy } from '@/lib/callbacks/policy-config';
// Deliberately NOT mocked: gate 4b must be exercised against the same shared L1
// date rule the DB guard mirrors, not a stub that could agree with a wrong gate.
import { todayIL } from '@/lib/data/event-date';
import { getAccountInfo, VoximplantApiError, VoximplantNetworkError } from '@/lib/voximplant/core';
import { startScenarios } from '@/lib/voximplant/mutations';
import { sendSlackAlert } from '@/lib/alerts/slack';
import { getAppOrigin } from '@/lib/url';
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
  callbackSecret: 'CALLBACK_SECRET',
  lowBalanceThreshold: 5, minCallReserve: 0.1, maxConcurrentCalls: 5, maxCallsPerCampaignHour: 200,
  liveCallsEnabled: true,
};
const acct = (balance: number) => ({ result: { account_id: 1, account_name: 'x', account_email: 'x', active: true, currency: 'USD', balance, created: '' } });

// A dial-able campaign. The event fields are REAL here, not omitted: gate 4b
// reads eventStatus/eventDate/rsvpDeadline, and a partial mock would have let a
// dial through on undefined. Far-future date so the suite never expires.
const CCTX = {
  status: 'active',
  allowed_channels: ['call'],
  eventStatus: 'active',
  eventDate: '2099-06-01T18:00:00+03:00',
  rsvpDeadline: null,
};

// What the (mocked) next-open-instant search answers; its own behaviour is pinned in console-calls.test.ts.
const NEXT_WINDOW_MS = Date.parse('2026-11-02T08:00:00+02:00');

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getOutreachEnabled).mockResolvedValue(true);
  // Gate 3b defaults: policy read succeeds and the clock is inside the window,
  // so every pre-existing test exercises its own gate undisturbed.
  vi.mocked(getCallbackPolicy).mockResolvedValue({ dialWeekday: [] } as never);
  vi.mocked(isWithinHumanCallWindow).mockReturnValue(true);
  vi.mocked(nextHumanCallWindowStart).mockReturnValue(NEXT_WINDOW_MS);
  vi.mocked(getVoximplantConfig).mockResolvedValue(CONFIG as never);
  vi.mocked(hasCallConsent).mockResolvedValue(true);
  vi.mocked(isDncListed).mockResolvedValue(false);
  vi.mocked(isContactReached).mockResolvedValue(false);
  vi.mocked(checkContactSeat).mockResolvedValue({ allowed: true });
  vi.mocked(getCampaignContext).mockResolvedValue(CCTX as never);
  vi.mocked(getGuestsForContact).mockResolvedValue([{ id: 'g1', full_name: 'א', rsvp_token: 't1' }] as never);
  vi.mocked(getAccountInfo).mockResolvedValue(acct(50) as never);
  vi.mocked(createCallAttempt).mockResolvedValue({ id: AID });
  vi.mocked(nextManualTouchpoint).mockResolvedValue(100001);
  vi.mocked(getCallAttemptByTouchpoint).mockResolvedValue(null);
  vi.mocked(getCallAttemptByDispatchId).mockResolvedValue(null);
  vi.mocked(countActiveCallsAllSurfaces).mockResolvedValue(0);
  vi.mocked(countCampaignCallsSince).mockResolvedValue(0);
  vi.mocked(recordDialConfirmed).mockResolvedValue({ applied: true });
  vi.mocked(markFailedToStart).mockResolvedValue({ applied: true });
  vi.mocked(markStartUnknown).mockResolvedValue({ applied: true });
  vi.mocked(insertInteraction).mockResolvedValue(true);
  vi.mocked(setContactOpStatus).mockResolvedValue(undefined);
  vi.mocked(sendSlackAlert).mockResolvedValue(null);
  vi.mocked(startScenarios).mockResolvedValue({ result: 1, call_session_history_id: HISTORY } as never);
  vi.mocked(findRoutableAgentVoxUsernames).mockResolvedValue([]);
  vi.mocked(consoleDtmfHandoffEnabled).mockResolvedValue(false);
});

describe('gates (no dial)', () => {
  it('outside the dial window → deferred to the next open instant, before any attempt row or API call', async () => {
    vi.mocked(isWithinHumanCallWindow).mockReturnValue(false);
    const res = await dispatchOutreachCall(job());
    expect(res).toEqual({ kind: 'deferred', reason: 'outside_dial_window', notBeforeMs: NEXT_WINDOW_MS });
    expect(createCallAttempt).not.toHaveBeenCalled();
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
    // The gate consults the ADMIN policy (/admin/callbacks/policy), not a default, and so does the next-instant search.
    expect(getCallbackPolicy).toHaveBeenCalled();
    expect(nextHumanCallWindowStart).toHaveBeenCalledWith(expect.any(Number), []);
  });

  it('outside the window with no open instant ahead → still deferred, with a null instant for the worker to settle loudly', async () => {
    vi.mocked(isWithinHumanCallWindow).mockReturnValue(false);
    vi.mocked(nextHumanCallWindowStart).mockReturnValue(null);
    const res = await dispatchOutreachCall(job());
    expect(res).toEqual({ kind: 'deferred', reason: 'outside_dial_window', notBeforeMs: null });
    expect(createCallAttempt).not.toHaveBeenCalled();
  });

  it('the dial-window gate also covers callbacks — isCallback exempts only already_reached', async () => {
    vi.mocked(isWithinHumanCallWindow).mockReturnValue(false);
    const res = await dispatchOutreachCall(job({ isCallback: true }));
    expect(res).toEqual({ kind: 'deferred', reason: 'outside_dial_window', notBeforeMs: NEXT_WINDOW_MS });
    expect(createCallAttempt).not.toHaveBeenCalled();
  });

  it('a manual console dial outside the window is refused as before, never rescheduled', async () => {
    vi.mocked(isWithinHumanCallWindow).mockReturnValue(false);
    const res = await dispatchOutreachCall(job({ isManual: true }));
    expect(res).toEqual({ kind: 'skipped', reason: 'outside_dial_window' });
    expect(nextHumanCallWindowStart).not.toHaveBeenCalled();
    expect(createCallAttempt).not.toHaveBeenCalled();
  });

  it('4a. campaign has a quota and the contact holds no seat → skipped/waiting_for_quota, nothing is dialled', async () => {
    vi.mocked(checkContactSeat).mockResolvedValue({ allowed: false, reason: 'waiting_for_quota' });
    const res = await dispatchOutreachCall(job());
    expect(res).toEqual({ kind: 'skipped', reason: 'waiting_for_quota' });
    expect(checkContactSeat).toHaveBeenCalledWith(CID, CTID);
    // Refused before any attempt row, balance read or provider call.
    expect(createCallAttempt).not.toHaveBeenCalled();
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('4a. a callback the guest asked for is exempt from the seat gate (owner decision 2026-10-04)', async () => {
    vi.mocked(checkContactSeat).mockResolvedValue({ allowed: false, reason: 'waiting_for_quota' });
    const res = await dispatchOutreachCall(job({ isCallback: true }));
    expect(checkContactSeat).not.toHaveBeenCalled();
    expect(res.kind).toBe('dialed');
  });

  it('4a. the seat gate does not outrank an inactive campaign (that refusal comes first)', async () => {
    vi.mocked(getCampaignContext).mockResolvedValue({ ...CCTX, status: 'paused' } as never);
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'skipped', reason: 'campaign_not_active' });
    expect(checkContactSeat).not.toHaveBeenCalled();
  });

  it('4a. a read error in the seat check propagates (the job retries; it is not silently allowed)', async () => {
    vi.mocked(checkContactSeat).mockRejectedValue(new Error('בדיקת מכסת אנשי הקשר נכשלה'));
    await expect(dispatchOutreachCall(job())).rejects.toThrow('בדיקת מכסת אנשי הקשר נכשלה');
    expect(startScenarios).not.toHaveBeenCalled();
  });

  it('1. config null → blocked, no dial', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(null);
    expect((await dispatchOutreachCall(job())).kind).toBe('blocked');
    expect(startScenarios).not.toHaveBeenCalled();
  });
  it('2. live gate false (creds present) → blocked, no dial', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue({
      ...CONFIG,
      liveCallsEnabled: false,
    } as never);
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
  it('5b. already reached + isCallback → DIALS (the sole exemption, spec test 5)', async () => {
    // A guest-requested callback is the SAME billable reach continuing (owner
    // decision 2026-07-21) — one of only two gates it skips (the other is the
    // contact-quota seat, 4a). Without this case nothing
    // pinned the exemption; a refactor dropping `!job.isCallback` would have
    // passed the whole suite while silently killing every callback.
    vi.mocked(isContactReached).mockResolvedValue(true);
    const r = await dispatchOutreachCall(job({ isCallback: true }));
    expect(r.kind).toBe('dialed');
    expect(startScenarios).toHaveBeenCalledTimes(1);
  });
  it('5c. already reached blocks a MANUAL job too — no operator override exists ([D3] CLOSED)', async () => {
    vi.mocked(isContactReached).mockResolvedValue(true);
    expect(await dispatchOutreachCall(job({ isManual: true, dispatchId: 'd' }))).toEqual({
      kind: 'skipped',
      reason: 'already_reached',
    });
    expect(startScenarios).not.toHaveBeenCalled();
  });
  it('6. campaign not active → skipped', async () => {
    vi.mocked(getCampaignContext).mockResolvedValue({ ...CCTX, status: 'paused' } as never);
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'skipped', reason: 'campaign_not_active' });
    expect(startScenarios).not.toHaveBeenCalled();
  });
});

// Gate 4b — never dial a call whose answer submit_rsvp would refuse. Each case
// below is one of that RPC's three event-level refusals; a dial here costs
// telephony + agent minutes AND bills the owner for a reached contact, so the
// assertion that matters is `startScenarios` never being called.
describe('event can still record an RSVP (gate 4b)', () => {
  const expectSkipped = async () => {
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'skipped', reason: 'event_closed' });
    expect(startScenarios).not.toHaveBeenCalled();
    expect(createCallAttempt).not.toHaveBeenCalled(); // refused before any row exists
  };

  it('6a. past event day → skipped (submit_rsvp would answer "closed")', async () => {
    vi.mocked(getCampaignContext).mockResolvedValue(
      { ...CCTX, eventDate: '2020-01-01T18:00:00+02:00' } as never,
    );
    await expectSkipped();
  });

  it('6b. event not active → skipped', async () => {
    vi.mocked(getCampaignContext).mockResolvedValue({ ...CCTX, eventStatus: 'draft' } as never);
    await expectSkipped();
  });

  it('6c. rsvp_deadline passed → skipped ("deadline_passed"), though the event is still future', async () => {
    vi.mocked(getCampaignContext).mockResolvedValue(
      { ...CCTX, rsvpDeadline: '2020-01-01' } as never,
    );
    await expectSkipped();
  });

  it('6d. deadline TODAY is still open — the DB gate is strictly greater-than', async () => {
    vi.mocked(getCampaignContext).mockResolvedValue(
      { ...CCTX, rsvpDeadline: todayIL() } as never,
    );
    expect((await dispatchOutreachCall(job())).kind).toBe('dialed');
  });

  it('6e. no deadline set → dials', async () => {
    expect((await dispatchOutreachCall(job())).kind).toBe('dialed');
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
  it('9. below reserve → a scheduled dial is deferred, NO interaction, Slack error on the first delivery', async () => {
    vi.mocked(getAccountInfo).mockResolvedValue(acct(0.05) as never);
    const res = await dispatchOutreachCall(job());
    expect(res).toMatchObject({ kind: 'deferred', reason: 'balance_below_reserve' });
    expect((res as { notBeforeMs: number }).notBeforeMs).toBeGreaterThan(Date.now());
    expect(createCallAttempt).not.toHaveBeenCalled();
    expect(insertInteraction).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }));
  });
  it('9b. below reserve on a deferred delivery → deferred again, and no second alert', async () => {
    vi.mocked(getAccountInfo).mockResolvedValue(acct(0.05) as never);
    const res = await dispatchOutreachCall(job({ dispatchWaits: 3 }));
    expect(res).toMatchObject({ kind: 'deferred', reason: 'balance_below_reserve' });
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
  it('9c. below reserve on a manual dial → still blocked and reported, never rescheduled', async () => {
    vi.mocked(getAccountInfo).mockResolvedValue(acct(0.05) as never);
    expect(await dispatchOutreachCall(job({ isManual: true }))).toEqual({ kind: 'blocked', reason: 'balance_below_reserve' });
    expect(createCallAttempt).not.toHaveBeenCalled();
  });
  it('10. warning (≥reserve, <low) → dials + warn', async () => {
    vi.mocked(getAccountInfo).mockResolvedValue(acct(2) as never);
    expect((await dispatchOutreachCall(job())).kind).toBe('dialed');
    expect(startScenarios).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });
});

describe('rate-limit caps (H1)', () => {
  it('R1. at/over concurrency cap → a scheduled dial is deferred, no attempt, no dial, warn on the first delivery', async () => {
    vi.mocked(countActiveCallsAllSurfaces).mockResolvedValue(5); // == cap
    const res = await dispatchOutreachCall(job());
    expect(res).toMatchObject({ kind: 'deferred', reason: 'max_concurrency' });
    expect((res as { notBeforeMs: number }).notBeforeMs).toBeGreaterThan(Date.now());
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(createCallAttempt).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ level: 'warn' }));
  });
  it('R1b. at the concurrency cap on a deferred delivery → deferred again, no second alert', async () => {
    vi.mocked(countActiveCallsAllSurfaces).mockResolvedValue(5);
    expect(await dispatchOutreachCall(job({ dispatchWaits: 2 }))).toMatchObject({ kind: 'deferred', reason: 'max_concurrency' });
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
  it('R1c. at the concurrency cap on a manual dial → still skipped and reported', async () => {
    vi.mocked(countActiveCallsAllSurfaces).mockResolvedValue(5);
    expect(await dispatchOutreachCall(job({ isManual: true }))).toEqual({ kind: 'skipped', reason: 'max_concurrency' });
  });
  it('R2. at/over per-campaign hourly cap → a scheduled dial is deferred, no attempt, no dial', async () => {
    vi.mocked(countCampaignCallsSince).mockResolvedValue(200); // == cap
    const res = await dispatchOutreachCall(job());
    expect(res).toMatchObject({ kind: 'deferred', reason: 'campaign_hour_cap' });
    expect((res as { notBeforeMs: number }).notBeforeMs).toBeGreaterThan(Date.now());
    expect(getAccountInfo).not.toHaveBeenCalled();
    expect(createCallAttempt).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
  });
  it('R2b. at the hourly cap on a manual dial → still skipped and reported', async () => {
    vi.mocked(countCampaignCallsSince).mockResolvedValue(200);
    expect(await dispatchOutreachCall(job({ isManual: true }))).toEqual({ kind: 'skipped', reason: 'campaign_hour_cap' });
  });
  it('R3. under both caps → dials normally', async () => {
    vi.mocked(countActiveCallsAllSurfaces).mockResolvedValue(4);
    vi.mocked(countCampaignCallsSince).mockResolvedValue(199);
    expect((await dispatchOutreachCall(job())).kind).toBe('dialed');
    expect(startScenarios).toHaveBeenCalledTimes(1);
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
  it('11c. reach written BETWEEN two worker runs → first dialed, second skipped/already_reached (spec test 4, serial)', async () => {
    // SERIAL scenario, deliberately: the route preflight passed for both taps
    // (contact not reached yet), worker run #1 dials and the call completes
    // (billed_results row appears), worker run #2 — processed after — finds
    // the contact reached and stops. This pins the execution-time re-check
    // that closes the gap AFTER the route already answered 202.
    //
    // It does NOT prove atomic locking of two truly-simultaneous dispatches —
    // that guarantee lives in UNIQUE(campaign,contact,touchpoint) + the
    // reconcile path (cases 11a/11b) and billed_results UNIQUE(event,contact),
    // and true concurrency is exercised only in the OUTREACH_DB_IT-gated
    // integration suites against a real database.
    const first = await dispatchOutreachCall(job({ isManual: true, dispatchId: 'd1' }));
    expect(first.kind).toBe('dialed');

    vi.mocked(isContactReached).mockResolvedValue(true); // the reach landed
    const second = await dispatchOutreachCall(job({ isManual: true, dispatchId: 'd2' }));
    expect(second).toEqual({ kind: 'skipped', reason: 'already_reached' });

    expect(startScenarios).toHaveBeenCalledTimes(1); // one call rang, once
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
  it('15b. BOTH media handles are persisted, https included', async () => {
    // The HTTPS handle is what a live-session command channel must use: the plain
    // one is http:// to a media server by raw IP, so its access token — which can
    // terminate a guest's call — would cross the internet in cleartext.
    vi.mocked(startScenarios).mockResolvedValue({
      result: 1,
      call_session_history_id: HISTORY,
      media_session_access_url: 'http://10.0.0.1:12092/request/s/tok',
      media_session_access_secure_url: 'https://media.example/request/s/tok',
    } as never);
    await dispatchOutreachCall(job());
    expect(recordDialConfirmed).toHaveBeenCalledWith(AID, {
      callSessionHistoryId: HISTORY,
      mediaSessionAccessUrl: 'http://10.0.0.1:12092/request/s/tok',
      mediaSessionAccessSecureUrl: 'https://media.example/request/s/tok',
    });
  });
  it('15c. a provider response without the https handle stores null, not undefined', async () => {
    vi.mocked(startScenarios).mockResolvedValue({
      result: 1,
      call_session_history_id: HISTORY,
      media_session_access_url: 'http://10.0.0.1:12092/request/s/tok',
    } as never);
    await dispatchOutreachCall(job());
    expect(recordDialConfirmed).toHaveBeenCalledWith(
      AID,
      expect.objectContaining({ mediaSessionAccessSecureUrl: null }),
    );
  });
  it('16. dial ok then interaction throws → still dialed + warn alert (no redelivery); retry completes WITHOUT a second StartScenarios', async () => {
    // The call HAS been placed, so a bookkeeping failure must not escape: a throw
    // would make pg-boss redeliver the job. It is alerted instead, and a later
    // delivery completes the bookkeeping through the reconcile path.
    vi.mocked(insertInteraction).mockRejectedValueOnce(new Error('db down'));
    expect(await dispatchOutreachCall(job())).toEqual({ kind: 'dialed', attemptId: AID, callSessionHistoryId: HISTORY });
    expect(startScenarios).toHaveBeenCalledTimes(1);
    expect(recordDialConfirmed).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warn', title: 'Voximplant dial confirmed but bookkeeping failed' }),
    );
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

describe('manual-dial redelivery — attempt looked up by dispatch_id', () => {
  // A manual dial takes a NEW touchpoint index on every delivery, so the
  // touchpoint UNIQUE cannot catch a pg-boss redelivery of the same job. The
  // attempt is found by the dispatch_id instead, and reconciled — never redialled.
  it('19a. prior attempt with a confirmed start → already_dispatched, bookkeeping completed, no dial', async () => {
    vi.mocked(getCallAttemptByDispatchId).mockResolvedValue({ id: AID, status: 'dialing', vox_call_session_history_id: String(HISTORY) } as never);
    const r = await dispatchOutreachCall(job({ isManual: true, dispatchId: 'd1' }));
    expect(r).toEqual({ kind: 'already_dispatched', attemptId: AID });
    expect(getCallAttemptByDispatchId).toHaveBeenCalledWith('d1');
    expect(startScenarios).not.toHaveBeenCalled();
    expect(createCallAttempt).not.toHaveBeenCalled();
    expect(nextManualTouchpoint).not.toHaveBeenCalled();
    expect(setContactOpStatus).toHaveBeenCalledWith(CTID, 'call_dialed');
  });
  it('19b. prior attempt still in flight (no history id) → skipped/concurrent_owner, status untouched, no dial', async () => {
    vi.mocked(getCallAttemptByDispatchId).mockResolvedValue({ id: AID, status: 'dialing', vox_call_session_history_id: null } as never);
    expect(await dispatchOutreachCall(job({ isManual: true, dispatchId: 'd1' }))).toEqual({ kind: 'skipped', reason: 'concurrent_owner' });
    expect(startScenarios).not.toHaveBeenCalled();
    expect(markFailedToStart).not.toHaveBeenCalled();
    expect(markStartUnknown).not.toHaveBeenCalled();
  });
  it('19c. prior attempt already concluded → already_concluded, no dial', async () => {
    vi.mocked(getCallAttemptByDispatchId).mockResolvedValue({ id: AID, status: 'failed_to_start', vox_call_session_history_id: null } as never);
    expect(await dispatchOutreachCall(job({ isManual: true, dispatchId: 'd1' }))).toEqual({
      kind: 'already_concluded',
      attemptId: AID,
      status: 'failed_to_start',
    });
    expect(startScenarios).not.toHaveBeenCalled();
  });
  it('19d. no prior attempt for the dispatch_id → the manual dial proceeds normally', async () => {
    const r = await dispatchOutreachCall(job({ isManual: true, dispatchId: 'd1' }));
    expect(r.kind).toBe('dialed');
    expect(startScenarios).toHaveBeenCalledTimes(1);
  });
  it('19e. a non-manual job never consults the dispatch_id lookup', async () => {
    await dispatchOutreachCall(job({ dispatchId: 'd1' }));
    expect(getCallAttemptByDispatchId).not.toHaveBeenCalled();
  });
  it('19f. a pre-dial input read failing (app origin) throws BEFORE an attempt row exists', async () => {
    // 6b: everything that can fail before the dial is resolved before the row is
    // created, so a failure here can never strand a created 'queued' row.
    vi.mocked(getAppOrigin).mockRejectedValueOnce(new Error('settings down'));
    await expect(dispatchOutreachCall(job())).rejects.toThrow('settings down');
    expect(createCallAttempt).not.toHaveBeenCalled();
    expect(startScenarios).not.toHaveBeenCalled();
  });
});

describe('Stage 6 — DTMF handoff wiring into the dispatched customData', () => {
  it('18a. routable agent + flag ON → script_custom_data carries ca=<vox_username> and dh="1"', async () => {
    vi.mocked(findRoutableAgentVoxUsernames).mockResolvedValue(['agent_1bbe74dc-90b8-4e3a-9c11-abcdef123456']);
    vi.mocked(consoleDtmfHandoffEnabled).mockResolvedValue(true);
    await dispatchOutreachCall(job());
    const call = vi.mocked(startScenarios).mock.calls[0];
    const sent = JSON.parse((call?.[1] as { script_custom_data: string }).script_custom_data);
    expect(sent.ca).toBe('agent_1bbe74dc-90b8-4e3a-9c11-abcdef123456');
    expect(sent.dh).toBe('1');
  });

  it('18b. no routable agent (flag ON anyway) → ca:"" — attachSupervisor\'s own guard makes this a safe no-op', async () => {
    vi.mocked(findRoutableAgentVoxUsernames).mockResolvedValue([]);
    vi.mocked(consoleDtmfHandoffEnabled).mockResolvedValue(true);
    await dispatchOutreachCall(job());
    const call = vi.mocked(startScenarios).mock.calls[0];
    const sent = JSON.parse((call?.[1] as { script_custom_data: string }).script_custom_data);
    expect(sent.ca).toBe('');
    expect(sent.dh).toBe('1');
  });

  it('18c. flag OFF (default) → dh omitted entirely, regardless of agent availability', async () => {
    vi.mocked(findRoutableAgentVoxUsernames).mockResolvedValue(['agent_1bbe74dc-90b8-4e3a-9c11-abcdef123456']);
    vi.mocked(consoleDtmfHandoffEnabled).mockResolvedValue(false);
    await dispatchOutreachCall(job());
    const call = vi.mocked(startScenarios).mock.calls[0];
    const sent = JSON.parse((call?.[1] as { script_custom_data: string }).script_custom_data);
    expect(sent).not.toHaveProperty('dh');
  });
});

describe('payload hygiene', () => {
  it('17a. buildScriptCustomData: valid JSON + Buffer.byteLength(utf8)', () => {
    const { payload, bytes } = buildScriptCustomData({ to: '+972', from: '972', tok: '0123456789abcdef0123456789abcdef', u: 'https://beta.kalfa.me' });
    expect(() => JSON.parse(payload)).not.toThrow();
    expect(bytes).toBe(Buffer.byteLength(payload, 'utf8'));
    expect(bytes).toBeLessThan(200); // well under the VoxEngine.customData() 200-byte cap
    expect(payload).not.toMatch(/SECRET|KEY/i); // no credential of any kind in the payload
    // ca defaults to '' when no agent is passed — always present (never omitted),
    // matching "the first routable agent's vox_username, or ''".
    expect(JSON.parse(payload)).toMatchObject({ ca: '' });
    expect(JSON.parse(payload)).not.toHaveProperty('dh'); // omitted when the flag is off
  });

  it('17c. Stage 6 HARD CONSTRAINT: realistic worst-case values stay ≤200 bytes with the compact ca/dh keys', () => {
    // Realistic maxima, not best-case: full E.164 numbers, a full 32-hex-char
    // access token (randomBytes(16).toString('hex') — the actual format
    // dispatchOutreachCall generates), the beta app origin, and a
    // console_agent_username in the REAL provisioned shape ('agent_' + a
    // uuid — provisionConsoleAgentVoxUser's format, console-agent-provisioning.ts).
    const { payload, bytes } = buildScriptCustomData({
      to: '+972501234567',
      from: '+972529998888',
      tok: '793964fbb522d1a2f8e78e40f0cef8eb', // 32 hex chars
      u: 'https://beta.kalfa.me',
      consoleAgentUsername: 'agent_1bbe74dc-90b8-4e3a-9c11-abcdef123456',
      dtmfHandoffEnabled: true,
    });
    expect(() => JSON.parse(payload)).not.toThrow();
    expect(bytes).toBe(Buffer.byteLength(payload, 'utf8'));
    expect(bytes).toBeLessThanOrEqual(200); // VoxEngine.customData()'s hard cap
    expect(JSON.parse(payload)).toMatchObject({ dh: '1' });
  });

  it('17d. no routable agent + flag off → ca:"" and dh omitted (both are safe no-ops in the scenario)', () => {
    const { payload } = buildScriptCustomData({
      to: '+972501234567',
      from: '+972529998888',
      tok: '793964fbb522d1a2f8e78e40f0cef8eb',
      u: 'https://beta.kalfa.me',
      consoleAgentUsername: '',
      dtmfHandoffEnabled: false,
    });
    const parsed = JSON.parse(payload);
    expect(parsed.ca).toBe('');
    expect(parsed).not.toHaveProperty('dh');
  });
  it('17b. no secret (callbackSecret/privateKey) reaches Slack or console', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const secrets = [CONFIG.callbackSecret, CONFIG.auth.privateKey];
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
