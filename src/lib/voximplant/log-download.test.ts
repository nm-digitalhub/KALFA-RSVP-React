import { describe, expect, it } from 'vitest';

import {
  downloadLogFile,
  isPrivateIp,
  validateLogUrl,
  MAX_LOG_BYTES,
} from './log-download';

const GOOD_URL = 'https://storage-gw-us-01.voximplant.com/voxdata-us-logs/x.log';

function fakeResponse(opts: {
  status?: number;
  body?: string;
  contentType?: string;
  contentLength?: string;
}): Response {
  const status = opts.status ?? 200;
  const body = opts.body ?? 'log line';
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (h: string) => {
        const k = h.toLowerCase();
        if (k === 'content-type') return opts.contentType ?? 'text/plain';
        if (k === 'content-length') return opts.contentLength ?? null;
        return null;
      },
    },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  } as unknown as Response;
}

const publicLookup = async () => [{ address: '84.201.130.55' }];

describe('validateLogUrl (gate 1 — pure)', () => {
  it('accepts the verified storage-gateway pattern', () => {
    expect(validateLogUrl(GOOD_URL)).toEqual({ ok: true, host: 'storage-gw-us-01.voximplant.com' });
  });
  it.each([
    ['http://storage-gw-us-01.voximplant.com/x', 'not_https'],
    ['https://storage-gw-us-01.voximplant.com:8443/x', 'bad_port'],
    ['https://user:pw@storage-gw-us-01.voximplant.com/x', 'has_credentials'],
    ['https://evil.example.com/x', 'host_not_allowlisted'],
    ['https://voximplant.com.evil.io/x', 'host_not_allowlisted'],
    ['https://api.voximplant.com/x', 'host_not_allowlisted'], // pattern, not wildcard
    ['not a url', 'unparseable'],
  ])('rejects %s → %s', (url, reason) => {
    expect(validateLogUrl(url)).toMatchObject({ ok: false, reason });
  });
});

describe('isPrivateIp (gate 2 — pure)', () => {
  it.each([
    '10.1.2.3',
    '192.168.1.1',
    '172.16.0.9',
    '172.31.255.255',
    '127.0.0.1',
    '169.254.169.254',
    '100.64.1.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fd12::2',
    'fe80::1',
    '::ffff:10.0.0.1',
  ])('flags %s as private/reserved', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });
  it.each(['84.201.130.55', '8.8.8.8', '2a01:4f8::1', '172.32.0.1'])(
    'allows public %s',
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );
});

describe('downloadLogFile (gates composed)', () => {
  it('downloads anonymously from a valid host (no Authorization header sent)', async () => {
    const authHeaders: Array<string | undefined> = [];
    const res = await downloadLogFile(GOOD_URL, {
      lookupImpl: publicLookup,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        authHeaders.push((init.headers as Record<string, string>).Authorization);
        return fakeResponse({ body: 'hello log' });
      }) as unknown as typeof fetch,
      jwtProvider: () => 'JWT-SHOULD-NOT-BE-USED',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.bytes.toString()).toBe('hello log');
      expect(res.authUsed).toBe(false);
    }
    expect(authHeaders).toEqual([undefined]);
  });

  it('retries WITH the JWT only after an anonymous 401', async () => {
    const calls: Array<string | undefined> = [];
    const res = await downloadLogFile(GOOD_URL, {
      lookupImpl: publicLookup,
      fetchImpl: (async (_url: string, init: RequestInit) => {
        const auth = (init.headers as Record<string, string>).Authorization;
        calls.push(auth);
        return auth ? fakeResponse({ body: 'authed log' }) : fakeResponse({ status: 401 });
      }) as unknown as typeof fetch,
      jwtProvider: () => 'THE-JWT',
    });
    expect(calls).toEqual([undefined, 'Bearer THE-JWT']);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.authUsed).toBe(true);
  });

  it('does NOT retry with JWT when no jwtProvider is given', async () => {
    let count = 0;
    const res = await downloadLogFile(GOOD_URL, {
      lookupImpl: publicLookup,
      fetchImpl: (async () => {
        count += 1;
        return fakeResponse({ status: 401 });
      }) as unknown as typeof fetch,
    });
    expect(count).toBe(1);
    expect(res).toMatchObject({ ok: false, reason: 'http_error', status: 401 });
  });

  it('rejects when DNS resolves to a private address — before any fetch', async () => {
    let fetched = false;
    const res = await downloadLogFile(GOOD_URL, {
      lookupImpl: async () => [{ address: '84.201.130.55' }, { address: '10.0.0.7' }],
      fetchImpl: (async () => {
        fetched = true;
        return fakeResponse({});
      }) as unknown as typeof fetch,
    });
    expect(res).toMatchObject({ ok: false, reason: 'private_ip' });
    expect(fetched).toBe(false);
  });

  it('rejects redirects instead of following them', async () => {
    const res = await downloadLogFile(GOOD_URL, {
      lookupImpl: publicLookup,
      fetchImpl: (async () => fakeResponse({ status: 302 })) as unknown as typeof fetch,
    });
    expect(res).toMatchObject({ ok: false, reason: 'redirect', status: 302 });
  });

  it('rejects oversized bodies via header and via actual size', async () => {
    const byHeader = await downloadLogFile(GOOD_URL, {
      lookupImpl: publicLookup,
      fetchImpl: (async () =>
        fakeResponse({ contentLength: String(MAX_LOG_BYTES + 1) })) as unknown as typeof fetch,
    });
    expect(byHeader).toMatchObject({ ok: false, reason: 'too_large' });

    const byBody = await downloadLogFile(GOOD_URL, {
      lookupImpl: publicLookup,
      maxBytes: 4,
      fetchImpl: (async () => fakeResponse({ body: 'longer than four' })) as unknown as typeof fetch,
    });
    expect(byBody).toMatchObject({ ok: false, reason: 'too_large' });
  });

  it('never fetches a disallowed URL at all', async () => {
    let fetched = false;
    const res = await downloadLogFile('https://evil.example.com/x.log', {
      lookupImpl: publicLookup,
      fetchImpl: (async () => {
        fetched = true;
        return fakeResponse({});
      }) as unknown as typeof fetch,
    });
    expect(res).toMatchObject({ ok: false, reason: 'host_not_allowlisted' });
    expect(fetched).toBe(false);
  });

  it('maps DNS failure and transport failure to typed reasons', async () => {
    const dns = await downloadLogFile(GOOD_URL, {
      lookupImpl: async () => {
        throw new Error('ENOTFOUND');
      },
      fetchImpl: (async () => fakeResponse({})) as unknown as typeof fetch,
    });
    expect(dns).toMatchObject({ ok: false, reason: 'dns_failed' });

    const transport = await downloadLogFile(GOOD_URL, {
      lookupImpl: publicLookup,
      fetchImpl: (async () => {
        throw new Error('socket hang up');
      }) as unknown as typeof fetch,
    });
    expect(transport).toMatchObject({ ok: false, reason: 'transport' });
  });
});
