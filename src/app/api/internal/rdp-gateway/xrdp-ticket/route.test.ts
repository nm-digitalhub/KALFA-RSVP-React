import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const decideXrdpLogin = vi.fn();
vi.mock('@/lib/rdp-access/xrdp-login', () => ({ decideXrdpLogin: (...args: unknown[]) => decideXrdpLogin(...args) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { RDP_XRDP_TICKET_TIMEOUT_MS } from '@/lib/rdp-access/policy';
import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

import { POST } from './route';

const CHECK_SECRET = 'k'.repeat(40);
const TICKET_SECRET = 't'.repeat(40);
const GRANT = '55555555-5555-4555-8555-555555555555';
const TICKET = `k1.${'A'.repeat(38)}`;

const ENV = {
  RDPGW_USER: 'desktopuser',
  RDPGW_CHECK_SECRET: 'g'.repeat(40),
  RDPGW_CONNECT_SECRET: 'n'.repeat(40),
  RDPGW_ADMIN_SECRET: 'a'.repeat(40),
  RDPGW_XRDP_TICKET_SECRET: TICKET_SECRET,
  RDPGW_XRDP_CHECK_SECRET: CHECK_SECRET,
} as const;

const BODY = { ticket: TICKET, user: 'desktopuser' };

function call(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${CHECK_SECRET}` }) {
  return POST(
    new Request('http://127.0.0.1:3002/api/internal/rdp-gateway/xrdp-ticket', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
  decideXrdpLogin.mockReset();
  decideXrdpLogin.mockResolvedValue({ allow: true, grantId: GRANT });
  __resetRateLimitStateForTests();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('POST /api/internal/rdp-gateway/xrdp-ticket', () => {
  it('allows with exactly { allow: true }: no grant, no reason, nothing to learn from', async () => {
    const res = await call(BODY);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // the login helper compares this text byte for byte: a changed serialisation would refuse every login
    expect(await res.text()).toBe('{"allow":true}');
    expect(decideXrdpLogin).toHaveBeenCalledWith(
      expect.objectContaining({ now: expect.any(Date) }),
      expect.objectContaining({ ticketSecret: TICKET_SECRET, account: 'desktopuser' }),
      { ticket: TICKET, user: 'desktopuser' },
    );
  });

  it('answers a refusal as allow:false with 200 and keeps the reason out of the answer', async () => {
    decideXrdpLogin.mockResolvedValue({ allow: false, reason: 'no_active_grant' });
    const res = await call(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allow: false });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('no_active_grant'));
  });

  it.each(['x-real-ip', 'forwarded'])('answers 404 when %s is present, even with a valid secret', async (header) => {
    const res = await call(BODY, { authorization: `Bearer ${CHECK_SECRET}`, [header]: 'x' });
    expect(res.status).toBe(404);
    expect(decideXrdpLogin).not.toHaveBeenCalled();
  });

  it('still answers when Next has added its own x-forwarded-* headers', async () => {
    const res = await call(BODY, {
      authorization: `Bearer ${CHECK_SECRET}`,
      'x-forwarded-for': '127.0.0.1',
      'x-forwarded-host': '127.0.0.1:3002',
      'x-forwarded-proto': 'http',
      'x-forwarded-port': '3002',
    });
    expect(res.status).toBe(200);
  });

  it('answers 503 when ticket login is switched off (both secrets unset): every downloaded file stops working', async () => {
    vi.stubEnv('RDPGW_XRDP_TICKET_SECRET', '');
    vi.stubEnv('RDPGW_XRDP_CHECK_SECRET', '');
    const res = await call(BODY);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ allow: false });
    expect(decideXrdpLogin).not.toHaveBeenCalled();
  });

  it.each(['RDPGW_XRDP_TICKET_SECRET', 'RDPGW_XRDP_CHECK_SECRET', 'RDPGW_USER'])('answers 503 when only %s is missing', async (name) => {
    vi.stubEnv(name, '');
    expect((await call(BODY)).status).toBe(503);
    expect(decideXrdpLogin).not.toHaveBeenCalled();
  });

  it('does not accept the gateway secret: the helper has its own credential', async () => {
    const res = await call(BODY, { authorization: `Bearer ${ENV.RDPGW_CHECK_SECRET}` });
    expect(res.status).toBe(401);
    expect(decideXrdpLogin).not.toHaveBeenCalled();
  });

  it.each([
    ['no Authorization header', {}],
    ['a non-Bearer scheme', { authorization: `Basic ${CHECK_SECRET}` }],
    ['an empty Bearer', { authorization: 'Bearer ' }],
    ['extra tokens after the secret', { authorization: `Bearer ${CHECK_SECRET} extra` }],
    ['a wrong secret', { authorization: `Bearer ${'z'.repeat(40)}` }],
    ['a near-miss secret', { authorization: `Bearer ${CHECK_SECRET.slice(0, -1)}x` }],
    ['the ticket secret instead of the check secret', { authorization: `Bearer ${TICKET_SECRET}` }],
  ])('answers 401 for %s', async (_label, headers) => {
    const res = await call(BODY, headers);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ allow: false });
    expect(decideXrdpLogin).not.toHaveBeenCalled();
  });

  it('never echoes a secret or the ticket in any response', async () => {
    decideXrdpLogin.mockResolvedValueOnce({ allow: false, reason: 'mismatch' });
    for (const res of [await call(BODY), await call(BODY, { authorization: 'Bearer wrong' }), await call('not json')]) {
      const text = await res.text();
      for (const secret of [CHECK_SECRET, TICKET_SECRET, TICKET]) expect(text).not.toContain(secret);
    }
  });

  it('never writes the ticket or a secret to the log', async () => {
    decideXrdpLogin.mockResolvedValueOnce({ allow: false, reason: 'mismatch' });
    await call(BODY);
    await call(BODY);
    decideXrdpLogin.mockRejectedValueOnce(new Error(`boom ${TICKET}`));
    await call(BODY);
    const logged = JSON.stringify([
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.warn).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ]);
    for (const secret of [CHECK_SECRET, TICKET_SECRET, TICKET]) expect(logged).not.toContain(secret);
  });

  it('answers 413 for an oversized body, declared or actual', async () => {
    const declared = await call(BODY, { authorization: `Bearer ${CHECK_SECRET}`, 'content-length': '999999' });
    expect(declared.status).toBe(413);
    const actual = await call({ ...BODY, padding: 'p'.repeat(2000) });
    expect(actual.status).toBe(413);
  });

  it('answers 400 for invalid JSON, a wrong ticket shape, a wrong account shape and an unknown key', async () => {
    expect((await call('not json')).status).toBe(400);
    expect((await call({ ...BODY, ticket: 'hunter2' })).status).toBe(400);
    expect((await call({ ...BODY, ticket: `${TICKET}\n` })).status).toBe(400);
    expect((await call({ ...BODY, user: 'a b' })).status).toBe(400);
    expect((await call({ ...BODY, user: '' })).status).toBe(400);
    expect((await call({ ...BODY, extra: 1 })).status).toBe(400);
    expect((await call({ user: 'desktopuser' })).status).toBe(400);
    expect(decideXrdpLogin).not.toHaveBeenCalled();
  });

  it('answers 503 and not an allow when the decision throws', async () => {
    decideXrdpLogin.mockRejectedValue(new Error('database down'));
    const res = await call(BODY);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ allow: false });
  });

  it('answers 503 when the decision takes longer than the budget', async () => {
    vi.useFakeTimers();
    decideXrdpLogin.mockReturnValue(new Promise(() => {}));
    const pending = call(BODY);
    await vi.advanceTimersByTimeAsync(RDP_XRDP_TICKET_TIMEOUT_MS + 1);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ allow: false });
  });

  it('answers 429 once the flood guard is used up', async () => {
    for (let i = 0; i < 120; i += 1) await call(BODY);
    const res = await call(BODY);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ allow: false });
  });

  it('rejects methods other than POST by not exporting them', async () => {
    const route = await import('./route');
    expect(Object.keys(route).filter((key) => ['GET', 'PUT', 'PATCH', 'DELETE'].includes(key))).toEqual([]);
  });
});
