import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createAuthenticatedIntegrationRequest } from './authenticated-request';
import { createCredentialAccessor } from './credential-accessor';
import { serializeOAuthCredentialSecret } from './credential-secret';
import { __resetProviderRegistryForTests, registerProvider } from './provider';

const credentials = {
  resolve: vi.fn(async () => 'access-token'),
  refresh: vi.fn(async () => 'refreshed-token'),
  markRequiresReauthorization: vi.fn(async () => {}),
};

beforeEach(() => {
  __resetProviderRegistryForTests();
  credentials.resolve.mockClear();
  credentials.refresh.mockClear();
  credentials.markRequiresReauthorization.mockClear();
  credentials.resolve.mockResolvedValue('access-token');
  credentials.refresh.mockResolvedValue('refreshed-token');
  registerProvider({
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
    endpoint: (_capability, input) => ({
      url: new URL('https://api.example.test/v1/write'),
      init: { method: 'POST', body: JSON.stringify(input) },
    }),
  });
});

describe('authenticated integration request', () => {
  it('validates the destination before reading and attaching the credential', async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-token');
      expect(init?.redirect).toBe('manual');
      return new Response(null, { status: 202 });
    });
    const request = createAuthenticatedIntegrationRequest({
      credentials: credentials as never,
      fetchImpl,
    });

    const response = await request({
      provider: 'fixture',
      connectionId: 'connection-1',
      capability: 'thing.write',
      input: { a: 1 },
    });

    expect(response.status).toBe(202);
    expect(credentials.resolve).toHaveBeenCalledWith({
      connectionId: 'connection-1',
      provider: expect.objectContaining({ id: 'fixture' }),
      requiredScopes: ['scope.a'],
    });
  });

  it('blocks credential egress to an origin outside the provider allow-list before reading the secret', async () => {
    registerProvider({
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
      endpoint: () => ({ url: new URL('https://evil.example/v1/write') }),
    });

    const request = createAuthenticatedIntegrationRequest({
      credentials: credentials as never,
      fetchImpl: vi.fn(),
    });

    await expect(
      request({
        provider: 'fixture',
        connectionId: 'connection-1',
        capability: 'thing.write',
        input: {},
      }),
    ).rejects.toMatchObject({ code: 'integration_destination_not_allowed' });
    expect(credentials.resolve).not.toHaveBeenCalled();
  });

  it('blocks provider-supplied Authorization before reading the secret', async () => {
    registerProvider({
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
      endpoint: () => ({
        url: new URL('https://api.example.test/v1/write'),
        init: { headers: { authorization: 'attacker-controlled' } },
      }),
    });

    const request = createAuthenticatedIntegrationRequest({
      credentials: credentials as never,
      fetchImpl: vi.fn(),
    });

    await expect(
      request({
        provider: 'fixture',
        connectionId: 'connection-1',
        capability: 'thing.write',
        input: {},
      }),
    ).rejects.toMatchObject({ code: 'integration_request_forbidden_header' });
    expect(credentials.resolve).not.toHaveBeenCalled();
  });

  it('classifies 429 and 5xx as transient', async () => {
    const request429 = createAuthenticatedIntegrationRequest({
      credentials: credentials as never,
      fetchImpl: vi.fn(async () => new Response(null, { status: 429 })),
    });
    await expect(
      request429({
        provider: 'fixture',
        connectionId: 'connection-1',
        capability: 'thing.write',
        input: {},
      }),
    ).rejects.toMatchObject({
      code: 'integration_rate_limited',
      classification: 'transient',
    });

    const request503 = createAuthenticatedIntegrationRequest({
      credentials: credentials as never,
      fetchImpl: vi.fn(async () => new Response(null, { status: 503 })),
    });
    await expect(
      request503({
        provider: 'fixture',
        connectionId: 'connection-1',
        capability: 'thing.write',
        input: {},
      }),
    ).rejects.toMatchObject({
      code: 'integration_provider_unavailable',
      classification: 'transient',
    });
  });
});

describe('a rejected credential', () => {
  function authorizationOf(init: RequestInit | undefined): string | null {
    return new Headers(init?.headers).get('authorization');
  }

  it('refreshes on the first 401 and replays the request exactly once', async () => {
    const seen: (string | null)[] = [];
    const fetchImpl = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push(authorizationOf(init));
      return new Response(null, { status: seen.length === 1 ? 401 : 202 });
    });

    const response = await createAuthenticatedIntegrationRequest({
      credentials: credentials as never,
      fetchImpl,
    })({ provider: 'fixture', connectionId: 'connection-1', capability: 'thing.write', input: {} });

    expect(response.status).toBe(202);
    expect(credentials.refresh).toHaveBeenCalledOnce();
    // The replay must carry the NEW token. Reusing the previous Headers would
    // re-send the one the provider just rejected.
    expect(seen).toEqual(['Bearer access-token', 'Bearer refreshed-token']);
    expect(credentials.markRequiresReauthorization).not.toHaveBeenCalled();
  });

  it('⚠️ does not treat the first 401 as an error the caller ever sees', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const request = createAuthenticatedIntegrationRequest({
      credentials: credentials as never,
      fetchImpl: vi.fn(async (_i: string | URL | Request, init?: RequestInit) =>
        authorizationOf(init) === 'Bearer refreshed-token'
          ? new Response('{}', { status: 200 })
          : new Response(null, { status: 401 }),
      ),
    });

    await expect(
      request({ provider: 'fixture', connectionId: 'c1', capability: 'thing.write', input: {} }),
    ).resolves.toMatchObject({ status: 200 });
  });

  it('gives up after ONE replay and marks the connection for reauthorization', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));

    await expect(
      createAuthenticatedIntegrationRequest({ credentials: credentials as never, fetchImpl })({
        provider: 'fixture',
        connectionId: 'connection-1',
        capability: 'thing.write',
        input: {},
      }),
    ).rejects.toMatchObject({
      code: 'integration_auth_rejected',
      classification: 'permanent',
    });

    // Exactly twice. A third attempt would burn another refresh token against a
    // provider that has already refused a freshly minted one.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(credentials.refresh).toHaveBeenCalledOnce();
    expect(credentials.markRequiresReauthorization).toHaveBeenCalledWith({
      connectionId: 'connection-1',
      reason: expect.stringContaining('refreshed'),
    });
  });

  it('⚠️ never refreshes on 403 — policy is not an expired token', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 403 }));

    await expect(
      createAuthenticatedIntegrationRequest({ credentials: credentials as never, fetchImpl })({
        provider: 'fixture',
        connectionId: 'connection-1',
        capability: 'thing.write',
        input: {},
      }),
    ).rejects.toMatchObject({
      code: 'integration_forbidden',
      classification: 'permanent',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(credentials.refresh).not.toHaveBeenCalled();
    expect(credentials.markRequiresReauthorization).not.toHaveBeenCalled();
  });

  it('surfaces a permanent refresh failure instead of replaying blindly', async () => {
    credentials.refresh.mockRejectedValueOnce(
      Object.assign(new Error('gone'), {
        classification: 'permanent',
        code: 'integration_refresh_token_missing',
      }),
    );
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));

    await expect(
      createAuthenticatedIntegrationRequest({ credentials: credentials as never, fetchImpl })({
        provider: 'fixture',
        connectionId: 'connection-1',
        capability: 'thing.write',
        input: {},
      }),
    ).rejects.toMatchObject({ code: 'integration_refresh_token_missing' });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('⚠️ a connection whose expiry the server never gave', () => {
  /**
   * The composed proof that a NULL expiry is a working state, not a broken one.
   *
   * `expires_in` is RECOMMENDED, not REQUIRED (RFC 6749 §5.1), so a conformant
   * server may simply not say. Everything below is the consequence, end to end
   * through the REAL accessor rather than a stub of it: nothing refuses, the
   * stored token goes out, and the 401 — not a timestamp — is what renews it.
   */
  function accessorFor(refreshService: { refresh: ReturnType<typeof vi.fn> }) {
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: 'connection-1',
        provider: 'fixture',
        credential_kind: 'oauth2_authorization_code',
        status: 'active',
        scopes: ['scope.a'],
        expires_at: null, // ← the whole point
      },
      error: null,
    }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const from = vi.fn(() => ({
      select: () => ({ eq }),
      update: () => ({ eq: vi.fn(async () => ({ error: null })) }),
    }));
    const rpc = vi.fn(async () => ({
      data: serializeOAuthCredentialSecret({
        accessToken: 'stored-token',
        refreshToken: 'refresh-old',
      }),
      error: null,
    }));

    return createCredentialAccessor({
      admin: { from, rpc } as never,
      refreshService: refreshService as never,
      now: () => Date.parse('2029-01-01T00:00:00.000Z'),
    });
  }

  it('sends the stored token, and lets the 401 be the trigger', async () => {
    const refreshService = { refresh: vi.fn(async () => 'refreshed-token') };
    const seen: (string | null)[] = [];
    const fetchImpl = vi.fn(async (_i: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('authorization'));
      return new Response(null, { status: seen.length === 1 ? 401 : 202 });
    });

    const response = await createAuthenticatedIntegrationRequest({
      credentials: accessorFor(refreshService),
      fetchImpl,
    })({ provider: 'fixture', connectionId: 'connection-1', capability: 'thing.write', input: {} });

    // 1. A null expiry did not fail anything.
    // 2. The stored token went out first — no proactive refresh, because there
    //    was nothing to be proactive ABOUT.
    // 3. The 401 is what renewed it.
    expect(seen).toEqual(['Bearer stored-token', 'Bearer refreshed-token']);
    expect(response.status).toBe(202);
    expect(refreshService.refresh).toHaveBeenCalledOnce();
  });

  it('never refreshes a null-expiry connection while the provider keeps accepting it', async () => {
    const refreshService = { refresh: vi.fn(async () => 'refreshed-token') };
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));

    await createAuthenticatedIntegrationRequest({
      credentials: accessorFor(refreshService),
      fetchImpl,
    })({ provider: 'fixture', connectionId: 'connection-1', capability: 'thing.write', input: {} });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(refreshService.refresh).not.toHaveBeenCalled();
  });
});
