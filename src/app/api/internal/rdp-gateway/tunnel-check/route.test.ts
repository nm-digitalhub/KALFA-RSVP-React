import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const checkRdpTunnel = vi.fn();
vi.mock('@/lib/rdp-access/service', () => ({ checkRdpTunnel: (...args: unknown[]) => checkRdpTunnel(...args) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';
import { RDP_GATEWAY_CHECK_TIMEOUT_MS } from '@/lib/rdp-access/policy';

import { POST } from './route';

const SECRET = 'k'.repeat(40);
const GRANT = '55555555-5555-4555-8555-555555555555';
const EXPIRES = '2026-10-06T18:00:00.000Z';

const ENV = {
  RDPGW_LOOPBACK_URL: 'http://127.0.0.1:3013',
  RDPGW_ADMIN_URL: 'http://127.0.0.1:3014',
  RDPGW_TARGET: 'desktop.example.test:3389',
  RDPGW_USER: 'desktopuser',
  RDPGW_CHECK_SECRET: SECRET,
  RDPGW_CONNECT_SECRET: 'n'.repeat(40),
  RDPGW_ADMIN_SECRET: 'a'.repeat(40),
} as const;

const BODY = {
  user: 'desktopuser',
  clientIp: '203.0.113.7',
  target: 'desktop.example.test:3389',
  tunnelId: 'tunnel-1',
  rdgConnectionId: 'conn-1',
};

function call(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) {
  return POST(
    new Request('http://127.0.0.1:3002/api/internal/rdp-gateway/tunnel-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  for (const [name, value] of Object.entries(ENV)) vi.stubEnv(name, value);
  checkRdpTunnel.mockReset();
  checkRdpTunnel.mockResolvedValue({ allow: true, grantId: GRANT, expiresAt: EXPIRES });
  __resetRateLimitStateForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('POST /api/internal/rdp-gateway/tunnel-check', () => {
  it('allows when the one active grant matches, and returns exactly what the gateway needs', async () => {
    const res = await call(BODY);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ allow: true, grantId: GRANT, expiresAt: EXPIRES });
    expect(checkRdpTunnel).toHaveBeenCalledWith(expect.anything(), {
      target: 'desktop.example.test:3389',
      clientIp: '203.0.113.7',
      tunnelRef: 'tunnel-1',
    });
  });

  it('falls back to the RDG connection id, then to an empty reference', async () => {
    await call({ ...BODY, tunnelId: undefined });
    expect(checkRdpTunnel).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tunnelRef: 'conn-1' }));
    await call({ ...BODY, tunnelId: undefined, rdgConnectionId: undefined });
    expect(checkRdpTunnel).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ tunnelRef: '' }));
  });

  it.each(['x-real-ip', 'forwarded'])('answers 404 when %s is present, even with a valid secret', async (header) => {
    const res = await call(BODY, { authorization: `Bearer ${SECRET}`, [header]: 'x' });
    expect(res.status).toBe(404);
    expect(checkRdpTunnel).not.toHaveBeenCalled();
  });

  // The Next.js server adds these to every incoming request, including the gateway's direct loopback call
  // (verified in next/dist/server/base-server.js). They must never make the route refuse the gateway.
  it('still answers the gateway when Next has added its own x-forwarded-* headers', async () => {
    const res = await call(BODY, {
      authorization: `Bearer ${SECRET}`,
      'x-forwarded-for': '127.0.0.1',
      'x-forwarded-host': '127.0.0.1:3002',
      'x-forwarded-proto': 'http',
      'x-forwarded-port': '3002',
    });
    expect(res.status).toBe(200);
    expect(checkRdpTunnel).toHaveBeenCalledTimes(1);
  });

  it.each(Object.keys(ENV))('answers 503 when %s is not configured (the feature is off)', async (name) => {
    vi.stubEnv(name, '');
    const res = await call(BODY);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ allow: false });
    expect(checkRdpTunnel).not.toHaveBeenCalled();
  });

  it.each([
    ['no Authorization header', {}],
    ['a non-Bearer scheme', { authorization: `Basic ${SECRET}` }],
    ['an empty Bearer', { authorization: 'Bearer ' }],
    ['extra tokens after the secret', { authorization: `Bearer ${SECRET} extra` }],
    ['a wrong secret', { authorization: `Bearer ${'z'.repeat(40)}` }],
    ['a near-miss secret', { authorization: `Bearer ${SECRET.slice(0, -1)}x` }],
  ])('answers 401 for %s', async (_label, headers) => {
    const res = await call(BODY, headers);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ allow: false });
    expect(checkRdpTunnel).not.toHaveBeenCalled();
  });

  it('never echoes the secret in any response', async () => {
    for (const res of [await call(BODY), await call(BODY, { authorization: 'Bearer wrong' })]) {
      expect(await res.text()).not.toContain(SECRET);
    }
  });

  it('answers 413 for an oversized body, declared or actual', async () => {
    const declared = await call(BODY, { authorization: `Bearer ${SECRET}`, 'content-length': '999999' });
    expect(declared.status).toBe(413);
    const actual = await call({ ...BODY, user: 'u'.repeat(5000) });
    expect(actual.status).toBe(413);
  });

  it('answers 400 for invalid JSON, a schema violation and an unknown key', async () => {
    expect((await call('not json')).status).toBe(400);
    expect((await call({ ...BODY, clientIp: 'nope' })).status).toBe(400);
    expect((await call({ ...BODY, paaToken: 'secret' })).status).toBe(400);
    expect(checkRdpTunnel).not.toHaveBeenCalled();
  });

  it('refuses without touching the database when the identity is not the configured OS account', async () => {
    const res = await call({ ...BODY, user: 'someone-else' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allow: false });
    expect(checkRdpTunnel).not.toHaveBeenCalled();
  });

  it('refuses, with only allow:false, when no grant matches', async () => {
    checkRdpTunnel.mockResolvedValue({ allow: false, grantId: null, expiresAt: null });
    const res = await call(BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ allow: false });
  });

  it.each([
    ['a missing grant id', { allow: true, grantId: null, expiresAt: EXPIRES }],
    ['a missing expiry', { allow: true, grantId: GRANT, expiresAt: null }],
  ])('refuses an allow that arrives with %s', async (_label, value) => {
    checkRdpTunnel.mockResolvedValue(value);
    expect(await (await call(BODY)).json()).toEqual({ allow: false });
  });

  it('answers 503 allow:false when the database errors', async () => {
    checkRdpTunnel.mockRejectedValue(new Error('connection refused'));
    const res = await call(BODY);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ allow: false });
  });

  it('answers 503 allow:false when the database is too slow', async () => {
    vi.useFakeTimers();
    checkRdpTunnel.mockReturnValue(new Promise(() => undefined));
    const pending = call(BODY);
    await vi.advanceTimersByTimeAsync(RDP_GATEWAY_CHECK_TIMEOUT_MS + 10);
    const res = await pending;
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ allow: false });
  });

  it('applies a coarse flood guard', async () => {
    let last = 200;
    for (let i = 0; i < 601; i += 1) last = (await call(BODY)).status;
    expect(last).toBe(429);
  });
});
