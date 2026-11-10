import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

import { guardCallContextRequest } from './call-context-guard';

const HEX = '0123456789abcdef0123456789abcdef';
const future = () => new Date(Date.now() + 3600_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

type Ctx = { attempt: { id: string; token_expires_at: string } };
const row = (expires: string): Ctx => ({ attempt: { id: 'a1', token_expires_at: expires } });

function req(ip = '6.6.6.6'): Request {
  return new Request('https://beta.kalfa.me/api/voximplant/ctx/x', { headers: { 'x-real-ip': ip } });
}

describe('guardCallContextRequest', () => {
  beforeEach(() => __resetRateLimitStateForTests());

  it('returns the looked-up row for a live token', async () => {
    const lookup = vi.fn(async () => row(future()));
    const res = await guardCallContextRequest(req(), HEX, { scope: 't-ctx', tokenShape: 'hex32', lookup });
    expect(res).toEqual({ ok: true, ctx: row((res as { ctx: Ctx }).ctx.attempt.token_expires_at) });
    expect(lookup).toHaveBeenCalledWith(HEX);
  });

  it('hex32 rejects a malformed token with 404 before any lookup', async () => {
    const lookup = vi.fn(async () => row(future()));
    for (const token of ['', 'abc', HEX.toUpperCase(), `${HEX}0`, 'g'.repeat(32)]) {
      const res = await guardCallContextRequest(req(), token, { scope: 't-ctx', tokenShape: 'hex32', lookup });
      expect(res).toEqual({ ok: false, status: 404 });
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('opaque accepts any non-empty token up to 256 chars and rejects the rest unlooked', async () => {
    const lookup = vi.fn(async () => row(future()));
    const opts = { scope: 't-ctx', tokenShape: 'opaque', lookup } as const;
    expect((await guardCallContextRequest(req(), 'not-hex!', opts)).ok).toBe(true);
    expect((await guardCallContextRequest(req(), 'x'.repeat(256), opts)).ok).toBe(true);
    lookup.mockClear();
    expect(await guardCallContextRequest(req(), '', opts)).toEqual({ ok: false, status: 404 });
    expect(await guardCallContextRequest(req(), 'x'.repeat(257), opts)).toEqual({ ok: false, status: 404 });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('answers the same 404 for an unknown token, a lookup error and an expired token', async () => {
    const opts = { scope: 't-ctx', tokenShape: 'hex32' } as const;
    const unknown = await guardCallContextRequest(req(), HEX, { ...opts, lookup: async () => null });
    const dbError = await guardCallContextRequest<Ctx>(req(), HEX, {
      ...opts,
      lookup: async () => {
        throw new Error('db down');
      },
    });
    const expired = await guardCallContextRequest(req(), HEX, { ...opts, lookup: async () => row(past()) });
    for (const res of [unknown, dbError, expired]) expect(res).toEqual({ ok: false, status: 404 });
  });

  it('rate-limits at 12 per token+IP per scope, before the shape check', async () => {
    const lookup = vi.fn(async () => row(future()));
    const opts = { scope: 't-ctx-rl', tokenShape: 'hex32', lookup } as const;
    for (let i = 0; i < 12; i++) {
      expect((await guardCallContextRequest(req(), HEX, opts)).ok).toBe(true);
    }
    expect(await guardCallContextRequest(req(), HEX, opts)).toEqual({ ok: false, status: 429 });
    // Another IP and another scope are separate budgets.
    expect((await guardCallContextRequest(req('7.7.7.7'), HEX, opts)).ok).toBe(true);
    expect((await guardCallContextRequest(req(), HEX, { ...opts, scope: 't-ctx-other' })).ok).toBe(true);
  });
});
