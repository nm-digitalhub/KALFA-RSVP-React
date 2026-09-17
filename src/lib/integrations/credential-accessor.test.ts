import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createCredentialAccessor } from './credential-accessor';
import { serializeOAuthCredentialSecret } from './credential-secret';
import type { ProviderDefinition } from './provider';
import type { CredentialRefreshService } from './refresh-service';

const provider = {
  id: 'fixture',
  displayName: 'Fixture',
  credentialKind: 'oauth2_authorization_code',
  presentation: { type: 'bearer' },
  capabilities: { 'thing.write': ['scope.a'] },
  apiOrigins: ['https://api.example.test'],
  oauth: {
    server: new URL('https://login.example.test/.well-known/openid-configuration'),
    clientAuth: 'post',
  },
  endpoint: () => ({ url: new URL('https://api.example.test/v1/write') }),
} satisfies ProviderDefinition;

const STORED = serializeOAuthCredentialSecret({
  accessToken: 'stored-token',
  refreshToken: 'refresh-token',
});

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'connection-1',
    provider: 'fixture',
    credential_kind: 'oauth2_authorization_code',
    status: 'active',
    scopes: ['scope.a'],
    expires_at: '2030-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function harness(
  row: Record<string, unknown> | null,
  opts: { rawSecret?: string | null; nowIso?: string } = {},
) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  const eqSelect = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq: eqSelect }));
  const eqUpdate = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: eqUpdate }));
  const from = vi.fn(() => ({ select, update }));
  const rpc = vi.fn(async () => ({ data: opts.rawSecret ?? STORED, error: null }));

  const refreshService: CredentialRefreshService = {
    refresh: vi.fn(async () => 'refreshed-token'),
  };

  const accessor = createCredentialAccessor({
    admin: { from, rpc } as never,
    refreshService,
    now: () => Date.parse(opts.nowIso ?? '2029-01-01T00:00:00.000Z'),
  });

  return { accessor, rpc, refreshService, update, eqUpdate };
}

const RESOLVE_ARGS = {
  connectionId: 'connection-1',
  provider,
  requiredScopes: ['scope.a'],
} as const;

describe('serving a credential', () => {
  it('returns the stored access token while it is still good', async () => {
    const h = harness(connection());

    await expect(h.accessor.resolve(RESOLVE_ARGS)).resolves.toBe('stored-token');
    expect(h.refreshService.refresh).not.toHaveBeenCalled();
    expect(h.rpc).toHaveBeenCalledWith('integrations_read_credential', {
      p_connection_id: 'connection-1',
      p_expected_provider: 'fixture',
      p_expected_kind: 'oauth2_authorization_code',
    });
  });

  it('⚠️ REFRESHES a spent token instead of refusing it', async () => {
    // This replaces the old contract, where an expired credential was a
    // permanent failure. Self-healing is the whole point of the lifecycle: the
    // expiry is a fact about the token, not about the connection.
    const h = harness(connection({ expires_at: '2029-01-01T00:00:00.000Z' }));

    await expect(h.accessor.resolve(RESOLVE_ARGS)).resolves.toBe('refreshed-token');
    expect(h.refreshService.refresh).toHaveBeenCalledOnce();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('refreshes inside the skew window, before a request can outlive the token', async () => {
    const h = harness(connection({ expires_at: '2029-01-01T00:00:20.000Z' }));

    await expect(h.accessor.resolve(RESOLVE_ARGS)).resolves.toBe('refreshed-token');
  });

  it('refreshes a connection already marked expired, whatever its timestamp says', async () => {
    const h = harness(connection({ status: 'expired', expires_at: '2030-01-01T00:00:00.000Z' }));

    await expect(h.accessor.resolve(RESOLVE_ARGS)).resolves.toBe('refreshed-token');
  });

  it('⚠️ a NULL expiry is not "expired" — it is carried by the reactive path', async () => {
    // `expires_in` is RECOMMENDED, not REQUIRED, so null means the server never
    // said. There is nothing to be proactive about: the token is used, and a 401
    // is what eventually renews it.
    const h = harness(connection({ expires_at: null }));

    await expect(h.accessor.resolve(RESOLVE_ARGS)).resolves.toBe('stored-token');
    expect(h.refreshService.refresh).not.toHaveBeenCalled();
  });
});

describe('what it refuses before reading Vault', () => {
  it('a connection belonging to another provider', async () => {
    const h = harness(connection({ provider: 'other-provider' }));

    await expect(h.accessor.resolve(RESOLVE_ARGS)).rejects.toMatchObject({
      code: 'integration_connection_provider_mismatch',
    });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.refreshService.refresh).not.toHaveBeenCalled();
  });

  it('a scope the provider never reported as granted', async () => {
    // The consent screen let the user untick it. Failing here names the missing
    // scope; sending the request would return an opaque 403 instead.
    const h = harness(connection({ scopes: ['scope.b'] }));

    await expect(h.accessor.resolve(RESOLVE_ARGS)).rejects.toMatchObject({
      code: 'integration_scope_missing',
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('⚠️ the SAME scope, qualified by a declared resource, is accepted', async () => {
    // What the provider's protocol reference says actually comes back:
    // `<resource>/<scope>`, lowercased, against a capability spelled the short
    // way. A plain `includes` refused it and every request failed permanently —
    // and only SOMETIMES, because the server may omit `scope` entirely, in which
    // case the short form is stored instead. See scopes.ts.
    const h = harness(connection({ scopes: ['https://api.example.test/Scope.A'] }));

    await expect(
      h.accessor.resolve({
        ...RESOLVE_ARGS,
        provider: {
          ...provider,
          oauth: { ...provider.oauth, scopeResources: ['https://api.example.test'] },
        },
      }),
    ).resolves.toBe('stored-token');
  });

  it('⚠️ a scope qualified by an UNDECLARED resource is still refused', async () => {
    // Normalising is not "strip any prefix". A grant issued for somebody else's
    // API names a different permission, whatever the last path segment says.
    const h = harness(connection({ scopes: ['api://someone-else/scope.a'] }));

    await expect(
      h.accessor.resolve({
        ...RESOLVE_ARGS,
        provider: {
          ...provider,
          oauth: { ...provider.oauth, scopeResources: ['https://api.example.test'] },
        },
      }),
    ).rejects.toMatchObject({ code: 'integration_scope_missing' });
  });

  it('⚠️ a connection awaiting a human, and it does NOT try to heal it', async () => {
    // `requires_reauthorization` is a claim that a person must act. Refreshing
    // it automatically would make the status a lie.
    const h = harness(connection({ status: 'requires_reauthorization' }));

    await expect(h.accessor.resolve(RESOLVE_ARGS)).rejects.toMatchObject({
      code: 'integration_connection_inactive',
    });
    expect(h.refreshService.refresh).not.toHaveBeenCalled();
  });

  it('a revoked connection', async () => {
    const h = harness(connection({ status: 'revoked' }));

    await expect(h.accessor.resolve(RESOLVE_ARGS)).rejects.toMatchObject({
      code: 'integration_connection_inactive',
    });
  });

  it('a connection whose expiry cannot be read', async () => {
    const h = harness(connection({ expires_at: 'not-a-timestamp' }));

    await expect(h.accessor.resolve(RESOLVE_ARGS)).rejects.toMatchObject({
      code: 'integration_connection_invalid_expiry',
    });
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('a connection that does not exist', async () => {
    const h = harness(null);

    await expect(h.accessor.resolve(RESOLVE_ARGS)).rejects.toMatchObject({
      code: 'integration_connection_not_found',
    });
  });
});

describe('refreshing on demand', () => {
  it('renews unconditionally, even when the stored expiry still looks fine', async () => {
    // The reactive path calls this after a 401, where the stored expiry has
    // already been proved wrong by the provider itself.
    const h = harness(connection({ expires_at: '2030-01-01T00:00:00.000Z' }));

    await expect(h.accessor.refresh(RESOLVE_ARGS)).resolves.toBe('refreshed-token');
    expect(h.refreshService.refresh).toHaveBeenCalledOnce();
  });

  it('refuses for a static credential, which has nothing to refresh with', async () => {
    const staticProvider = {
      ...provider,
      credentialKind: 'static',
      oauth: undefined,
    } as unknown as ProviderDefinition;
    const h = harness(connection({ credential_kind: 'static' }));

    await expect(
      h.accessor.refresh({ ...RESOLVE_ARGS, provider: staticProvider }),
    ).rejects.toMatchObject({ code: 'integration_refresh_not_supported' });
  });

  it('never refreshes a static credential proactively either', async () => {
    const staticProvider = {
      ...provider,
      credentialKind: 'static',
      oauth: undefined,
    } as unknown as ProviderDefinition;
    const h = harness(
      connection({ credential_kind: 'static', expires_at: '2029-01-01T00:00:00.000Z' }),
      { rawSecret: 'raw-api-key' },
    );

    await expect(
      h.accessor.resolve({ ...RESOLVE_ARGS, provider: staticProvider }),
    ).resolves.toBe('raw-api-key');
    expect(h.refreshService.refresh).not.toHaveBeenCalled();
  });
});

describe('marking a connection for reauthorization', () => {
  it('writes the status and the reason', async () => {
    const h = harness(connection());

    await h.accessor.markRequiresReauthorization({
      connectionId: 'connection-1',
      reason: 'the provider rejected a freshly refreshed access token',
    });

    expect(h.update).toHaveBeenCalledWith({
      status: 'requires_reauthorization',
      last_error: 'the provider rejected a freshly refreshed access token',
    });
  });
});
