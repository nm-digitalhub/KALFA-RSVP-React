import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getClientIp, rateLimit } from './rate-limit';

// Build a header getter from a plain map for testing getClientIp.
function makeGetter(headers: Record<string, string | null>) {
  return (name: string): string | null =>
    name in headers ? headers[name] : null;
}

describe('getClientIp', () => {
  it("uses the first comma-separated value of x-forwarded-for", () => {
    const get = makeGetter({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' });
    expect(getClientIp(get)).toBe('203.0.113.7');
  });

  it('trims whitespace around the forwarded value', () => {
    const get = makeGetter({ 'x-forwarded-for': '  198.51.100.5  , 10.0.0.1' });
    expect(getClientIp(get)).toBe('198.51.100.5');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const get = makeGetter({ 'x-real-ip': '192.0.2.44' });
    expect(getClientIp(get)).toBe('192.0.2.44');
  });

  it('falls back to x-real-ip when x-forwarded-for is empty/whitespace', () => {
    const get = makeGetter({ 'x-forwarded-for': '   ', 'x-real-ip': '192.0.2.99' });
    expect(getClientIp(get)).toBe('192.0.2.99');
  });

  it("returns 'unknown' when no IP headers are present", () => {
    const get = makeGetter({});
    expect(getClientIp(get)).toBe('unknown');
  });

  it("returns 'unknown' when both IP headers are blank", () => {
    const get = makeGetter({ 'x-forwarded-for': '', 'x-real-ip': '  ' });
    expect(getClientIp(get)).toBe('unknown');
  });
});

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-23T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within the limit', () => {
    // Unique key per test so module-level state does not bleed across cases.
    const key = 'within-limit';
    const opts = { limit: 3, windowMs: 1000 };

    const first = rateLimit(key, opts);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);

    const second = rateLimit(key, opts);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(1);

    const third = rateLimit(key, opts);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it('blocks requests once over the limit', () => {
    const key = 'over-limit';
    const opts = { limit: 2, windowMs: 1000 };

    expect(rateLimit(key, opts).allowed).toBe(true);
    expect(rateLimit(key, opts).allowed).toBe(true);

    const blocked = rateLimit(key, opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('keeps resetAt stable across requests in the same window', () => {
    const key = 'stable-reset';
    const opts = { limit: 5, windowMs: 1000 };

    const first = rateLimit(key, opts);
    expect(first.resetAt).toBe(Date.now() + opts.windowMs);

    vi.advanceTimersByTime(300);
    const second = rateLimit(key, opts);
    expect(second.resetAt).toBe(first.resetAt);
  });

  it('resets the counter after the window elapses', () => {
    const key = 'window-reset';
    const opts = { limit: 1, windowMs: 1000 };

    const first = rateLimit(key, opts);
    expect(first.allowed).toBe(true);

    // Second request in the same window is blocked.
    expect(rateLimit(key, opts).allowed).toBe(false);

    // Advance past the window: a fresh window opens and the request is allowed.
    vi.advanceTimersByTime(1001);
    const afterReset = rateLimit(key, opts);
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(0);
    expect(afterReset.resetAt).toBe(Date.now() + opts.windowMs);
  });

  it('tracks distinct keys independently', () => {
    const opts = { limit: 1, windowMs: 1000 };

    expect(rateLimit('key-a', opts).allowed).toBe(true);
    // A different key has its own fresh window.
    expect(rateLimit('key-b', opts).allowed).toBe(true);
    // The first key is now over its limit.
    expect(rateLimit('key-a', opts).allowed).toBe(false);
  });
});
