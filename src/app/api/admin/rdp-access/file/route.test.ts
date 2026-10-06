import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getUser = vi.fn();
const hasPlatformPermission = vi.fn();
vi.mock('@/lib/auth/dal', () => ({
  getUser: (...args: unknown[]) => getUser(...args),
  hasPlatformPermission: (...args: unknown[]) => hasPlatformPermission(...args),
}));

const issueMyRdpFile = vi.fn();
vi.mock('@/lib/data/admin/rdp-access', () => ({ issueMyRdpFile: (...args: unknown[]) => issueMyRdpFile(...args) }));

import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';

import { POST } from './route';

const ORIGIN = 'https://beta.example.test';
const FILE = 'full address:s:desktop.example.test:3389\r\ngatewayaccesstoken:s:abc\r\n';

function call(headers: Record<string, string> = { origin: ORIGIN, 'x-real-ip': '203.0.113.7' }) {
  return POST(new Request(`${ORIGIN}/api/admin/rdp-access/file`, { method: 'POST', headers }));
}

beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', ORIGIN);
  getUser.mockReset().mockResolvedValue({ id: 'user-1' });
  hasPlatformPermission.mockReset().mockResolvedValue(true);
  issueMyRdpFile.mockReset().mockResolvedValue({ ok: true, content: FILE });
  __resetRateLimitStateForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/admin/rdp-access/file', () => {
  it('returns the file as a private, non-cacheable attachment and passes the real client address', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-rdp');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="kalfa-desktop.rdp"');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe(FILE);
    expect(issueMyRdpFile).toHaveBeenCalledWith('203.0.113.7');
  });

  it('refuses a missing or foreign Origin before it looks at the session', async () => {
    const attempts: Record<string, string>[] = [
      { 'x-real-ip': '203.0.113.7' },
      { origin: 'https://evil.example.test' },
      { origin: 'null' },
    ];
    for (const headers of attempts) {
      const res = await call(headers);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'forbidden' });
    }
    expect(getUser).not.toHaveBeenCalled();
    expect(issueMyRdpFile).not.toHaveBeenCalled();
  });

  it('fails closed when the app origin is not configured in production', async () => {
    vi.stubEnv('APP_ORIGIN', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
  });

  it('answers 401 without a session and 403 without the permission', async () => {
    getUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);

    getUser.mockResolvedValue({ id: 'user-1' });
    hasPlatformPermission.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(hasPlatformPermission).toHaveBeenCalledWith('rdp.request');
    expect(issueMyRdpFile).not.toHaveBeenCalled();
  });

  it('maps every refusal of the data layer to a fixed status and code, with no body detail', async () => {
    const cases = [
      ['not_allowed', 403],
      ['no_active_grant', 409],
      ['file_limit', 429],
      ['too_soon', 429],
      ['no_client_ip', 400],
      ['gateway_unavailable', 502],
    ] as const;
    for (const [reason, status] of cases) {
      __resetRateLimitStateForTests();
      issueMyRdpFile.mockResolvedValueOnce({ ok: false, reason });
      const res = await call();
      expect(res.status).toBe(status);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(await res.json()).toEqual({ error: reason });
    }
  });

  it('turns an unexpected throw into a generic 500 and logs no detail', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    issueMyRdpFile.mockRejectedValue(new Error('select * from secret_table failed: password=hunter2'));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
    expect(JSON.stringify(error.mock.calls)).not.toContain('hunter2');
  });

  it('rate-limits one user before the database is reached', async () => {
    for (let i = 0; i < 3; i += 1) expect((await call()).status).toBe(200);
    const res = await call();
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: 'rate_limited' });
    expect(issueMyRdpFile).toHaveBeenCalledTimes(3);
  });

  it('does not take the client address from x-forwarded-for', async () => {
    await call({ origin: ORIGIN, 'x-forwarded-for': '198.51.100.9' });
    expect(issueMyRdpFile).toHaveBeenCalledWith(null);
  });
});
