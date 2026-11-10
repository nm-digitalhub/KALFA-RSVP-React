import { beforeEach, describe, expect, it, vi } from 'vitest';

// The request gate of four Voximplant-facing routes, pinned at the ROUTE: the two console-scenario endpoints that
// carry the shared secret in the body (route-inbound, widget-authorize) and the two call-context endpoints whose
// path token is the only authorization (mtg/ctx, sls/ctx). Every refusal here must be decided before any data
// function runs, in a fixed order, with the status and body the calling scenario parses.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/security/rate-limit', async (orig) => ({
  ...(await orig<typeof import('@/lib/security/rate-limit')>()),
  rateLimit: vi.fn(),
}));
vi.mock('@/lib/data/console-calls', () => ({
  verifyDialToken: vi.fn(),
  identifyInboundCaller: vi.fn(),
  inboundCallsEnabled: vi.fn(),
  countConcurrentAnsweredInbound: vi.fn(),
  countAnsweredInboundToday: vi.fn(),
  countAnsweredUnidentifiedInboundToday: vi.fn(),
  countAnsweredLastHourForPhone: vi.fn(),
  createConsoleCall: vi.fn(),
}));
vi.mock('@/lib/data/console-queues', () => ({}));
vi.mock('@/lib/data/voximplant-balance-cache', () => ({ checkInboundBalanceReserve: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantConfig: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/data/callback-request-attempts', () => ({ getCallbackVoiceContextByAccessToken: vi.fn() }));
vi.mock('@/lib/data/sales-call-attempts', () => ({ getSalesVoiceContextByAccessToken: vi.fn() }));
vi.mock('@/lib/data/company', () => ({ getCompanyLegal: vi.fn() }));
vi.mock('@/lib/callbacks/policy-config', () => ({ getCallbackPolicy: vi.fn() }));

import { getCallbackVoiceContextByAccessToken } from '@/lib/data/callback-request-attempts';
import { getCompanyLegal } from '@/lib/data/company';
import {
  createConsoleCall,
  identifyInboundCaller,
  inboundCallsEnabled,
  verifyDialToken,
} from '@/lib/data/console-calls';
import { getSalesVoiceContextByAccessToken } from '@/lib/data/sales-call-attempts';
import { rateLimit } from '@/lib/security/rate-limit';
import { sha256Hex } from '@/lib/security/token-compare';

import { POST as routeInbound } from './console/route-inbound/route';
import { POST as widgetAuthorize } from './console/widget-authorize/route';
import { GET as mtgCtx } from './mtg/ctx/[token]/route';
import { GET as slsCtx } from './sls/ctx/[token]/route';

const SECRET = 'test-console-secret';
const MAX_BODY_BYTES = 1_024;

function post(url: string, raw: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: raw });
}

const CONSOLE_ROUTES = [
  {
    name: 'route-inbound',
    handler: routeInbound,
    url: 'https://beta.kalfa.me/api/voximplant/console/route-inbound',
    scope: 'vox-console-route-inbound',
    refusal: { accept: false },
    valid: { cli: '0501234567', called: '037219347' },
  },
  {
    name: 'widget-authorize',
    handler: widgetAuthorize,
    url: 'https://beta.kalfa.me/api/voximplant/console/widget-authorize',
    scope: 'vox-widget-authorize',
    refusal: { ok: false },
    valid: { token: 'wt' + 'a'.repeat(64) },
  },
] as const;

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('KALFA_CONSOLE_SECRET', SECRET);
  vi.mocked(rateLimit).mockResolvedValue({ allowed: true } as never);
});

describe.each(CONSOLE_ROUTES)('$name — the console-scenario request gate', (route) => {
  const body = (over: Record<string, unknown> = {}) => JSON.stringify({ secret: SECRET, ...route.valid, ...over });

  async function expectRefused(res: Response, status: number) {
    expect(res.status).toBe(status);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual(route.refusal);
    expect(verifyDialToken).not.toHaveBeenCalled();
    expect(identifyInboundCaller).not.toHaveBeenCalled();
    expect(inboundCallsEnabled).not.toHaveBeenCalled();
    expect(createConsoleCall).not.toHaveBeenCalled();
  }

  it('rate-limits per IP under its own scope, 120 a minute, before reading the body', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false } as never);
    const res = await route.handler(post(route.url, body(), { 'x-forwarded-for': '203.0.113.7' }));
    await expectRefused(res, 429);
    const [key, limits] = vi.mocked(rateLimit).mock.calls[0];
    expect(key.startsWith(`${route.scope}:`)).toBe(true);
    expect(limits).toEqual({ limit: 120, windowMs: 60_000 });
  });

  it('413 on a declared Content-Length over 1KB, and on a body that is over it', async () => {
    await expectRefused(
      await route.handler(post(route.url, body(), { 'content-length': String(MAX_BODY_BYTES + 1) })),
      413,
    );
    await expectRefused(await route.handler(post(route.url, body({ pad: 'x'.repeat(MAX_BODY_BYTES) }))), 413);
  });

  it('400 on a body that is not JSON, that misses a field, or that carries an unknown one', async () => {
    await expectRefused(await route.handler(post(route.url, '{not json')), 400);
    await expectRefused(await route.handler(post(route.url, JSON.stringify({ secret: SECRET }))), 400);
    await expectRefused(await route.handler(post(route.url, body({ smuggled: 1 }))), 400);
  });

  it('503 when the shared secret is not configured — never an open gate', async () => {
    vi.stubEnv('KALFA_CONSOLE_SECRET', '');
    await expectRefused(await route.handler(post(route.url, body())), 503);
  });

  // The scenario presents the secret itself; the server compares its SHA-256 in constant time.
  it('401 on a wrong secret, including the hash of the right one instead of the secret', async () => {
    await expectRefused(await route.handler(post(route.url, body({ secret: 'other-secret' }))), 401);
    await expectRefused(await route.handler(post(route.url, body({ secret: sha256Hex(SECRET) }))), 401);
  });
});

describe('the console-scenario request gate — past it', () => {
  it('widget-authorize verifies the dial token as a widget token and refuses with 200 when it is not one', async () => {
    vi.mocked(verifyDialToken).mockResolvedValue({ ok: false } as never);
    const route = CONSOLE_ROUTES[1];
    const res = await route.handler(post(route.url, JSON.stringify({ secret: SECRET, ...route.valid })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
    expect(verifyDialToken).toHaveBeenCalledWith(route.valid.token, 'wt');
  });

  it('route-inbound fails closed with 200 when a cap cannot be measured, and creates no call row', async () => {
    vi.mocked(identifyInboundCaller).mockResolvedValue(null as never);
    vi.mocked(inboundCallsEnabled).mockRejectedValue(new Error('boom'));
    const route = CONSOLE_ROUTES[0];
    const res = await route.handler(post(route.url, JSON.stringify({ secret: SECRET, ...route.valid })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accept: false });
    expect(inboundCallsEnabled).toHaveBeenCalledTimes(1);
    expect(createConsoleCall).not.toHaveBeenCalled();
  });
});

const TOKEN = '0123456789abcdef0123456789abcdef';
const CTX_ROUTES = [
  { name: 'mtg/ctx', handler: mtgCtx, scope: 'vox-mtg-ctx', lookup: getCallbackVoiceContextByAccessToken },
  { name: 'sls/ctx', handler: slsCtx, scope: 'vox-sls-ctx', lookup: getSalesVoiceContextByAccessToken },
] as const;

describe.each(CTX_ROUTES)('$name — the call-context token gate', (route) => {
  const get = (token: string) =>
    route.handler(new Request(`https://beta.kalfa.me/api/voximplant/x/ctx/${token}`), {
      params: Promise.resolve({ token }),
    });

  async function expectBodiless(res: Response, status: number) {
    expect(res.status).toBe(status);
    expect(await res.text()).toBe('');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(getCompanyLegal).not.toHaveBeenCalled();
  }

  it('rate-limits per token and IP under its own scope, 12 per 5 minutes, before any lookup', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false } as never);
    await expectBodiless(await get(TOKEN), 429);
    const [key, limits] = vi.mocked(rateLimit).mock.calls[0];
    expect(key.startsWith(`${route.scope}:`)).toBe(true);
    expect(key).not.toContain(TOKEN);
    expect(limits).toEqual({ limit: 12, windowMs: 5 * 60 * 1000 });
    expect(route.lookup).not.toHaveBeenCalled();
  });

  it.each(['short', 'G'.repeat(32), TOKEN.toUpperCase(), TOKEN + '0'])(
    'answers the generic 404 for a token that is not 32 lowercase hex (%s), without a lookup',
    async (token) => {
      await expectBodiless(await get(token), 404);
      expect(route.lookup).not.toHaveBeenCalled();
    },
  );

  it('answers the same 404 for an unknown token, an expired one and a lookup that throws', async () => {
    vi.mocked(route.lookup).mockResolvedValue(null as never);
    await expectBodiless(await get(TOKEN), 404);

    vi.mocked(route.lookup).mockResolvedValue({
      attempt: { token_expires_at: new Date(Date.now() - 1_000).toISOString() },
    } as never);
    await expectBodiless(await get(TOKEN), 404);

    vi.mocked(route.lookup).mockRejectedValue(new Error('db-host-7 refused'));
    await expectBodiless(await get(TOKEN), 404);
    expect(route.lookup).toHaveBeenCalledWith(TOKEN);
  });
});
