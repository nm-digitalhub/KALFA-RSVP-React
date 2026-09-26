import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { appSecretProof } from '../appsecret-proof';
import { GRAPH_API_VERSION } from '../graph-version';
import {
  exchangeCodeForBusinessToken,
  getCoexistenceStatus,
  requestSmbSync,
  subscribeAppToWaba,
} from './graph';

function json(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

describe('exchangeCodeForBusinessToken', () => {
  it('GETs oauth/access_token on the pinned version and returns access_token', async () => {
    fetchSpy.mockResolvedValueOnce(json({ access_token: 'BIZ', token_type: 'bearer' }));
    await expect(
      exchangeCodeForBusinessToken({ appId: '1', appSecret: 'SECRET', code: 'CODE' }),
    ).resolves.toBe('BIZ');
    const url = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(url.pathname).toBe(`/${GRAPH_API_VERSION}/oauth/access_token`);
    expect(url.searchParams.get('client_id')).toBe('1');
    expect(url.searchParams.get('code')).toBe('CODE');
  });

  it('never puts the secret or the code in the thrown message', async () => {
    fetchSpy.mockResolvedValueOnce(
      json({ error: { code: 100, message: 'code CODE secret SECRET' } }, false, 400),
    );
    const err = await exchangeCodeForBusinessToken({
      appId: '1',
      appSecret: 'SECRET',
      code: 'CODE',
    }).catch((e: Error) => e);
    expect(String(err)).not.toMatch(/SECRET|CODE/);
    expect(String(err)).toContain('code 100');
  });

  it('rejects a 200 without an access_token', async () => {
    fetchSpy.mockResolvedValueOnce(json({}));
    await expect(
      exchangeCodeForBusinessToken({ appId: '1', appSecret: 'S', code: 'C' }),
    ).rejects.toThrow('token exchange failed');
  });
});

describe('subscribeAppToWaba', () => {
  it('POSTs /{waba}/subscribed_apps with the business token', async () => {
    fetchSpy.mockResolvedValueOnce(json({ success: true }));
    await subscribeAppToWaba({ wabaId: '222', token: 'BIZ', appSecret: 'APP-SECRET' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(`https://graph.facebook.com/${GRAPH_API_VERSION}/222/subscribed_apps`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer BIZ');
  });

  it('throws on success:false', async () => {
    fetchSpy.mockResolvedValueOnce(json({ success: false }));
    await expect(subscribeAppToWaba({ wabaId: '222', token: 'BIZ', appSecret: 'APP-SECRET' })).rejects.toThrow();
  });
});

describe('getCoexistenceStatus', () => {
  it('reads is_on_biz_app and platform_type', async () => {
    fetchSpy.mockResolvedValueOnce(json({ is_on_biz_app: true, platform_type: 'CLOUD_API', id: '9' }));
    await expect(getCoexistenceStatus({ phoneNumberId: '9', token: 'BIZ', appSecret: 'APP-SECRET' })).resolves.toEqual({
      isOnBizApp: true,
      platformType: 'CLOUD_API',
    });
    const u = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(u.pathname).toBe(`/${GRAPH_API_VERSION}/9`);
    expect(u.searchParams.get('fields')).toBe('is_on_biz_app,platform_type');
  });
});

describe('requestSmbSync', () => {
  it('POSTs smb_app_data with the sync type and returns request_id', async () => {
    fetchSpy.mockResolvedValueOnce(json({ messaging_product: 'whatsapp', request_id: 'R1' }));
    await expect(
      requestSmbSync({ phoneNumberId: '9', token: 'BIZ', appSecret: 'APP-SECRET', syncType: 'history' }),
    ).resolves.toEqual({ requestId: 'R1' });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe(`/${GRAPH_API_VERSION}/9/smb_app_data`);
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      sync_type: 'history',
    });
  });
});

describe('every call made with the business token carries appsecret_proof', () => {
  const NOW = 1790000000;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
  });
  afterEach(() => vi.useRealTimers());

  const expected = appSecretProof('BIZ', 'APP-SECRET', NOW);
  const proofOf = (call: unknown[]) => {
    const u = new URL(call[0] as string);
    return {
      appsecret_proof: u.searchParams.get('appsecret_proof'),
      appsecret_time: u.searchParams.get('appsecret_time'),
    };
  };

  it('subscribed_apps', async () => {
    fetchSpy.mockResolvedValueOnce(json({ success: true }));
    await subscribeAppToWaba({ wabaId: '222', token: 'BIZ', appSecret: 'APP-SECRET' });
    expect(proofOf(fetchSpy.mock.calls[0])).toEqual(expected);
  });

  it('phone status', async () => {
    fetchSpy.mockResolvedValueOnce(json({ is_on_biz_app: true, platform_type: 'CLOUD_API' }));
    await getCoexistenceStatus({ phoneNumberId: '9', token: 'BIZ', appSecret: 'APP-SECRET' });
    expect(proofOf(fetchSpy.mock.calls[0])).toEqual(expected);
  });

  it('smb_app_data', async () => {
    fetchSpy.mockResolvedValueOnce(json({ request_id: 'R' }));
    await requestSmbSync({ phoneNumberId: '9', token: 'BIZ', appSecret: 'APP-SECRET', syncType: 'smb_app_state_sync' });
    expect(proofOf(fetchSpy.mock.calls[0])).toEqual(expected);
  });
});
