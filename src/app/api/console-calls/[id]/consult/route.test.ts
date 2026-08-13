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
  recordConsoleConsultAudit: vi.fn(),
  resolveTransferTarget: vi.fn(),
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
  recordConsoleConsultAudit,
  resolveTransferTarget,
} from '@/lib/data/console-calls';
import { postCommandToSession } from '@/lib/voximplant/session-command';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const CALL_ID = '33333333-3333-4333-8333-333333333333';
const SECURE_URL = 'https://media.example/request/s/tok';
const TARGET_VOX_USER = 'agent_22222222-2222-4222-8222-222222222222';

function req(body: unknown, id = CALL_ID): Request {
  return new Request(`https://beta.kalfa.me/api/console-calls/${id}/consult`, {
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
  vi.mocked(resolveTransferTarget).mockResolvedValue({ ok: true, voxUsername: TARGET_VOX_USER });
  vi.mocked(getConsoleCallSessionUrls).mockResolvedValue({
    sessionUrl: null,
    secureSessionUrl: SECURE_URL,
  });
  vi.mocked(postCommandToSession).mockResolvedValue({ delivered: true, status: 200 });
  vi.mocked(recordConsoleConsultAudit).mockResolvedValue(undefined);
}

describe('POST /api/console-calls/{id}/consult', () => {
  beforeEach(() => vi.resetAllMocks());

  it('401 when not a console agent', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({
      ok: false,
      status: 401,
      error: 'לא מורשה',
    } as never);
    expect((await POST(req({ to_agent_id: TARGET_ID }), ctx())).status).toBe(401);
  });

  it('403 without manage_voice', async () => {
    mockHappy();
    vi.mocked(callerHasPlatformPermission).mockResolvedValue(false);
    expect((await POST(req({ to_agent_id: TARGET_ID }), ctx())).status).toBe(403);
  });

  it('400 on a malformed call id', async () => {
    mockHappy();
    expect((await POST(req({ to_agent_id: TARGET_ID }, 'nope'), ctx('nope'))).status).toBe(400);
  });

  it('400 on a smuggled field (strictObject)', async () => {
    mockHappy();
    const res = await POST(req({ to_agent_id: TARGET_ID, vox_username: 'agent_x' }), ctx());
    expect(res.status).toBe(400);
    expect(resolveTransferTarget).not.toHaveBeenCalled();
  });

  it('404 when the call does not exist', async () => {
    mockHappy();
    vi.mocked(getConsoleCallById).mockResolvedValue(null);
    expect((await POST(req({ to_agent_id: TARGET_ID }), ctx())).status).toBe(404);
  });

  it("409 on an internal-call row (not this route's job)", async () => {
    mockHappy();
    vi.mocked(getConsoleCallById).mockResolvedValue(call({ kind: 'internal' }) as never);
    const res = await POST(req({ to_agent_id: TARGET_ID }), ctx());
    expect(res.status).toBe(409);
    expect(resolveTransferTarget).not.toHaveBeenCalled();
  });

  it('409 when the call is not connected', async () => {
    mockHappy();
    vi.mocked(getConsoleCallById).mockResolvedValue(call({ status: 'ringing' }) as never);
    const res = await POST(req({ to_agent_id: TARGET_ID }), ctx());
    expect(res.status).toBe(409);
    expect(resolveTransferTarget).not.toHaveBeenCalled();
  });

  it('409 when the target is unresolvable', async () => {
    mockHappy();
    vi.mocked(resolveTransferTarget).mockResolvedValue({ ok: false, reason: 'not_ready' });
    const res = await POST(req({ to_agent_id: TARGET_ID }), ctx());
    expect(res.status).toBe(409);
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('409 when no session URL has been captured yet', async () => {
    mockHappy();
    vi.mocked(getConsoleCallSessionUrls).mockResolvedValue({
      sessionUrl: null,
      secureSessionUrl: null,
    });
    const res = await POST(req({ to_agent_id: TARGET_ID }), ctx());
    expect(res.status).toBe(409);
    expect(postCommandToSession).not.toHaveBeenCalled();
  });

  it('502 when the command does not reach the session', async () => {
    mockHappy();
    vi.mocked(postCommandToSession).mockResolvedValue({ delivered: false });
    expect((await POST(req({ to_agent_id: TARGET_ID }), ctx())).status).toBe(502);
  });

  it('starts a consult: posts {command:"consult_start", request_id, payload.vox_username}', async () => {
    mockHappy();
    const res = await POST(req({ to_agent_id: TARGET_ID }), ctx());
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ consulting: true, to_agent_id: TARGET_ID });
    expect(resolveTransferTarget).toHaveBeenCalledWith(TARGET_ID, USER_ID);
    const [url, env] = vi.mocked(postCommandToSession).mock.calls[0];
    expect(String(url)).toBe(SECURE_URL);
    expect(env.command).toBe('consult_start');
    expect(typeof env.request_id).toBe('string');
    expect(env.payload).toEqual({ vox_username: TARGET_VOX_USER });
    expect(recordConsoleConsultAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        fromAgentId: USER_ID,
        toAgentId: TARGET_ID,
        consoleCallId: CALL_ID,
        phase: 'start',
      }),
    );
  });
});
