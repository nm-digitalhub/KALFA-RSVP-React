import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/data/console-calls', () => ({
  linkConsoleCallSession: vi.fn(),
  updateConsoleCallStatus: vi.fn(),
  verifyDialToken: vi.fn(),
}));
vi.mock('@/lib/data/voximplant-config', () => ({
  getVoximplantConfig: vi.fn(),
}));

import { POST } from './route';
import { linkConsoleCallSession, updateConsoleCallStatus, verifyDialToken } from '@/lib/data/console-calls';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';

const SECRET = 'test-console-secret';
const TOKEN = 'ct' + 'a'.repeat(64);

function req(body: unknown): Request {
  return new Request('https://beta.kalfa.me/api/voximplant/console/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Full telephony audit, 13.8: linkConsoleCallSession lets this route
// correlate the session to its console_calls row DIRECTLY (from the token
// verifyDialToken already resolved, plus session_id the scenario now sends),
// independent of whether ConsoleDial's own 'started' /event report lands.
// See console-calls.ts's linkConsoleCallSession header for the full
// reasoning this closes.
describe('POST /api/voximplant/console/authorize', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.KALFA_CONSOLE_SECRET = SECRET;
  });

  // session_id is OPTIONAL on purpose (expand-then-contract) — the scenario
  // that sends it ships via voxengine-ci and this route via the Next deploy,
  // and the two cannot be atomic. Requiring it would 400 every call placed by
  // the still-old scenario during the gap. This pins the ACCEPTANCE so a later
  // tightening to required has to be a deliberate deletion, not a drift.
  it('accepts a body with no session_id and simply skips the link (deploy-window safety)', async () => {
    vi.mocked(verifyDialToken).mockResolvedValue({ ok: true, callId: 'call-1', phone: '+972500000000', kind: 'manual' });
    vi.mocked(getVoximplantConfig).mockResolvedValue({ liveCallsEnabled: false } as never);

    const res = await POST(req({ secret: SECRET, token: TOKEN }));

    expect(await res.json()).toEqual({ ok: false });
    expect(linkConsoleCallSession).not.toHaveBeenCalled();
  });

  it('links the session BEFORE the live-calls gate, even when that gate then refuses', async () => {
    vi.mocked(verifyDialToken).mockResolvedValue({ ok: true, callId: 'call-1', phone: '+972500000000', kind: 'manual' });
    vi.mocked(getVoximplantConfig).mockResolvedValue({ liveCallsEnabled: false } as never);

    const res = await POST(req({ secret: SECRET, token: TOKEN, session_id: 777 }));

    expect(await res.json()).toEqual({ ok: false });
    expect(linkConsoleCallSession).toHaveBeenCalledWith('call-1', 777);
    // The link call must happen even though the route goes on to refuse.
    expect(updateConsoleCallStatus).not.toHaveBeenCalled();
  });

  it('a failed link never blocks the call (best-effort)', async () => {
    vi.mocked(verifyDialToken).mockResolvedValue({ ok: true, callId: 'call-1', phone: '+972500000000', kind: 'manual' });
    vi.mocked(linkConsoleCallSession).mockRejectedValue(new Error('db down'));
    vi.mocked(getVoximplantConfig).mockResolvedValue({ liveCallsEnabled: true, callerId: '+97230000000' } as never);

    const res = await POST(req({ secret: SECRET, token: TOKEN, session_id: 1 }));

    expect(res.status).toBe(200);
    // `kind` travels with the authorization: it is what lets the scenario play a
    // disclosure that is TRUE for this call rather than the RSVP wording on every
    // outbound leg. Asserted rather than tolerated.
    expect(await res.json()).toEqual({
      ok: true,
      phone: '+972500000000',
      callerid: '+97230000000',
      kind: 'manual',
    });
  });

  it('does not link when the token itself fails to verify', async () => {
    vi.mocked(verifyDialToken).mockResolvedValue({ ok: false, reason: 'not_found' });

    await POST(req({ secret: SECRET, token: TOKEN, session_id: 1 }));

    expect(linkConsoleCallSession).not.toHaveBeenCalled();
  });
});
