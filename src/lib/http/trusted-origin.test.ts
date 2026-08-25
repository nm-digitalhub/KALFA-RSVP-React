import { afterEach, describe, expect, it, vi } from 'vitest';

import { trustedAppOrigin } from './trusted-origin';

describe('trustedAppOrigin', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('resolves from APP_ORIGIN, never from a request', () => {
    vi.stubEnv('APP_ORIGIN', 'https://beta.kalfa.me');
    expect(trustedAppOrigin()).toBe('https://beta.kalfa.me');
  });

  it('strips a trailing path from APP_ORIGIN down to the bare origin', () => {
    vi.stubEnv('APP_ORIGIN', 'https://beta.kalfa.me/');
    expect(trustedAppOrigin()).toBe('https://beta.kalfa.me');
  });

  it('throws in production when APP_ORIGIN is unset — fails closed, never falls back to a request Host', () => {
    vi.stubEnv('APP_ORIGIN', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => trustedAppOrigin()).toThrow(/APP_ORIGIN is required in production/);
  });

  it('falls back to a fixed localhost origin outside production', () => {
    vi.stubEnv('APP_ORIGIN', '');
    vi.stubEnv('NODE_ENV', 'test');
    expect(trustedAppOrigin()).toBe('http://127.0.0.1:3000');
  });

  it('rejects a non-http(s) APP_ORIGIN', () => {
    vi.stubEnv('APP_ORIGIN', 'ftp://evil.example');
    expect(() => trustedAppOrigin()).toThrow(/must use http/);
  });

  it('rejects an APP_ORIGIN carrying a path', () => {
    vi.stubEnv('APP_ORIGIN', 'https://beta.kalfa.me/some/path');
    expect(() => trustedAppOrigin()).toThrow(/must not include a path/);
  });
});
