import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/console-agent', () => ({
  requireConsoleAgent: vi.fn(),
  callerHasPlatformPermission: vi.fn(),
}));
vi.mock('@/lib/data/call-attempts', () => ({
  getCallAttemptById: vi.fn(),
  TERMINAL_STATUSES: ['completed', 'failed', 'no_answer', 'no_response', 'cancelled'],
}));
// Keep the real pickSessionUrl (pure URL selection); stub only the network POST.
vi.mock('@/lib/voximplant/session-command', async (orig) => ({
  ...(await orig<typeof import('@/lib/voximplant/session-command')>()),
  postCommandToSession: vi.fn(),
}));

import { POST } from './route';
import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { getCallAttemptById } from '@/lib/data/call-attempts';
import { postCommandToSession } from '@/lib/voximplant/session-command';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '068a715c-464d-4461-96d3-0f9104bdbd89';
const SECURE_URL = 'https://media.example/request/s/tok';
const PLAIN_URL = 'http://51.68.148.58:12092/request/s/tok';

function call(id: string = ATTEMPT_ID) {
  const req = new Request(`https://beta.kalfa.me/api/calls/${id}/end`, {
    method: 'POST',
    headers: { Authorization: 'Bearer x' },
  });
  return POST(req, { params: Promise.resolve({ callAttemptId: id }) });
}

function attempt(over: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    status: 'in_progress',
    media_session_access_url: PLAIN_URL,
    media_session_access_secure_url: SECURE_URL,
    ...over,
  };
}

function mockHappyPath() {
  vi.mocked(requireConsoleAgent).mockResolvedValue({
    ok: true,
    ctx: { userId: USER_ID, supabase: {} },
  } as never);
  vi.mocked(callerHasPlatformPermission).mockResolvedValue(true);
  vi.mocked(getCallAttemptById).mockResolvedValue(attempt() as never);
  vi.mocked(postCommandToSession).mockResolvedValue({ delivered: true, status: 200 });
}

beforeEach(() => vi.clearAllMocks());

describe('POST /api/calls/{id}/end', () => {
  it('sends call_end — the command /agent-command is not allowed to carry', async () => {
    mockHappyPath();
    const res = await call();
    expect(res.status).toBe(202);
    const [urlArg, envArg] = vi.mocked(postCommandToSession).mock.calls[0];
    expect(envArg.command).toBe('call_end');
    expect(envArg.call_attempt_id).toBe(ATTEMPT_ID);
    expect(envArg.payload).toEqual({});
    // Ending a live guest call must not put its control token on the wire in
    // cleartext when an HTTPS handle exists.
    expect(urlArg.href).toBe(SECURE_URL);
  });

  it('rejects an unauthenticated caller before touching the attempt', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({
      ok: false,
      status: 401,
      error: 'לא מורשה',
    } as never);
    expect((await call()).status).toBe(401);
    expect(getCallAttemptById).not.toHaveBeenCalled();
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('requires manage_voice — a console agent alone may not hang up a guest', async () => {
    mockHappyPath();
    vi.mocked(callerHasPlatformPermission).mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('409s on an already-terminal attempt instead of posting to a dead handle', async () => {
    mockHappyPath();
    vi.mocked(getCallAttemptById).mockResolvedValue(attempt({ status: 'completed' }) as never);
    expect((await call()).status).toBe(409);
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('409s when no usable handle is stored — the handle dies with the call', async () => {
    mockHappyPath();
    vi.mocked(getCallAttemptById).mockResolvedValue(
      attempt({ media_session_access_url: null, media_session_access_secure_url: null }) as never,
    );
    expect((await call()).status).toBe(409);
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('404s for an unknown attempt', async () => {
    mockHappyPath();
    vi.mocked(getCallAttemptById).mockResolvedValue(null as never);
    expect((await call()).status).toBe(404);
  });

  it('400s on a non-uuid id without hitting the database', async () => {
    mockHappyPath();
    expect((await call('not-a-uuid')).status).toBe(400);
    expect(getCallAttemptById).not.toHaveBeenCalled();
  });

  it('502s when delivery fails, rather than reporting a hangup that did not happen', async () => {
    mockHappyPath();
    vi.mocked(postCommandToSession).mockResolvedValue({ delivered: false });
    expect((await call()).status).toBe(502);
  });

  it('falls back to the plain handle only when the secure one is absent', async () => {
    mockHappyPath();
    vi.mocked(getCallAttemptById).mockResolvedValue(
      attempt({ media_session_access_secure_url: null }) as never,
    );
    expect((await call()).status).toBe(202);
    expect(vi.mocked(postCommandToSession).mock.calls[0][0].href).toBe(PLAIN_URL);
  });
});
