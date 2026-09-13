import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { debugToken } from './debug-token';

const APP_ID = '1234567890123456';
const APP_SECRET = 'APP-SECRET-DO-NOT-LEAK';
const TOKEN = 'EAAG-SYSTEM-USER-TOKEN-DO-NOT-LEAK';

const CREDS = { appId: APP_ID, appSecret: APP_SECRET, token: TOKEN };

// Typed as fetch's own signature so the call arguments stay inspectable — a bare
// `vi.fn(async () => …)` infers a zero-arg tuple and tsc then refuses to index it.
function mockFetch(status: number, body: unknown) {
  const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('debugToken — the request', () => {
  it('GETs the versioned endpoint with the token under inspection and the APP token', async () => {
    const spy = mockFetch(200, { data: { is_valid: true } });
    await debugToken(CREDS);

    const url = new URL(String(spy.mock.calls[0][0]));
    expect(url.pathname).toBe('/v25.0/debug_token');
    expect(url.searchParams.get('input_token')).toBe(TOKEN);
    // The app access token is literally "{app-id}|{app-secret}" — a token
    // belonging to the app, not the token being inspected. Passing the same
    // token for both is the mistake this pins.
    expect(url.searchParams.get('access_token')).toBe(`${APP_ID}|${APP_SECRET}`);
  });

  it('never caches — the point is the CURRENT state of the token', async () => {
    const spy = mockFetch(200, { data: { is_valid: true } });
    await debugToken(CREDS);
    expect(spy.mock.calls[0][1]?.cache).toBe('no-store');
  });
});

describe('debugToken — the answer', () => {
  it('reads validity, both expiries and the scopes', async () => {
    mockFetch(200, {
      data: {
        is_valid: true,
        expires_at: 0,
        data_access_expires_at: 1796601600,
        scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
      },
    });
    await expect(debugToken(CREDS)).resolves.toEqual({
      isValid: true,
      expiresAt: 0,
      dataAccessExpiresAt: 1796601600,
      scopes: ['whatsapp_business_messaging', 'whatsapp_business_management'],
      invalidReason: null,
    });
  });

  it('keeps expires_at = 0 as 0 rather than collapsing it into "unknown"', async () => {
    // 0 is the value every long-lived System User token returns. Mapping it to
    // null would make "no expiry" indistinguishable from "Meta did not say".
    mockFetch(200, { data: { is_valid: true, expires_at: 0 } });
    const res = await debugToken(CREDS);
    expect(res.expiresAt).toBe(0);
    expect(res.dataAccessExpiresAt).toBeNull();
  });

  it('an invalid token is an ANSWER, not an exception, and carries Meta’s reason', async () => {
    mockFetch(200, {
      data: { is_valid: false, error: { code: 190, message: 'Session has expired' } },
    });
    await expect(debugToken(CREDS)).resolves.toMatchObject({
      isValid: false,
      invalidReason: 'Session has expired',
    });
  });

  it('drops non-string entries out of scopes instead of trusting the array', async () => {
    mockFetch(200, { data: { is_valid: true, scopes: ['a', 7, null, 'b'] } });
    await expect(debugToken(CREDS)).resolves.toMatchObject({ scopes: ['a', 'b'] });
  });
});

describe('debugToken — failures stay separable, and stay quiet', () => {
  it('rejected APP credentials throw a DIFFERENT error than an invalid token', async () => {
    // Same screen, different fix: one means the app id/secret pair is wrong,
    // the other means the WhatsApp token needs replacing.
    mockFetch(400, { error: { code: 190, message: 'Invalid OAuth access token' } });
    await expect(debugToken(CREDS)).rejects.toThrow(/app credentials/);
  });

  it('a non-JSON or empty body fails on the status, not on a parse crash', async () => {
    const spy = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    }));
    vi.stubGlobal('fetch', spy);
    await expect(debugToken(CREDS)).rejects.toThrow(/HTTP 502/);
  });

  it('NO secret appears in any thrown message', async () => {
    for (const body of [
      { error: { code: 190, message: 'Invalid OAuth access token' } },
      {},
    ]) {
      mockFetch(400, body);
      const err = await debugToken(CREDS).catch((e: Error) => e.message);
      expect(String(err)).not.toContain(APP_SECRET);
      expect(String(err)).not.toContain(TOKEN);
      expect(String(err)).not.toContain(`${APP_ID}|`);
    }
  });
});
