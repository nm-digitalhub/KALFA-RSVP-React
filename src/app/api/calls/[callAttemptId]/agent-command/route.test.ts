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
vi.mock('@/lib/data/console-agent-commands', () => ({
  recordConsoleAgentCommand: vi.fn(),
}));

import { POST } from './route';
import { callerHasPlatformPermission, requireConsoleAgent } from '@/lib/auth/console-agent';
import { getCallAttemptById } from '@/lib/data/call-attempts';
import { recordConsoleAgentCommand } from '@/lib/data/console-agent-commands';
import { postCommandToSession } from '@/lib/voximplant/session-command';

const USER_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '068a715c-464d-4461-96d3-0f9104bdbd89';
const SECURE_URL = 'https://media.example/request/s/tok';
const PLAIN_URL = 'http://51.68.148.58:12092/request/s/tok';

function req(body: string): Request {
  return new Request(`https://beta.kalfa.me/api/calls/${ATTEMPT_ID}/agent-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
    body,
  });
}

function call(body: string, id: string = ATTEMPT_ID) {
  return POST(req(body), { params: Promise.resolve({ callAttemptId: id }) });
}

// A live, commandable attempt (both handles present) unless a test overrides it.
function attempt(over: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    status: 'in_progress',
    media_session_access_url: PLAIN_URL,
    media_session_access_secure_url: SECURE_URL,
    ...over,
  };
}

// Authenticated console agent WITH manage_voice, on a live attempt, delivery ok.
function mockHappyPath() {
  vi.mocked(requireConsoleAgent).mockResolvedValue({
    ok: true,
    ctx: { userId: USER_ID, supabase: {} },
  } as never);
  vi.mocked(callerHasPlatformPermission).mockResolvedValue(true);
  vi.mocked(getCallAttemptById).mockResolvedValue(attempt() as never);
  vi.mocked(postCommandToSession).mockResolvedValue({ delivered: true, status: 200 });
}

describe('POST /api/calls/{id}/agent-command', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({
      ok: false,
      status: 401,
      error: 'לא מורשה',
    } as never);
    expect((await call('{"command":"clear_buffer"}')).status).toBe(401);
  });

  it('returns 403 when not a console agent', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({
      ok: false,
      status: 403,
      error: 'אין הרשאה',
    } as never);
    expect((await call('{"command":"clear_buffer"}')).status).toBe(403);
  });

  it('returns 403 when the agent lacks manage_voice', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({
      ok: true,
      ctx: { userId: USER_ID, supabase: {} },
    } as never);
    vi.mocked(callerHasPlatformPermission).mockResolvedValue(false);
    const res = await call('{"command":"clear_buffer"}');
    expect(res.status).toBe(403);
    // Never reaches the call lookup / session when unauthorized.
    expect(getCallAttemptById).not.toHaveBeenCalled();
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-uuid call id', async () => {
    mockHappyPath();
    expect((await call('{"command":"clear_buffer"}', 'not-a-uuid')).status).toBe(400);
    expect(getCallAttemptById).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    mockHappyPath();
    expect((await call('not json')).status).toBe(400);
  });

  it('returns 400 for an unknown command and for a smuggled field', async () => {
    mockHappyPath();
    expect((await call('{"command":"nuke"}')).status).toBe(400);
    // strictObject rejects any field beyond {command,text} — e.g. a client-supplied id.
    expect((await call('{"command":"clear_buffer","call_attempt_id":"attacker"}')).status).toBe(
      400,
    );
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('returns 404 when the attempt does not exist', async () => {
    mockHappyPath();
    vi.mocked(getCallAttemptById).mockResolvedValue(null);
    expect((await call('{"command":"clear_buffer"}')).status).toBe(404);
  });

  it('returns 409 for a terminal attempt (matches the app 409 branch)', async () => {
    mockHappyPath();
    vi.mocked(getCallAttemptById).mockResolvedValue(attempt({ status: 'completed' }) as never);
    expect((await call('{"command":"close_agent"}')).status).toBe(409);
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('returns 409 when no session handle is stored', async () => {
    mockHappyPath();
    vi.mocked(getCallAttemptById).mockResolvedValue(
      attempt({ media_session_access_url: null, media_session_access_secure_url: null }) as never,
    );
    expect((await call('{"command":"clear_buffer"}')).status).toBe(409);
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('returns 502 when delivery to the live session fails', async () => {
    mockHappyPath();
    vi.mocked(postCommandToSession).mockResolvedValue({ delivered: false });
    expect((await call('{"command":"clear_buffer"}')).status).toBe(502);
  });

  it("delivers a whisper: 202, prefers the HTTPS handle, applied:'pending'", async () => {
    mockHappyPath();
    const res = await call('{"command":"contextual_update","text":"לחץ לאישור"}');
    expect(res.status).toBe(202);

    const [urlArg, envArg] = vi.mocked(postCommandToSession).mock.calls[0];
    expect(urlArg.href).toBe(SECURE_URL); // secure preferred over the plain http handle
    expect(envArg).toMatchObject({ command: 'contextual_update', call_attempt_id: ATTEMPT_ID });
    expect(envArg.payload).toEqual({ text: 'לחץ לאישור' });
    expect(typeof envArg.request_id).toBe('string');
    expect(envArg.request_id.length).toBeGreaterThan(0);

    await expect(res.json()).resolves.toMatchObject({
      delivered: true,
      // Not false — the command was delivered and simply is not confirmed yet.
      applied: 'pending',
      command: 'contextual_update',
    });
  });

  it('falls back to the plain HTTP handle only when the secure one is absent', async () => {
    mockHappyPath();
    vi.mocked(getCallAttemptById).mockResolvedValue(
      attempt({ media_session_access_secure_url: null }) as never,
    );
    const res = await call('{"command":"clear_buffer"}');
    expect(res.status).toBe(202);
    const [urlArg] = vi.mocked(postCommandToSession).mock.calls[0];
    expect(urlArg.href).toBe(PLAIN_URL);
  });

  it('returns 500 when the attempt lookup throws', async () => {
    mockHappyPath();
    vi.mocked(getCallAttemptById).mockRejectedValue(new Error('db down'));
    expect((await call('{"command":"clear_buffer"}')).status).toBe(500);
  });
});

// This route lets a staff member change what a guest is being told, mid-call.
// Until console_agent_commands existed it recorded nothing at all — no actor, no
// time, no call, no words. These pin the trail so it cannot quietly go away.
describe('intervention audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordConsoleAgentCommand).mockResolvedValue(undefined);
  });

  it('records the actor, the call and the words for a whisper', async () => {
    mockHappyPath();
    const res = await call(
      JSON.stringify({ command: 'contextual_update', text: 'האורח מבולבל — חזור על התאריך' }),
    );
    expect(res.status).toBe(202);
    expect(recordConsoleAgentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: USER_ID,
        callAttemptId: ATTEMPT_ID,
        command: 'contextual_update',
        text: 'האורח מבולבל — חזור על התאריך',
        delivered: true,
        applied: 'pending',
      }),
    );
  });

  it('stores no text for the payload-free commands', async () => {
    mockHappyPath();
    await call(JSON.stringify({ command: 'clear_buffer' }));
    expect(recordConsoleAgentCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'clear_buffer', text: null }),
    );
  });

  // An attempt that never reached the call is still an attempt to change it.
  it('records a FAILED delivery too, with delivered false', async () => {
    mockHappyPath();
    vi.mocked(postCommandToSession).mockResolvedValue({ delivered: false });
    const res = await call(JSON.stringify({ command: 'user_message', text: 'שלום' }));
    expect(res.status).toBe(502);
    expect(recordConsoleAgentCommand).toHaveBeenCalledWith(
      expect.objectContaining({ delivered: false, text: 'שלום' }),
    );
  });

  it('correlates with the request_id the caller is given', async () => {
    mockHappyPath();
    const res = await call(JSON.stringify({ command: 'contextual_update', text: 'x' }));
    const body = (await res.json()) as { request_id: string };
    expect(recordConsoleAgentCommand).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: body.request_id }),
    );
  });

  // The command has already reached the live call by the time the row is
  // written; failing the request for a lost audit row would misreport it.
  it('still answers 202 when the audit write throws', async () => {
    mockHappyPath();
    vi.mocked(recordConsoleAgentCommand).mockRejectedValue(new Error('insert failed'));
    expect((await call(JSON.stringify({ command: 'close_agent' }))).status).toBe(202);
  });

  it('does not audit a request rejected before it reaches the call', async () => {
    mockHappyPath();
    vi.mocked(callerHasPlatformPermission).mockResolvedValue(false);
    await call(JSON.stringify({ command: 'clear_buffer' }));
    expect(recordConsoleAgentCommand).not.toHaveBeenCalled();
  });
});
