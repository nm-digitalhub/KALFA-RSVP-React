import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '@/lib/security/token-compare';
import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

vi.mock('server-only', () => ({}));

const { hashMock, stampMock, pullMock } = vi.hoisted(() => ({
  hashMock: vi.fn(),
  stampMock: vi.fn(),
  pullMock: vi.fn(),
}));
vi.mock('@/lib/data/voximplant-account-callback', () => ({
  getAccountCallbackTokenHash: hashMock,
  stampBalanceCallbackReceived: stampMock,
  runVerifiedBalancePull: pullMock,
}));

import { POST } from './route';

const TOKEN = 'a'.repeat(32);
const HASH = sha256Hex(TOKEN);

function req(token: string, body: string, headers: Record<string, string> = {}) {
  return new Request(`https://kalfa.test/api/voximplant/account-callback/${token}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': '203.0.113.9', ...headers },
    body,
  });
}
const call = (token: string, body: string, headers?: Record<string, string>) =>
  POST(req(token, body, headers), { params: Promise.resolve({ token }) });

beforeEach(() => {
  __resetRateLimitStateForTests();
  hashMock.mockReset().mockResolvedValue(HASH);
  stampMock.mockReset().mockResolvedValue(undefined);
  pullMock.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

describe('POST /api/voximplant/account-callback/[token]', () => {
  it('accepts a valid token, stamps receipt, runs the verified pull, returns 200', async () => {
    const res = await call(TOKEN, JSON.stringify({ callbacks: [{ type: 'min_balance', callback_id: 1 }] }));
    expect(res.status).toBe(200);
    expect(stampMock).toHaveBeenCalledOnce();
    expect(pullMock).toHaveBeenCalledOnce();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('runs the verified pull EVEN when the body is unparseable — it is only a poke', async () => {
    const res = await call(TOKEN, '<not json>');
    expect(res.status).toBe(200);
    expect(pullMock).toHaveBeenCalledOnce();
  });

  it('is DARK (404) when no token is wired — pull never runs', async () => {
    hashMock.mockResolvedValue(null);
    const res = await call(TOKEN, JSON.stringify({ callbacks: [] }));
    expect(res.status).toBe(404);
    expect(pullMock).not.toHaveBeenCalled();
  });

  it('rejects a wrong token with a generic 404', async () => {
    const res = await call('b'.repeat(32), JSON.stringify({ callbacks: [] }));
    expect(res.status).toBe(404);
    expect(pullMock).not.toHaveBeenCalled();
  });

  it('maps a DB error on the hash lookup to 404 (never leaks)', async () => {
    hashMock.mockRejectedValue(new Error('db down'));
    const res = await call(TOKEN, JSON.stringify({ callbacks: [] }));
    expect(res.status).toBe(404);
  });

  it('rejects an oversized body (Content-Length hint) with 413', async () => {
    const res = await call(TOKEN, '{}', { 'content-length': String(64 * 1024 + 1) });
    expect(res.status).toBe(413);
  });

  it('rate-limits fail-closed (21st request in the window → 429)', async () => {
    for (let i = 0; i < 20; i++) {
      const ok = await call(TOKEN, JSON.stringify({ callbacks: [] }));
      expect(ok.status).toBe(200);
    }
    const limited = await call(TOKEN, JSON.stringify({ callbacks: [] }));
    expect(limited.status).toBe(429);
  });

  it('throttles the verified PULL (≤2/min) even across many valid pokes', async () => {
    // 5 valid pokes from distinct IPs (so the per-ip request limiter never trips),
    // but the shared pull limiter caps GetAccountInfo at 2/min.
    for (let i = 0; i < 5; i++) {
      const res = await POST(
        req(TOKEN, JSON.stringify({ callbacks: [] }), { 'x-forwarded-for': `203.0.113.${i}` }),
        { params: Promise.resolve({ token: TOKEN }) },
      );
      expect(res.status).toBe(200);
    }
    expect(pullMock).toHaveBeenCalledTimes(2);
  });
});
