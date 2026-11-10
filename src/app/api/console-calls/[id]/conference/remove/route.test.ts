import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/console-agent', () => ({
  requireConsoleAgent: vi.fn(),
  callerHasPlatformPermission: vi.fn(),
}));
vi.mock('@/lib/data/console-calls', async (orig) => ({
  ...(await orig<typeof import('@/lib/data/console-calls')>()),
  getConsoleCallById: vi.fn(),
  getConsoleCallSessionUrls: vi.fn(),
  recordConsoleConferenceAudit: vi.fn(),
}));
vi.mock('@/lib/voximplant/session-command', async (orig) => ({
  ...(await orig<typeof import('@/lib/voximplant/session-command')>()),
  postCommandToSession: vi.fn(),
}));

import { POST } from './route';
import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import {
  getConsoleCallById,
  getConsoleCallSessionUrls,
  recordConsoleConferenceAudit,
} from '@/lib/data/console-calls';
import { postCommandToSession } from '@/lib/voximplant/session-command';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const CALL_ID = '33333333-3333-4333-8333-333333333333';
const SECURE_URL = 'https://media.example/request/s/tok';

function req(body: unknown = {}, id = CALL_ID): Request {
  return new Request(`https://beta.kalfa.me/api/console-calls/${id}/conference/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const ctx = (id = CALL_ID) => ({ params: Promise.resolve({ id }) });

function call(over: Record<string, unknown> = {}) {
  return {
    id: CALL_ID,
    status: 'connected',
    direction: 'outbound',
    kind: 'manual',
    eventId: null,
    ...over,
  };
}

function mockHappy() {
  vi.mocked(requireConsoleAgent).mockResolvedValue({
    ok: true,
    ctx: { userId: USER_ID, supabase: {} },
  } as never);
  vi.mocked(callerHasPlatformPermission).mockResolvedValue(true);
  vi.mocked(getConsoleCallById).mockResolvedValue(call() as never);
  vi.mocked(getConsoleCallSessionUrls).mockResolvedValue({
    sessionUrl: null,
    secureSessionUrl: SECURE_URL,
  });
  vi.mocked(postCommandToSession).mockResolvedValue({ delivered: true, status: 200 });
  vi.mocked(recordConsoleConferenceAudit).mockResolvedValue(undefined);
}

describe('POST /api/console-calls/{id}/conference/remove', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 when not a console agent', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({
      ok: false,
      status: 401,
      error: 'לא מורשה',
    } as never);
    expect((await POST(req(), ctx())).status).toBe(401);
  });

  it('403 without manage_voice', async () => {
    mockHappy();
    vi.mocked(callerHasPlatformPermission).mockResolvedValue(false);
    expect((await POST(req(), ctx())).status).toBe(403);
  });

  it('400 on a malformed call id', async () => {
    mockHappy();
    expect((await POST(req({}, 'nope'), ctx('nope'))).status).toBe(400);
  });

  it('400 on a smuggled field (strictObject({}))', async () => {
    mockHappy();
    const res = await POST(req({ vox_username: 'agent_x' }), ctx());
    expect(res.status).toBe(400);
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('404 when the call does not exist', async () => {
    mockHappy();
    vi.mocked(getConsoleCallById).mockResolvedValue(null);
    expect((await POST(req(), ctx())).status).toBe(404);
  });

  it("409 on an internal-call row (not this route's job)", async () => {
    mockHappy();
    vi.mocked(getConsoleCallById).mockResolvedValue(call({ kind: 'internal' }) as never);
    expect((await POST(req(), ctx())).status).toBe(409);
  });

  it('409 when the call is not connected', async () => {
    mockHappy();
    vi.mocked(getConsoleCallById).mockResolvedValue(call({ status: 'ringing' }) as never);
    expect((await POST(req(), ctx())).status).toBe(409);
  });

  it('409 when no session URL has been captured yet', async () => {
    mockHappy();
    vi.mocked(getConsoleCallSessionUrls).mockResolvedValue({
      sessionUrl: null,
      secureSessionUrl: null,
    });
    expect((await POST(req(), ctx())).status).toBe(409);
  });

  it('502 when the command does not reach the session', async () => {
    mockHappy();
    vi.mocked(postCommandToSession).mockResolvedValue({ delivered: false });
    expect((await POST(req(), ctx())).status).toBe(502);
  });

  it('removes: posts {command:"conference_remove", request_id, payload:{}} and audits who removed', async () => {
    mockHappy();
    const res = await POST(req(), ctx());
    expect(res.status).toBe(202);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ removing: true });
    const [url, env] = vi.mocked(postCommandToSession).mock.calls[0];
    expect(String(url)).toBe(SECURE_URL);
    expect(env.command).toBe('conference_remove');
    expect(env.request_id).toBe(body.request_id);
    expect(env.payload).toEqual({});
    // The route never resolved a participant, so the audit names only the agent and the call.
    expect(recordConsoleConferenceAudit).toHaveBeenCalledWith({
      fromAgentId: USER_ID,
      consoleCallId: CALL_ID,
      eventId: null,
      requestId: body.request_id,
    });
  });

  it('413 on a body over the cap, before the call is loaded', async () => {
    mockHappy();
    expect((await POST(req(JSON.stringify({ pad: 'x'.repeat(300) })), ctx())).status).toBe(413);
    expect(getConsoleCallById).not.toHaveBeenCalled();
  });

  it('does not audit a command that was not delivered', async () => {
    mockHappy();
    vi.mocked(postCommandToSession).mockResolvedValue({ delivered: false });
    await POST(req(), ctx());
    expect(recordConsoleConferenceAudit).not.toHaveBeenCalled();
  });

  it('accepts a truly empty request body (no JSON at all)', async () => {
    mockHappy();
    const request = new Request(`https://beta.kalfa.me/api/console-calls/${CALL_ID}/conference/remove`, {
      method: 'POST',
      headers: { Authorization: 'Bearer x' },
    });
    const res = await POST(request, ctx());
    expect(res.status).toBe(202);
  });
});
