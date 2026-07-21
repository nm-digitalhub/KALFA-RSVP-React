import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/console-agent', () => ({ requireConsoleAgent: vi.fn() }));
vi.mock('@/lib/data/console-sdk-auth', () => ({ signOneTimeKeyForAgent: vi.fn() }));

import { POST } from './route';
import { requireConsoleAgent } from '@/lib/auth/console-agent';
import { signOneTimeKeyForAgent } from '@/lib/data/console-sdk-auth';
import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

const AGENT_A = '33333333-3333-4333-8333-333333333333';
const AGENT_B = '44444444-4444-4444-8444-444444444444';
const KEY = 'abcdefgh12345678';
const HASH = '3c85e45030acefcf93958cd26a3ee098';

function req(body: unknown): Request {
  return new Request('https://beta.kalfa.me/api/agents/sdk-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function authAs(userId: string) {
  vi.mocked(requireConsoleAgent).mockResolvedValue({
    ok: true,
    ctx: { userId, supabase: {} },
  } as never);
}

describe('POST /api/agents/sdk-auth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __resetRateLimitStateForTests();
    vi.mocked(signOneTimeKeyForAgent).mockResolvedValue({ ok: true, hash: HASH });
  });

  it('401 when the caller is not a console agent', async () => {
    vi.mocked(requireConsoleAgent).mockResolvedValue({
      ok: false,
      status: 401,
      error: 'לא מורשה',
    } as never);
    expect((await POST(req({ one_time_key: KEY }))).status).toBe(401);
  });

  // Being able to log in as yourself IS console membership. Requiring a further
  // permission would let an agent be enrolled and unable to connect at all.
  it('needs no platform permission beyond membership', async () => {
    authAs(AGENT_A);
    const res = await POST(req({ one_time_key: KEY }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hash: HASH });
  });

  // The identity is taken from the session. A body that names another agent
  // must not change whose password signs the key.
  it('signs for the SESSION agent, ignoring anything in the body', async () => {
    authAs(AGENT_A);
    await POST(req({ one_time_key: KEY, user_id: AGENT_B, vox_username: 'agent_b' }));
    // strictObject rejects the smuggled fields outright.
    expect(signOneTimeKeyForAgent).not.toHaveBeenCalled();

    await POST(req({ one_time_key: KEY }));
    expect(signOneTimeKeyForAgent).toHaveBeenCalledWith(AGENT_A, KEY);
  });

  it.each([
    ['missing key', {}],
    ['too short', { one_time_key: 'abc' }],
    ['illegal characters', { one_time_key: 'abcdefgh<script>' }],
    ['not an object', '"just a string"'],
    ['unparseable', '{oops'],
  ])('400 on %s', async (_label, body) => {
    authAs(AGENT_A);
    expect((await POST(req(body))).status).toBe(400);
  });

  it('413 on an oversized body', async () => {
    authAs(AGENT_A);
    const res = await POST(req({ one_time_key: 'a'.repeat(4000) }));
    expect(res.status).toBe(413);
  });

  // Authorised, but there is no identity to sign with — a distinct state from
  // "not allowed", and the app should stop retrying rather than treat it as an
  // auth failure.
  it('409 when the agent has no provisioned identity', async () => {
    authAs(AGENT_A);
    vi.mocked(signOneTimeKeyForAgent).mockResolvedValue({
      ok: false,
      reason: 'not_provisioned',
    });
    const res = await POST(req({ one_time_key: KEY }));
    expect(res.status).toBe(409);
  });

  // A signing request is a login attempt; a stolen token must not be usable to
  // grind keys.
  it('rate limits per agent, and does not punish a different agent', async () => {
    authAs(AGENT_A);
    for (let i = 0; i < 10; i++) {
      expect((await POST(req({ one_time_key: KEY }))).status).toBe(200);
    }
    expect((await POST(req({ one_time_key: KEY }))).status).toBe(429);

    authAs(AGENT_B);
    expect((await POST(req({ one_time_key: KEY }))).status).toBe(200);
  });

  it('returns the hash ONLY — no username, key or password', async () => {
    authAs(AGENT_A);
    const body = await (await POST(req({ one_time_key: KEY }))).json();
    expect(Object.keys(body as object)).toEqual(['hash']);
    expect(JSON.stringify(body)).not.toContain(KEY);
  });

  it('never caches', async () => {
    authAs(AGENT_A);
    const res = await POST(req({ one_time_key: KEY }));
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});
