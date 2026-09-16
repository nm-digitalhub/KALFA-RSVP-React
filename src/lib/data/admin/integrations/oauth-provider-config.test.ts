import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, adminMock, logActivityMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  adminMock: vi.fn(),
  logActivityMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: adminMock }));
vi.mock('@/lib/data/activity', () => ({ logActivity: logActivityMock }));

import {
  readOAuthProviderConfig,
  saveOAuthProviderConfig,
  UNCONFIGURED_OAUTH_PROVIDER,
} from './oauth-provider-config';

const ROW = {
  client_id: 'client-abc',
  enabled: true,
  created_by: 'admin-1',
  updated_at: '2026-09-16T12:00:00.000Z',
  vault_secret_id: '99999999-8888-4777-8666-555555555555',
};

function harness(opts: { row?: Record<string, unknown> | null; readError?: unknown; rpcError?: unknown } = {}) {
  let selected = '';
  const maybeSingle = vi.fn(async () => ({
    data: opts.row === undefined ? ROW : opts.row,
    error: opts.readError ?? null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn((columns: string) => {
    selected = columns;
    return { eq };
  });
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn(async () => ({ data: null, error: opts.rpcError ?? null }));

  adminMock.mockReturnValue({ from, rpc });
  return { rpc, get selected() { return selected; } };
}

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ id: 'session-user' });
});

describe('reading a provider configuration', () => {
  it('gates on integrations.read', async () => {
    harness();
    await readOAuthProviderConfig('fixture');
    expect(permMock).toHaveBeenCalledWith('integrations.read');
  });

  it('⚠️ never returns the vault secret id, only whether one exists', async () => {
    const h = harness();
    const config = await readOAuthProviderConfig('fixture');

    // It is read — that is the only way to answer "is a secret stored" — and it
    // collapses to a boolean before leaving. A uuid that never reaches React
    // cannot be serialised into an RSC payload by accident.
    expect(h.selected).toContain('vault_secret_id');
    expect(config.configured).toBe(true);
    expect(JSON.stringify(config)).not.toContain('99999999');
    expect(Object.keys(config).sort()).toEqual([
      'clientId',
      'configured',
      'createdBy',
      'enabled',
      'updatedAt',
    ]);
  });

  it('reports a row with no stored secret as not configured', async () => {
    harness({ row: { ...ROW, vault_secret_id: null } });

    await expect(readOAuthProviderConfig('fixture')).resolves.toMatchObject({
      configured: false,
      clientId: 'client-abc',
    });
  });

  it('returns the unconfigured shape when no row exists', async () => {
    harness({ row: null });
    await expect(readOAuthProviderConfig('fixture')).resolves.toEqual(UNCONFIGURED_OAUTH_PROVIDER);
  });

  it('⚠️ degrades to "not configured" on a read failure rather than throwing', async () => {
    // This feeds a status card. A panel that renders an error boundary because
    // one card could not load is worse than one that says "not set up" — and a
    // SAVE still fails loudly, which is where it matters.
    harness({ row: null, readError: { code: '42501' } });

    await expect(readOAuthProviderConfig('fixture')).resolves.toEqual(UNCONFIGURED_OAUTH_PROVIDER);
  });
});

describe('saving a provider configuration', () => {
  it('gates on integrations.manage — a stricter key than reading', async () => {
    harness();
    await saveOAuthProviderConfig({
      provider: 'fixture',
      clientId: 'client-abc',
      clientSecret: 'secret-abc',
      enabled: true,
    });

    expect(permMock).toHaveBeenCalledWith('integrations.manage');
  });

  it('⚠️ takes the actor from the SESSION, never from the caller', async () => {
    const h = harness();
    await saveOAuthProviderConfig({
      provider: 'fixture',
      clientId: 'client-abc',
      clientSecret: 'secret-abc',
      enabled: false,
    });

    // `auth.uid()` is NULL under the service role — measured — so this parameter
    // is the only provenance there is. There is deliberately no input field for it.
    expect(h.rpc).toHaveBeenCalledWith('integrations_upsert_provider_config', {
      p_provider: 'fixture',
      p_client_id: 'client-abc',
      p_secret: 'secret-abc',
      p_enabled: false,
      p_extra: {},
      p_created_by: 'session-user',
    });
  });

  it('forwards an empty secret so the database can keep the stored one', async () => {
    const h = harness();
    await saveOAuthProviderConfig({
      provider: 'fixture',
      clientId: 'client-abc',
      clientSecret: '',
      enabled: true,
    });

    expect(h.rpc).toHaveBeenCalledWith(
      'integrations_upsert_provider_config',
      expect.objectContaining({ p_secret: '' }),
    );
  });

  it('throws on an RPC error instead of reporting success', async () => {
    harness({ rpcError: { message: 'client secret is required for a new provider configuration' } });

    await expect(
      saveOAuthProviderConfig({
        provider: 'fixture',
        clientId: 'client-abc',
        clientSecret: '',
        enabled: true,
      }),
    ).rejects.toBeTruthy();
    expect(logActivityMock).not.toHaveBeenCalled();
  });

  it('⚠️ audits the change without recording anything secret', async () => {
    harness();
    await saveOAuthProviderConfig({
      provider: 'fixture',
      clientId: 'client-abc',
      clientSecret: 'secret-abc',
      enabled: true,
    });

    const logged = logActivityMock.mock.calls[0][0] as { action: string; meta: object };
    expect(logged.action).toBe('admin.integration_provider_config.saved');
    expect(logged.meta).toEqual({ provider: 'fixture', enabled: true, secretSubmitted: true });
    // Enough to answer "who changed the configuration and when" — and no more.
    expect(JSON.stringify(logged)).not.toContain('secret-abc');
    expect(JSON.stringify(logged)).not.toContain('client-abc');
  });
});
