import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createOAuthConfigLoader } from './oauth-config';
import { microsoftProvider } from './providers/microsoft';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function adminHarness(row: Record<string, unknown> | null, rpcSecret = 'db-secret') {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn(async () => ({ data: rpcSecret, error: null }));
  return { admin: { from, rpc }, rpc };
}

describe('OAuth config loader deployment fallback', () => {
  it('uses the system OAuth client when no DB provider row exists', async () => {
    process.env.INTEGRATION_OAUTH_MICROSOFT_CLIENT_ID = 'system-client';
    process.env.INTEGRATION_OAUTH_MICROSOFT_CLIENT_SECRET = 'system-secret';

    const h = adminHarness(null);
    const discovery = vi.fn(async () => ({ source: 'system' })) as never;
    const loader = createOAuthConfigLoader({
      admin: h.admin as never,
      discovery,
    });

    await expect(loader.load(microsoftProvider)).resolves.toEqual({
      source: 'system',
    });
    expect(discovery).toHaveBeenCalledWith(
      microsoftProvider.oauth.server,
      'system-client',
      undefined,
      expect.anything(),
    );
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('keeps a stored provider row authoritative over system environment values', async () => {
    process.env.INTEGRATION_OAUTH_MICROSOFT_CLIENT_ID = 'system-client';
    process.env.INTEGRATION_OAUTH_MICROSOFT_CLIENT_SECRET = 'system-secret';

    const h = adminHarness({
      provider: 'microsoft',
      client_id: 'db-client',
      extra: {},
      enabled: true,
    });
    const discovery = vi.fn(async () => ({ source: 'db' })) as never;
    const loader = createOAuthConfigLoader({
      admin: h.admin as never,
      discovery,
    });

    await expect(loader.load(microsoftProvider)).resolves.toEqual({ source: 'db' });
    expect(discovery).toHaveBeenCalledWith(
      microsoftProvider.oauth.server,
      'db-client',
      undefined,
      expect.anything(),
    );
    expect(h.rpc).toHaveBeenCalledWith('integrations_read_provider_secret', {
      p_provider: 'microsoft',
    });
  });

  it('does not let deployment environment values bypass an explicitly disabled DB row', async () => {
    process.env.INTEGRATION_OAUTH_MICROSOFT_CLIENT_ID = 'system-client';
    process.env.INTEGRATION_OAUTH_MICROSOFT_CLIENT_SECRET = 'system-secret';

    const h = adminHarness({
      provider: 'microsoft',
      client_id: 'db-client',
      extra: {},
      enabled: false,
    });
    const loader = createOAuthConfigLoader({
      admin: h.admin as never,
      discovery: vi.fn() as never,
    });

    await expect(loader.load(microsoftProvider)).rejects.toMatchObject({
      code: 'integration_provider_disabled',
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
