import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/data/console-calls', () => ({
  CALL_ME_NOW_DAILY_CALL_CAP: 100,
  CALL_ME_NOW_DAILY_SPEND_CAP_USD: 5,
  CALL_ME_NOW_MAX_CONCURRENCY: 2,
  INBOUND_ESTIMATED_COST_PER_CALL_USD: 0.06,
  computeRingOrder: vi.fn(() => []),
  consoleCallMeNowEnabled: vi.fn(),
  countAnsweredCallMeNowToday: vi.fn(),
  countConcurrentAnsweredCallMeNow: vi.fn(),
  findRoutableAgentVoxUsernames: vi.fn(),
  linkConsoleCallSession: vi.fn(),
  updateConsoleCallStatus: vi.fn(),
  verifyDialToken: vi.fn(),
}));
vi.mock('@/lib/data/voximplant-balance-cache', () => ({
  checkInboundBalanceReserve: vi.fn(),
}));
vi.mock('@/lib/data/voximplant-config', () => ({
  getVoximplantConfig: vi.fn(),
}));

import { POST } from './route';
import {
  consoleCallMeNowEnabled,
  countAnsweredCallMeNowToday,
  countConcurrentAnsweredCallMeNow,
  findRoutableAgentVoxUsernames,
  linkConsoleCallSession,
  verifyDialToken,
} from '@/lib/data/console-calls';
import { checkInboundBalanceReserve } from '@/lib/data/voximplant-balance-cache';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';

const SECRET = 'test-console-secret';
const TOKEN = 'cn' + 'a'.repeat(64);

function req(body: unknown): Request {
  return new Request('https://beta.kalfa.me/api/voximplant/console/call-me-now-authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function admitAllCaps() {
  vi.mocked(consoleCallMeNowEnabled).mockResolvedValue(true);
  vi.mocked(getVoximplantConfig).mockResolvedValue({ liveCallsEnabled: true } as never);
  vi.mocked(countConcurrentAnsweredCallMeNow).mockResolvedValue(0);
  vi.mocked(countAnsweredCallMeNowToday).mockResolvedValue(0);
  vi.mocked(checkInboundBalanceReserve).mockResolvedValue({ ok: true } as never);
  vi.mocked(findRoutableAgentVoxUsernames).mockResolvedValue([]);
}

// Full telephony audit, 13.8: linkConsoleCallSession lets this route
// correlate the session to its console_calls row DIRECTLY, independent of
// whether ConsoleCallMeNow's own 'started' /event report lands — MORE
// load-bearing here than authorize/route.ts's 'ct' twin because this call
// kind's later events have NO fallback tier at all once 'started' is lost
// (see console-calls.ts's linkConsoleCallSession header).
describe('POST /api/voximplant/console/call-me-now-authorize', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.KALFA_CONSOLE_SECRET = SECRET;
  });

  // session_id is OPTIONAL on purpose (expand-then-contract): the scenario
  // that sends it deploys via voxengine-ci and this route via the Next deploy,
  // and the two cannot be made atomic. Requiring it would 400 every live call
  // placed by the still-old scenario during the gap — on the one customer-
  // facing flow of the three. This test pins the ACCEPTANCE, so a future
  // "cleanup" to required has to delete it deliberately rather than drift into
  // breaking a deploy window.
  it('accepts a body with no session_id and simply skips the link (deploy-window safety)', async () => {
    vi.mocked(verifyDialToken).mockResolvedValue({ ok: true, callId: 'call-1', phone: '+972500000000' });
    admitAllCaps();

    const res = await POST(req({ secret: SECRET, token: TOKEN }));

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(linkConsoleCallSession).not.toHaveBeenCalled();
  });

  it('links the session BEFORE any caps check, even when a cap then refuses', async () => {
    vi.mocked(verifyDialToken).mockResolvedValue({ ok: true, callId: 'call-1', phone: '+972500000000' });
    admitAllCaps();
    vi.mocked(consoleCallMeNowEnabled).mockResolvedValue(false); // flag off -> refused

    const res = await POST(req({ secret: SECRET, token: TOKEN, session_id: 42 }));

    expect(await res.json()).toEqual({ ok: false });
    expect(linkConsoleCallSession).toHaveBeenCalledWith('call-1', 42);
  });

  it('a failed link never blocks the ring (best-effort)', async () => {
    vi.mocked(verifyDialToken).mockResolvedValue({ ok: true, callId: 'call-1', phone: '+972500000000' });
    vi.mocked(linkConsoleCallSession).mockRejectedValue(new Error('db down'));
    admitAllCaps();

    const res = await POST(req({ secret: SECRET, token: TOKEN, session_id: 1 }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; call_id?: string };
    expect(body.ok).toBe(true);
    expect(body.call_id).toBe('call-1');
  });

  it('does not link when the token itself fails to verify', async () => {
    vi.mocked(verifyDialToken).mockResolvedValue({ ok: false, reason: 'expired' });

    await POST(req({ secret: SECRET, token: TOKEN, session_id: 1 }));

    expect(linkConsoleCallSession).not.toHaveBeenCalled();
  });
});
