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
vi.mock('@/lib/data/console-monitor', () => ({
  monitorEnabled: vi.fn(),
  attachableVoxUsername: vi.fn(),
  createRequestedLeg: vi.fn(),
}));
vi.mock('@/lib/voximplant/session-command', async (orig) => ({
  ...(await orig<typeof import('@/lib/voximplant/session-command')>()),
  postCommandToSession: vi.fn(),
}));

import { POST } from './route';
import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { getCallAttemptById } from '@/lib/data/call-attempts';
import {
  attachableVoxUsername,
  createRequestedLeg,
  monitorEnabled,
} from '@/lib/data/console-monitor';
import { postCommandToSession } from '@/lib/voximplant/session-command';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '068a715c-464d-4461-96d3-0f9104bdbd89';
const SECURE_URL = 'https://media.example/request/s/tok';
const VOX_USER = 'agent_1bbe74dc-5721-48e9-9092-fd9e3c6e6b21';

function req(body: unknown, id = ATTEMPT_ID): Request {
  return new Request(`https://beta.kalfa.me/api/calls/${id}/monitor`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const ctx = (id = ATTEMPT_ID) => ({ params: Promise.resolve({ callAttemptId: id }) });

function attempt(over: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    status: 'in_progress',
    media_session_access_url: null,
    media_session_access_secure_url: SECURE_URL,
    ...over,
  };
}

// Authenticated console agent WITH manage_voice, feature ON, provisioned, on a
// live attempt, delivery ok, leg created — the happy path unless overridden.
function mockHappy() {
  vi.mocked(requireConsoleAgent).mockResolvedValue({
    ok: true,
    ctx: { userId: USER_ID, supabase: {} },
  } as never);
  vi.mocked(callerHasPlatformPermission).mockResolvedValue(true);
  vi.mocked(monitorEnabled).mockResolvedValue(true);
  vi.mocked(attachableVoxUsername).mockResolvedValue(VOX_USER);
  vi.mocked(getCallAttemptById).mockResolvedValue(attempt() as never);
  vi.mocked(createRequestedLeg).mockResolvedValue({ legId: 'leg-1', requestId: 'rid-1' });
  vi.mocked(postCommandToSession).mockResolvedValue({ delivered: true, status: 200 });
}

describe('POST /api/calls/{id}/monitor', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 when not a console agent', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({
      ok: false,
      status: 401,
      error: 'לא מורשה',
    } as never);
    expect((await POST(req({ mode: 'monitor' }), ctx())).status).toBe(401);
  });

  it('403 without manage_voice', async () => {
    mockHappy();
    vi.mocked(callerHasPlatformPermission).mockResolvedValue(false);
    expect((await POST(req({ mode: 'monitor' }), ctx())).status).toBe(403);
  });

  // The gate is the whole point: with the feature OFF the route must NOT create a
  // leg the scenario cannot answer. 503, and nothing downstream is touched.
  it('503 when monitor is not enabled, and creates NO leg', async () => {
    mockHappy();
    vi.mocked(monitorEnabled).mockResolvedValue(false);
    const res = await POST(req({ mode: 'monitor' }), ctx());
    expect(res.status).toBe(503);
    expect(createRequestedLeg).not.toHaveBeenCalled();
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('400 on an invalid mode', async () => {
    mockHappy();
    expect((await POST(req({ mode: 'spy' }), ctx())).status).toBe(400);
  });

  it('400 on a malformed attempt id', async () => {
    mockHappy();
    expect((await POST(req({ mode: 'monitor' }, 'nope'), ctx('nope'))).status).toBe(400);
  });

  // Authorised, but no SDK identity to callUser — 409, distinct from an auth
  // failure so the app stops rather than retrying.
  it('409 when the agent has no provisioned identity', async () => {
    mockHappy();
    vi.mocked(attachableVoxUsername).mockResolvedValue(null);
    const res = await POST(req({ mode: 'monitor' }), ctx());
    expect(res.status).toBe(409);
    expect(createRequestedLeg).not.toHaveBeenCalled();
  });

  it('404 when the call does not exist', async () => {
    mockHappy();
    vi.mocked(getCallAttemptById).mockResolvedValue(null as never);
    expect((await POST(req({ mode: 'monitor' }), ctx())).status).toBe(404);
  });

  it('409 on a terminal call', async () => {
    mockHappy();
    vi.mocked(getCallAttemptById).mockResolvedValue(attempt({ status: 'completed' }) as never);
    expect((await POST(req({ mode: 'monitor' }), ctx())).status).toBe(409);
  });

  it('409 when the agent is already attached to this call', async () => {
    mockHappy();
    vi.mocked(createRequestedLeg).mockResolvedValue({ error: 'already_attached' });
    const res = await POST(req({ mode: 'monitor' }), ctx());
    expect(res.status).toBe(409);
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('attaches: creates the leg and sends attach with the vox_username + mode', async () => {
    mockHappy();
    const res = await POST(req({ mode: 'takeover' }), ctx());
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      attached: true,
      leg_id: 'leg-1',
      request_id: 'rid-1',
      mode: 'takeover',
    });
    expect(createRequestedLeg).toHaveBeenCalledWith(ATTEMPT_ID, USER_ID, 'takeover');
    const [url, env] = vi.mocked(postCommandToSession).mock.calls[0];
    // pickSessionUrl hands the route a parsed URL, not a raw string.
    expect(String(url)).toBe(SECURE_URL);
    expect(env.command).toBe('attach');
    expect(env.request_id).toBe('rid-1');
    expect(env.payload).toEqual({ vox_username: VOX_USER, mode: 'takeover' });
  });

  // The identity is taken from the session; a vox_username in the body is ignored.
  it('never trusts a vox_username from the body', async () => {
    mockHappy();
    await POST(req({ mode: 'monitor', vox_username: 'agent_someone_else' }), ctx());
    // strictObject on attachModeSchema rejects the smuggled field → 400, so nothing runs.
    expect(attachableVoxUsername).not.toHaveBeenCalled();
  });

  it('502 when the command does not reach the session', async () => {
    mockHappy();
    vi.mocked(postCommandToSession).mockResolvedValue({ delivered: false });
    expect((await POST(req({ mode: 'monitor' }), ctx())).status).toBe(502);
  });
});
