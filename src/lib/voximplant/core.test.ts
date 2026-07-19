import { generateKeyPairSync } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getAuditLog,
  getCallListDetails,
  getCallLists,
  getHistoryReports,
  getMediaResources,
  getPhoneNumbers,
  getRules,
  getTransactionHistory,
  signManagementJwt,
  voxRequest,
  voxRetry,
  VoximplantApiError,
  VoximplantNetworkError,
  type GetHistoryReportsRequest,
  type GetRulesRequest,
  type VoximplantConfig,
} from './core';

// A real RSA key so signManagementJwt (createSign().sign) succeeds; fetch is
// mocked so nothing leaves the process.
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const cfg: VoximplantConfig = { accountId: 1, keyId: 'k', privateKey };

// Build a Response-like object the way voxRequest consumes it: text() first,
// then status/Content-Type, then JSON.parse.
function fakeResponse(
  body: unknown,
  opts: { status?: number; contentType?: string; rawBody?: string } = {},
): Response {
  const status = opts.status ?? 200;
  const text = opts.rawBody ?? JSON.stringify(body);
  const contentType = opts.contentType ?? 'application/json';
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => text,
  } as unknown as Response;
}

// Capture the URLSearchParams body of the last mocked request.
function stubFetch(): { lastBody: () => URLSearchParams } {
  let captured: URLSearchParams = new URLSearchParams();
  vi.stubGlobal('fetch', async (_url: string, init: { body: URLSearchParams }) => {
    captured = init.body;
    return fakeResponse({ result: [] });
  });
  return { lastBody: () => captured };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('typed wrappers protect mandatory ids', () => {
  it('getRules always sends the given application_id, even if params try to override', async () => {
    const { lastBody } = stubFetch();
    // Cast: the request type forbids application_id; this proves the runtime guard.
    await getRules(cfg, 111, { application_id: 999 } as unknown as GetRulesRequest);
    expect(lastBody().get('application_id')).toBe('111');
    expect(lastBody().get('with_scenarios')).toBe('true');
  });

  it('getHistoryReports always sends the given history_report_id', async () => {
    const { lastBody } = stubFetch();
    await getHistoryReports(cfg, 318807, {
      history_report_id: 42,
    } as unknown as GetHistoryReportsRequest);
    expect(lastBody().get('history_report_id')).toBe('318807');
  });
});

describe('getPhoneNumbers (read-only)', () => {
  it('calls the GetPhoneNumbers method and returns the typed list', async () => {
    let capturedUrl = '';
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url);
      return fakeResponse({
        total_count: 1,
        result: [
          {
            phone_id: 7,
            phone_number: '+97233763232',
            phone_name: 'rsvp-caller',
            phone_country_code: 'IL',
            deactivated: false,
            can_be_used: true,
            application_id: 111,
            rule_id: 222,
          },
        ],
      });
    });

    const res = await getPhoneNumbers(cfg);

    expect(capturedUrl).toContain('GetPhoneNumbers');
    expect(res.total_count).toBe(1);
    expect(res.result[0].phone_number).toBe('+97233763232');
    expect(res.result[0].phone_id).toBe(7);
    expect(res.result[0].application_id).toBe(111);
    expect(res.result[0].rule_id).toBe(222);
  });

  it('returns an empty list when the account has no numbers', async () => {
    vi.stubGlobal('fetch', async () => fakeResponse({ total_count: 0, result: [] }));

    const res = await getPhoneNumbers(cfg);
    expect(res.total_count).toBe(0);
    expect(res.result).toEqual([]);
  });
});

describe('getTransactionHistory (read-only)', () => {
  it('sends the mandatory date range and returns the typed ledger', async () => {
    let capturedUrl = '';
    let capturedBody = new URLSearchParams();
    vi.stubGlobal(
      'fetch',
      async (url: string, init: { body: URLSearchParams }) => {
        capturedUrl = String(url);
        capturedBody = init.body;
        return fakeResponse({
          total_count: 2,
          timezone: 'Etc/GMT',
          result: [
            {
              transaction_id: 1,
              performed_at: '2026-07-01 00:00:00',
              transaction_type: 'phone_number_charge',
              amount: -0.85,
              currency: 'USD',
              transaction_description: 'phone number rent',
            },
            {
              transaction_id: 2,
              performed_at: '2026-07-05 10:00:00',
              transaction_type: 'resource_charge',
              amount: -0.12,
              currency: 'USD',
            },
          ],
        });
      },
    );

    const res = await getTransactionHistory(cfg, {
      from_date: '2026-06-01 00:00:00',
      to_date: '2026-07-14 00:00:00',
    });

    expect(capturedUrl).toContain('GetTransactionHistory');
    expect(capturedBody.get('from_date')).toBe('2026-06-01 00:00:00');
    expect(capturedBody.get('to_date')).toBe('2026-07-14 00:00:00');
    expect(res.total_count).toBe(2);
    expect(res.result[0].transaction_type).toBe('phone_number_charge');
    expect(res.result[0].performed_at).toBe('2026-07-01 00:00:00');
    expect(res.result[0].amount).toBeCloseTo(-0.85);
  });
});

describe('signManagementJwt — claims without key exposure', () => {
  const decode = (part: string): Record<string, unknown> =>
    JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;

  it('carries the documented header + payload claims', () => {
    const token = signManagementJwt(cfg, 1_752_000_000);
    const [h, p, sig] = token.split('.');
    expect(decode(h)).toEqual({ typ: 'JWT', alg: 'RS256', kid: 'k' });
    expect(decode(p)).toEqual({
      iss: '1',
      iat: 1_752_000_000,
      exp: 1_752_000_000 + 3600,
    });
    expect(sig.length).toBeGreaterThan(0);
  });

  it('never embeds private-key material in the token', () => {
    const token = signManagementJwt(cfg);
    const decodedAll = Buffer.from(
      token.replaceAll('.', ''),
      'base64url',
    ).toString('latin1');
    expect(token).not.toContain('PRIVATE KEY');
    expect(decodedAll).not.toContain('PRIVATE KEY');
    // The PEM body must not appear in any part of the token.
    const pemBody = privateKey
      .replace(/-----[A-Z ]+-----/g, '')
      .replace(/\s+/g, '')
      .slice(0, 40);
    expect(token.replaceAll('.', '')).not.toContain(pemBody);
  });
});

describe('voxRequest — text-first response classification', () => {
  it('parses a valid application/json body', async () => {
    vi.stubGlobal('fetch', async () => fakeResponse({ result: 1 }));
    await expect(voxRequest(cfg, 'GetAccountInfo')).resolves.toEqual({
      result: 1,
    });
  });

  it('rejects an HTML body (login/error page) as a network error, even with HTTP 200', async () => {
    vi.stubGlobal('fetch', async () =>
      fakeResponse(null, {
        contentType: 'text/html; charset=utf-8',
        rawBody: '<html><body>Maintenance</body></html>',
      }),
    );
    await expect(voxRequest(cfg, 'GetAccountInfo')).rejects.toThrow(
      VoximplantNetworkError,
    );
  });

  it('maps 401 and 403 to VoximplantNetworkError carrying the HTTP status', async () => {
    for (const status of [401, 403]) {
      vi.stubGlobal('fetch', async () =>
        fakeResponse(null, { status, contentType: 'text/html', rawBody: 'denied' }),
      );
      const err = await voxRequest(cfg, 'GetAccountInfo').then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(VoximplantNetworkError);
      expect((err as VoximplantNetworkError).status).toBe(status);
    }
  });

  it('maps a business-error envelope to VoximplantApiError with its code', async () => {
    vi.stubGlobal('fetch', async () =>
      fakeResponse({ error: { code: 340, msg: 'rate limit' } }),
    );
    const err = await voxRequest(cfg, 'GetAccountInfo').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(VoximplantApiError);
    expect((err as VoximplantApiError).code).toBe(340);
  });

  it('signs a FRESH JWT for every request (renewal is automatic per call)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-19T10:00:00Z'));
    const tokens: string[] = [];
    vi.stubGlobal(
      'fetch',
      async (_url: string, init: { headers: Record<string, string> }) => {
        tokens.push(init.headers.Authorization);
        return fakeResponse({ result: 1 });
      },
    );
    await voxRequest(cfg, 'GetAccountInfo');
    vi.setSystemTime(new Date('2026-07-19T10:00:05Z'));
    await voxRequest(cfg, 'GetAccountInfo');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]); // different iat → different token
  });
});

describe('voxRetry — bounded backoff + one-time 456 renewal', () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number): Promise<void> => {
    sleeps.push(ms);
  };

  it('retries HTTP 429 with doubling backoff and then succeeds', async () => {
    sleeps.length = 0;
    let calls = 0;
    const run = async (): Promise<string> => {
      calls += 1;
      if (calls < 3) throw new VoximplantNetworkError('rate', 429);
      return 'ok';
    };
    await expect(voxRetry(run, { sleep, baseDelayMs: 100 })).resolves.toBe('ok');
    expect(calls).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it('gives up after the bounded attempt count on persistent 429', async () => {
    sleeps.length = 0;
    let calls = 0;
    const run = async (): Promise<never> => {
      calls += 1;
      throw new VoximplantNetworkError('rate', 429);
    };
    await expect(voxRetry(run, { sleep, attempts: 4, baseDelayMs: 1 })).rejects.toThrow(
      VoximplantNetworkError,
    );
    expect(calls).toBe(4);
    expect(sleeps).toEqual([1, 2, 4]);
  });

  it('retries API codes 340 and 515', async () => {
    for (const code of [340, 515]) {
      let calls = 0;
      const run = async (): Promise<string> => {
        calls += 1;
        if (calls === 1) throw new VoximplantApiError('limited', code);
        return 'ok';
      };
      await expect(voxRetry(run, { sleep, baseDelayMs: 1 })).resolves.toBe('ok');
      expect(calls).toBe(2);
    }
  });

  it('renews once on 456 (token expired) — immediately, without backoff', async () => {
    sleeps.length = 0;
    let calls = 0;
    const run = async (): Promise<string> => {
      calls += 1;
      if (calls === 1) throw new VoximplantApiError('expired', 456);
      return 'ok';
    };
    await expect(voxRetry(run, { sleep })).resolves.toBe('ok');
    expect(calls).toBe(2);
    expect(sleeps).toEqual([]); // renewal is immediate, not a backoff retry
  });

  it('does NOT renew twice on persistent 456', async () => {
    let calls = 0;
    const run = async (): Promise<never> => {
      calls += 1;
      throw new VoximplantApiError('expired', 456);
    };
    await expect(voxRetry(run, { sleep })).rejects.toThrow(VoximplantApiError);
    expect(calls).toBe(2); // original + exactly one renewal
  });

  it('does not retry non-retryable errors (e.g. code 550 auth failure)', async () => {
    let calls = 0;
    const run = async (): Promise<never> => {
      calls += 1;
      throw new VoximplantApiError('denied', 550);
    };
    await expect(voxRetry(run, { sleep })).rejects.toThrow(VoximplantApiError);
    expect(calls).toBe(1);
  });
});

describe('A1-A3 read-only wrappers (plan stage 1)', () => {
  it('getCallListDetails pins list_id after the spread and FORCES output=json', async () => {
    const { lastBody } = stubFetch();
    await getCallListDetails(cfg, 318, {
      list_id: 999,
      output: 'xls',
    } as unknown as Parameters<typeof getCallListDetails>[2]);
    expect(lastBody().get('list_id')).toBe('318');
    expect(lastBody().get('output')).toBe('json');
  });

  it('getCallLists passes documented filters through', async () => {
    const { lastBody } = stubFetch();
    await getCallLists(cfg, { is_active: true, type_list: 'AUTOMATIC', count: 5 });
    expect(lastBody().get('is_active')).toBe('true');
    expect(lastBody().get('type_list')).toBe('AUTOMATIC');
    expect(lastBody().get('count')).toBe('5');
  });

  it('getAuditLog re-sets the mandatory window after the spread', async () => {
    const { lastBody } = stubFetch();
    await getAuditLog(cfg, {
      from_date: '2026-07-01 00:00:00',
      to_date: '2026-07-19 00:00:00',
      count: 10,
    });
    expect(lastBody().get('from_date')).toBe('2026-07-01 00:00:00');
    expect(lastBody().get('to_date')).toBe('2026-07-19 00:00:00');
  });

  it('getMediaResources issues a bare GET with NO Authorization header', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedInit = init;
      return fakeResponse({ jsservers: ['84.201.130.55'] });
    });
    const res = await getMediaResources({ with_jsservers: true, with_nodes: true });
    expect(capturedUrl).toBe(
      'https://api.voximplant.com/getMediaResources?with_jsservers&with_nodes',
    );
    expect(capturedInit?.method).toBe('GET');
    expect(
      (capturedInit?.headers as Record<string, string> | undefined)?.Authorization,
    ).toBeUndefined();
    expect(res).toEqual({ jsservers: ['84.201.130.55'] });
  });
});
