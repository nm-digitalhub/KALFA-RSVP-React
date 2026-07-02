import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

import { isAllowedOrigin } from './allowed-origin';

const APP_ORIGIN = 'https://kalfa.test';
const CROSS_ORIGIN = 'https://evil.test';

function request(headers: Record<string, string>): NextRequest {
  return new Request(`${APP_ORIGIN}/api/whatever`, { headers }) as unknown as NextRequest;
}

describe('isAllowedOrigin', () => {
  beforeEach(() => {
    vi.stubEnv('APP_ORIGIN', APP_ORIGIN);
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows a same-origin Origin header', () => {
    expect(isAllowedOrigin(request({ Origin: APP_ORIGIN }))).toBe(true);
  });

  it('denies a cross-origin Origin header', () => {
    expect(isAllowedOrigin(request({ Origin: CROSS_ORIGIN }))).toBe(false);
  });

  it('falls back to a same-origin Referer when Origin is absent', () => {
    expect(isAllowedOrigin(request({ Referer: `${APP_ORIGIN}/app/events/123` }))).toBe(true);
  });

  it('denies a cross-origin Referer when Origin is absent', () => {
    expect(isAllowedOrigin(request({ Referer: `${CROSS_ORIGIN}/app/events/123` }))).toBe(false);
  });

  it('denies when both Origin and Referer are absent', () => {
    expect(isAllowedOrigin(request({}))).toBe(false);
  });

  it('denies (not throws) on a malformed Referer with no Origin', () => {
    expect(() => isAllowedOrigin(request({ Referer: 'not a valid url' }))).not.toThrow();
    expect(isAllowedOrigin(request({ Referer: 'not a valid url' }))).toBe(false);
  });

  it('allows the localhost:3002 dev origin only when NODE_ENV=development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(isAllowedOrigin(request({ Origin: 'http://localhost:3002' }))).toBe(true);
  });

  it('does not leak the dev-only localhost:3002 bypass outside development', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(isAllowedOrigin(request({ Origin: 'http://localhost:3002' }))).toBe(false);
  });

  it('throws when APP_ORIGIN is not configured', () => {
    vi.stubEnv('APP_ORIGIN', undefined);
    expect(() => isAllowedOrigin(request({ Origin: APP_ORIGIN }))).toThrow(
      'APP_ORIGIN env var is not configured',
    );
  });
});
