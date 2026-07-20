import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/console-agent', () => ({ requireConsoleAgent: vi.fn() }));

import { POST } from './route';
import { requireConsoleAgent } from '@/lib/auth/console-agent';

const USER_ID = '33333333-3333-4333-8333-333333333333';

function req(body: string): Request {
  return new Request('https://beta.kalfa.me/api/agents/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
    body,
  });
}

// Mock a successful console-agent context whose caller-scoped client records the upsert.
function mockAgent(upsertResult: { error: unknown } = { error: null }) {
  const upsert = vi.fn().mockResolvedValue(upsertResult);
  const supabase = { from: vi.fn(() => ({ upsert })) };
  vi.mocked(requireConsoleAgent).mockResolvedValue({
    ok: true,
    ctx: { userId: USER_ID, supabase },
  } as never);
  return { upsert };
}

describe('POST /api/agents/status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({
      ok: false,
      status: 401,
      error: 'לא מורשה',
    } as never);
    expect((await POST(req('{"status":"ready"}'))).status).toBe(401);
  });

  it('returns 403 when authenticated but not a console agent', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({
      ok: false,
      status: 403,
      error: 'אין הרשאה',
    } as never);
    expect((await POST(req('{"status":"ready"}'))).status).toBe(403);
  });

  it('rejects the system-managed in_call and unknown statuses with 400', async () => {
    mockAgent();
    expect((await POST(req('{"status":"in_call"}'))).status).toBe(400);
    expect((await POST(req('{"status":"busy"}'))).status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    mockAgent();
    expect((await POST(req('not json'))).status).toBe(400);
  });

  it('upserts the caller-owned row and returns 200 on a valid status', async () => {
    const { upsert } = mockAgent();
    const res = await POST(req('{"status":"dnd"}'));
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: USER_ID, status: 'dnd' }),
      expect.objectContaining({ onConflict: 'agent_id' }),
    );
    await expect(res.json()).resolves.toEqual({ ok: true, status: 'dnd' });
  });

  it('never trusts a client-supplied agent_id — writes auth.uid()', async () => {
    const { upsert } = mockAgent();
    await POST(req('{"status":"ready","agent_id":"attacker"}'));
    // strictObject rejects the extra field → 400, nothing written.
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns 500 when the upsert fails', async () => {
    mockAgent({ error: { message: 'boom' } });
    expect((await POST(req('{"status":"ready"}'))).status).toBe(500);
  });
});
