import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ResponseBodyError, type refreshTokenGrant } from 'openid-client';

import { parseOAuthCredentialSecret, serializeOAuthCredentialSecret } from './credential-secret';
import type { OAuthConfigLoader } from './oauth-config';
import type { ProviderDefinition } from './provider';
import {
  createCredentialRefreshService,
  type IntegrationConnectionRow,
} from './refresh-service';

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

const connection: IntegrationConnectionRow = {
  id: 'connection-1',
  provider: 'fixture',
  credential_kind: 'oauth2_authorization_code',
  status: 'expired',
  scopes: ['scope.a'],
  expires_at: '2029-01-01T00:00:00.000Z',
};

const STORED = serializeOAuthCredentialSecret({
  accessToken: 'old-token',
  refreshToken: 'refresh-old',
});

const NOW = Date.parse('2029-01-01T00:00:00.000Z');

/** Builds a `ResponseBodyError` the way the library would, for a given OAuth code. */
function oauthError(code: string): ResponseBodyError {
  return Object.assign(Object.create(ResponseBodyError.prototype) as ResponseBodyError, {
    name: 'ResponseBodyError',
    message: code,
    error: code,
    status: 400,
    cause: { error: code },
  });
}

type Harness = ReturnType<typeof harness>;

function harness(
  opts: {
    claim?: { outcome: string; lease_id: string | null; lease_until: string | null };
    storedSecret?: string | null;
    leaseUntilAfterWait?: (string | null)[];
    replaced?: boolean;
  } = {},
) {
  const calls: { rpc: string; args: Record<string, unknown> }[] = [];
  const leaseReads = opts.leaseUntilAfterWait ?? [];
  let leaseReadIndex = 0;

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ rpc: name, args });
    switch (name) {
      case 'integrations_claim_credential_refresh':
        return {
          data: [opts.claim ?? { outcome: 'claimed', lease_id: 'lease-1', lease_until: null }],
          error: null,
        };
      case 'integrations_read_credential':
        return { data: opts.storedSecret === undefined ? STORED : opts.storedSecret, error: null };
      case 'integrations_replace_credential':
        return { data: opts.replaced ?? true, error: null };
      case 'integrations_release_credential_refresh':
        return { data: true, error: null };
      default:
        throw new Error(`unexpected rpc ${name}`);
    }
  });

  const maybeSingle = vi.fn(async () => ({
    data: { refresh_lease_until: leaseReads[leaseReadIndex++] ?? null },
    error: null,
  }));
  const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }));

  const configLoader: OAuthConfigLoader = { load: vi.fn(async () => ({}) as never) };
  // Typed as the mock, cast only where it is injected — `as never` on the
  // declaration would erase `mockRejectedValueOnce` from every call site.
  const refreshGrant = vi.fn(async () => ({
    access_token: 'new-token',
    token_type: 'bearer' as const,
    refresh_token: 'refresh-new',
    expires_in: 3600,
    expiresIn: () => 3600,
  }));

  const service = createCredentialRefreshService({
    admin: { rpc, from } as never,
    configLoader,
    refreshGrant: refreshGrant as unknown as typeof refreshTokenGrant,
    now: () => NOW,
    sleep: async () => {},
  });

  return { service, rpc, calls, configLoader, refreshGrant };
}

function released(h: Harness) {
  return h.calls.find((c) => c.rpc === 'integrations_release_credential_refresh')?.args;
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

describe('the happy path', () => {
  it('claims, exchanges, and persists under the lease it holds', async () => {
    await expect(h.service.refresh({ connection, provider })).resolves.toBe('new-token');

    const order = h.calls.map((c) => c.rpc);
    expect(order).toEqual([
      'integrations_claim_credential_refresh',
      'integrations_read_credential',
      'integrations_replace_credential',
    ]);

    const replace = h.calls.find((c) => c.rpc === 'integrations_replace_credential')!.args;
    expect(replace.p_lease_id).toBe('lease-1');
    expect(parseOAuthCredentialSecret(replace.p_secret as string)).toMatchObject({
      accessToken: 'new-token',
      refreshToken: 'refresh-new',
    });
  });

  it('⚠️ keeps the OLD refresh token when the server rotates nothing', async () => {
    // The end-to-end version of the normalizer's guarantee: what actually
    // reaches `p_secret`, and therefore Vault. Google issues a refresh token
    // only on the first authorization, so a response without one is the normal
    // case — and overwriting the stored one with null would end the connection
    // at the next expiry with nothing left to renew it.
    const local = harness();
    local.refreshGrant.mockResolvedValueOnce({
      access_token: 'new-token',
      token_type: 'bearer' as const,
      expires_in: 3600,
      expiresIn: () => 3600,
    } as never);

    await local.service.refresh({ connection, provider });

    const replace = local.calls.find((c) => c.rpc === 'integrations_replace_credential')!.args;
    const stored = parseOAuthCredentialSecret(replace.p_secret as string);
    expect(stored.accessToken).toBe('new-token');
    expect(stored.refreshToken).toBe('refresh-old');
    // Not null, not undefined, not an empty string — the same token, intact.
    expect(JSON.parse(replace.p_secret as string).refresh_token).toBe('refresh-old');
  });

  it('records a NULL expiry rather than inventing one', async () => {
    const local = harness();
    local.refreshGrant.mockResolvedValueOnce({
      access_token: 'new-token',
      token_type: 'bearer' as const,
      refresh_token: 'refresh-new',
    } as never);

    await local.service.refresh({ connection, provider });

    const replace = local.calls.find((c) => c.rpc === 'integrations_replace_credential')!.args;
    expect(replace.p_expires_at).toBeNull();
  });

  it('does not release on success — the replace clears the lease in one statement', async () => {
    await h.service.refresh({ connection, provider });
    expect(released(h)).toBeUndefined();
  });

  it('⚠️ falls back to the PREVIOUSLY GRANTED scopes, not the original request', async () => {
    // RFC 6749 §6: a refresh that omits `scope` asks for what was already
    // granted. Inheriting the first request would re-widen a connection the user
    // narrowed at the consent screen.
    const narrowed = { ...connection, scopes: ['scope.a'] };
    const local = harness();
    await local.service.refresh({ connection: narrowed, provider });

    // The grant returns no `scope`, so the stored set must be the connection's.
    expect(local.refreshGrant).toHaveBeenCalledWith(expect.anything(), 'refresh-old');
  });
});

describe('two workers, one refresh token', () => {
  it('waits for the lease holder and serves what it persisted', async () => {
    const local = harness({
      claim: { outcome: 'locked', lease_id: null, lease_until: '2029-01-01T00:01:00.000Z' },
      leaseUntilAfterWait: [null],
    });

    await expect(local.service.refresh({ connection, provider })).resolves.toBe('old-token');
    // ⚠️ It must NOT have exchanged anything. Two refreshes with the same token
    // is the exact race the lease exists to prevent.
    expect(local.refreshGrant).not.toHaveBeenCalled();
    expect(local.calls.some((c) => c.rpc === 'integrations_replace_credential')).toBe(false);
  });

  it('gives up TRANSIENTLY when the holder never finishes', async () => {
    const stillHeld = '2029-01-01T00:01:00.000Z';
    const local = harness({
      claim: { outcome: 'locked', lease_id: null, lease_until: stillHeld },
      leaseUntilAfterWait: [stillHeld, stillHeld, stillHeld, stillHeld, stillHeld],
    });

    await expect(local.service.refresh({ connection, provider })).rejects.toMatchObject({
      code: 'integration_refresh_in_progress',
      // Nothing is wrong with the connection — we simply arrived mid-refresh.
      classification: 'transient',
    });
  });

  it('refuses to force the write when its own lease lapsed mid-flight', async () => {
    const local = harness({ replaced: false });

    await expect(local.service.refresh({ connection, provider })).rejects.toMatchObject({
      code: 'integration_refresh_lease_lost',
      classification: 'transient',
    });
  });
});

describe('what a failure does to the connection', () => {
  it('refuses a connection the database will not let us refresh', async () => {
    const local = harness({
      claim: { outcome: 'not_refreshable', lease_id: null, lease_until: null },
    });

    await expect(local.service.refresh({ connection, provider })).rejects.toMatchObject({
      code: 'integration_refresh_not_permitted',
      classification: 'permanent',
    });
    expect(released(local)).toBeUndefined();
  });

  it('sends a connection with no refresh token to a human', async () => {
    const local = harness({
      storedSecret: serializeOAuthCredentialSecret({ accessToken: 'only-access' }),
    });

    await expect(local.service.refresh({ connection, provider })).rejects.toMatchObject({
      code: 'integration_refresh_token_missing',
      classification: 'permanent',
    });
    expect(released(local)).toMatchObject({ p_next_status: 'requires_reauthorization' });
  });

  it('invalid_grant means the grant is gone — a human must reauthorize', async () => {
    const local = harness();
    local.refreshGrant.mockRejectedValueOnce(oauthError('invalid_grant'));

    await expect(local.service.refresh({ connection, provider })).rejects.toMatchObject({
      code: 'integration_refresh_rejected',
      classification: 'permanent',
    });
    expect(released(local)).toMatchObject({ p_next_status: 'requires_reauthorization' });
  });

  it('⚠️ invalid_client is OUR registration — it must NOT prompt a re-consent', async () => {
    const local = harness();
    local.refreshGrant.mockRejectedValueOnce(oauthError('invalid_client'));

    await expect(local.service.refresh({ connection, provider })).rejects.toMatchObject({
      classification: 'permanent',
    });
    expect(released(local)).toMatchObject({ p_next_status: 'failed' });
  });

  it('⚠️ a blip does NOT burn the connection', async () => {
    // The status must survive a 503 untouched. Marking requires_reauthorization
    // here would send an operator to re-consent something that never broke.
    const local = harness();
    local.refreshGrant.mockRejectedValueOnce(oauthError('temporarily_unavailable'));

    await expect(local.service.refresh({ connection, provider })).rejects.toMatchObject({
      classification: 'transient',
    });
    expect(released(local)).toMatchObject({
      p_lease_id: 'lease-1',
      p_next_status: undefined,
    });
  });

  it('⚠️ a network failure does not burn the connection either', async () => {
    const local = harness();
    local.refreshGrant.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(local.service.refresh({ connection, provider })).rejects.toMatchObject({
      code: 'integration_refresh_failed',
      classification: 'transient',
    });
    expect(released(local)).toMatchObject({ p_next_status: undefined });
  });

  it('a disabled provider configuration is recorded as a reason, not a mystery', async () => {
    const local = harness();
    (local.configLoader.load as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(new Error('disabled'), {
        classification: 'permanent',
        code: 'integration_provider_disabled',
      }),
    );

    await expect(local.service.refresh({ connection, provider })).rejects.toMatchObject({
      code: 'integration_provider_disabled',
    });
    expect(released(local)).toMatchObject({
      p_next_status: 'requires_reauthorization',
      p_last_error: expect.stringContaining('disabled'),
    });
  });

  it('always clears the lease, whatever went wrong', async () => {
    const local = harness();
    local.refreshGrant.mockRejectedValueOnce(new Error('anything'));

    await expect(local.service.refresh({ connection, provider })).rejects.toThrow();
    expect(released(local)).toMatchObject({ p_lease_id: 'lease-1' });
  });
});
