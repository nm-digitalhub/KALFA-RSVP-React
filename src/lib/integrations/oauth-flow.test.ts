import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createHash } from 'node:crypto';

import * as client from 'openid-client';

import { createOAuthFlow, INTEGRATION_OAUTH_CALLBACK_PATH } from './oauth-flow';
import type { OAuthConfigLoader } from './oauth-config';
import type { ProviderDefinition } from './provider';

const ORIGIN = 'https://beta.example.test';
const NOW = Date.parse('2026-09-16T12:00:00.000Z');
const ACTOR = '11111111-2222-4333-8444-555555555555';

const provider = {
  id: 'fixture',
  displayName: 'Fixture',
  credentialKind: 'oauth2_authorization_code',
  presentation: { type: 'bearer' },
  capabilities: {
    'mail.send': ['Scope.Send'],
    'calendar.write': ['Scope.Calendar', 'Scope.Send'],
  },
  apiOrigins: ['https://api.example.test'],
  oauth: {
    server: new URL('https://login.example.test/.well-known/openid-configuration'),
    clientAuth: 'post',
    authorizationScopes: ['durable_access'],
    authorizationParams: { prompt: 'consent' },
  },
  endpoint: () => ({ url: new URL('https://api.example.test/v1/write') }),
} satisfies ProviderDefinition;

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function harness(
  opts: {
    stateRow?: Record<string, unknown> | null;
    connectionId?: string | null;
    /** Labels already on `integration_connections` for this provider. */
    existingLabels?: string[];
    /** Make the label read fail, to prove a cosmetic read cannot fail a grant. */
    labelReadFails?: boolean;
    /** ID token claims the exchange returns. `null` = no `id_token` at all. */
    claims?: Record<string, unknown> | null;
  } = {},
) {
  const inserted: Record<string, unknown>[] = [];
  const consumeFilters: Record<string, unknown> = {};
  let updatePayload: Record<string, unknown> = {};

  const maybeSingle = vi.fn(async () => ({
    data: opts.stateRow === undefined ? defaultStateRow : opts.stateRow,
    error: null,
  }));
  const select = vi.fn(() => ({ maybeSingle }));
  const gt = vi.fn((col: string, value: unknown) => {
    consumeFilters[`gt:${col}`] = value;
    return { select };
  });
  const is = vi.fn((col: string, value: unknown) => {
    consumeFilters[`is:${col}`] = value;
    return { gt };
  });
  const eq = vi.fn((col: string, value: unknown) => {
    consumeFilters[`eq:${col}`] = value;
    return { is };
  });
  const update = vi.fn((payload: Record<string, unknown>) => {
    updatePayload = payload;
    return { eq };
  });
  const insert = vi.fn(async (row: Record<string, unknown>) => {
    inserted.push(row);
    return { error: null };
  });
  // The label read is a DIFFERENT chain on the same client: a plain
  // `.select().eq()` that resolves to rows, where the state consume is an
  // `.update().eq().is().gt().select().maybeSingle()`. Both start at `from`, so
  // the mock has to offer both and not let one stand in for the other.
  const labelEq = vi.fn(async () => ({
    data: opts.labelReadFails ? null : (opts.existingLabels ?? []).map((label) => ({ label })),
    error: opts.labelReadFails ? { message: 'boom' } : null,
  }));
  const labelSelect = vi.fn(() => ({ eq: labelEq }));

  const fromTables: string[] = [];
  const from = vi.fn((table: string) => {
    fromTables.push(table);
    return { insert, update, select: labelSelect };
  });

  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return { data: opts.connectionId === undefined ? 'connection-1' : opts.connectionId, error: null };
  });

  // A REAL Configuration, built from literal metadata rather than stubbed.
  // `buildAuthorizationUrl` type-checks its argument at runtime, and stubbing it
  // out would mean the assertions below tested our object instead of the URL the
  // library actually produces — which is the only thing the provider will see.
  const configLoader: OAuthConfigLoader = {
    load: vi.fn(
      async () =>
        new client.Configuration(
          {
            issuer: 'https://login.example.test',
            authorization_endpoint: 'https://login.example.test/authorize',
            token_endpoint: 'https://login.example.test/token',
          },
          'client-id',
          undefined,
          client.ClientSecretPost('client-secret'),
        ),
    ),
  };
  const authorizationCodeGrant = vi.fn(async () => ({
    access_token: 'access-1',
    token_type: 'bearer' as const,
    refresh_token: 'refresh-1',
    scope: 'Scope.Send',
    expires_in: 3600,
    expiresIn: () => 3600,
    // Mirrors `TokenEndpointResponseHelpers.claims()`: the VALIDATED claim set,
    // or `undefined` when the response carried no `id_token`.
    claims: () => (opts.claims === null ? undefined : (opts.claims ?? defaultClaims)),
  }));

  const flow = createOAuthFlow({
    admin: { from, rpc } as never,
    configLoader,
    authorizationCodeGrant: authorizationCodeGrant as never,
    now: () => NOW,
    randomState: () => 'state-value',
    randomPKCECodeVerifier: () => 'verifier-value',
    appOrigin: async () => ORIGIN,
  });

  return { flow, inserted, consumeFilters, rpcCalls, authorizationCodeGrant, configLoader,
    labelSelect, labelEq, fromTables,
    get updatePayload() { return updatePayload; } };
}

// A provider that answers the identity question. `iss`+`sub` are the key per
// OIDC Core §5.7; `preferred_username` is the label per §5.1.
const defaultClaims = {
  iss: 'https://login.example.test',
  sub: 'subject-1',
  preferred_username: 'first@example.test',
};

const defaultStateRow = {
  provider: 'fixture',
  code_verifier: 'verifier-value',
  redirect_to: '/admin/integrations',
  // ⚠️ TWO requested, ONE granted below. They must differ, or every assertion
  // about "granted" passes just as well against "requested" and the distinction
  // the whole scope model rests on goes untested.
  requested_scopes: ['Scope.Send', 'Scope.Calendar'],
  created_by: ACTOR,
};

const resolveProvider = (id: string) => (id === 'fixture' ? provider : undefined);

let h: ReturnType<typeof harness>;
beforeEach(() => {
  h = harness();
});

describe('starting an authorization', () => {
  async function start(capabilities = ['mail.send']) {
    return h.flow.start({
      provider,
      capabilities,
      redirectTo: '/admin/integrations',
      createdBy: ACTOR,
    });
  }

  it('⚠️ asks for the durable-access scope but never RECORDS it', async () => {
    // The distinction the whole scope model rests on: the authorization request
    // carries it, the connection does not. Recording it would make every later
    // runtime check demand a scope the provider does not report as granted.
    const { authorizationUrl } = await start();
    const scope = new URL(authorizationUrl).searchParams.get('scope');

    expect(scope?.split(' ').sort()).toEqual(['Scope.Send', 'durable_access']);
    expect(h.inserted[0].requested_scopes).toEqual(['Scope.Send']);
  });

  it('asks for the union of the selected capabilities, without duplicates', async () => {
    const { authorizationUrl } = await start(['mail.send', 'calendar.write']);

    expect(h.inserted[0].requested_scopes).toEqual(['Scope.Send', 'Scope.Calendar']);
    expect(new URL(authorizationUrl).searchParams.get('scope')?.split(' ').sort()).toEqual([
      'Scope.Calendar',
      'Scope.Send',
      'durable_access',
    ]);
  });

  it('carries the provider’s own authorization parameters', async () => {
    const { authorizationUrl } = await start();
    expect(new URL(authorizationUrl).searchParams.get('prompt')).toBe('consent');
  });

  it('⚠️ stores only the HASH of the state, never the state itself', async () => {
    const { authorizationUrl } = await start();
    const sentState = new URL(authorizationUrl).searchParams.get('state');

    expect(sentState).toBe('state-value');
    expect(h.inserted[0].state_hash).toBe(sha256('state-value'));
    expect(JSON.stringify(h.inserted[0])).not.toContain('state-value');
  });

  it('records the actor and a bounded lifetime', async () => {
    await start();
    expect(h.inserted[0].created_by).toBe(ACTOR);
    expect(h.inserted[0].expires_at).toBe('2026-09-16T12:10:00.000Z');
  });

  it('⚠️ builds redirect_uri from the app origin, not from the incoming request', async () => {
    // `authorizationCodeGrant` derives the redirect_uri it sends to the token
    // endpoint by stripping the callback URL. Both legs agree only because both
    // are built from getAppOrigin() — behind a proxy, the raw request URL can
    // carry an internal host and the token exchange fails with invalid_grant.
    const { authorizationUrl } = await start();

    expect(new URL(authorizationUrl).searchParams.get('redirect_uri')).toBe(
      `${ORIGIN}${INTEGRATION_OAUTH_CALLBACK_PATH}`,
    );
    await expect(h.flow.redirectUri()).resolves.toBe(
      `${ORIGIN}${INTEGRATION_OAUTH_CALLBACK_PATH}`,
    );
  });

  it('sends PKCE with S256', async () => {
    const { authorizationUrl } = await start();
    const params = new URL(authorizationUrl).searchParams;

    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toBeTruthy();
    // The verifier is stored for the callback and never leaves in the URL.
    expect(h.inserted[0].code_verifier).toBe('verifier-value');
    expect(params.get('code_challenge')).not.toBe('verifier-value');
  });

  it('refuses a capability the provider does not have', async () => {
    await expect(start(['nope.write'])).rejects.toMatchObject({
      code: 'integration_capability_unsupported',
    });
  });
});

describe('completing an authorization', () => {
  const callbackUrl = new URL(
    `${ORIGIN}${INTEGRATION_OAUTH_CALLBACK_PATH}?code=abc&state=state-value`,
  );

  async function complete() {
    return h.flow.complete({ state: 'state-value', callbackUrl, resolveProvider });
  }

  it('consumes the state in ONE statement, gated on unused and unexpired', async () => {
    await complete();

    expect(h.consumeFilters['eq:state_hash']).toBe(sha256('state-value'));
    expect(h.consumeFilters['is:consumed_at']).toBeNull();
    // ⚠️ The DATABASE clock decides expiry, not this server's.
    expect(h.consumeFilters['gt:expires_at']).toBe('now');
    expect(h.updatePayload).toEqual({ consumed_at: 'now' });
  });

  it('⚠️ labels the connection with the ACCOUNT, not the provider', async () => {
    // THE DEFECT THIS REPLACES. Every connection was written with
    // `provider.displayName`, so three mailboxes became three rows reading
    // "Fixture" — ordered by uuid, indistinguishable, unpickable.
    await complete();
    const write = h.rpcCalls.find((c) => c.name === 'integrations_write_credential')!.args;
    expect(write.p_label).toBe('first@example.test');
  });

  it('⚠️ stores iss+sub as the account key — the only pair OIDC guarantees', async () => {
    // OIDC Core §5.7: the `iss`/`sub` combination is "the only guaranteed unique
    // identifier for a given End-User". Nothing compares it today; it is written
    // now so a later decision to merge a reconnect has something to match on,
    // without a backfill that would be impossible after the fact.
    await complete();
    const write = h.rpcCalls.find((c) => c.name === 'integrations_write_credential')!.args;
    expect(write.p_metadata).toEqual({ accountKey: 'https://login.example.test subject-1' });
  });

  it('⚠️ never puts the address in the key, nor the key in the label', async () => {
    // The two fields answer opposite questions and swapping them is silent:
    // an email-keyed connection would merge two people (§5.7 allows an issuer to
    // re-use an email across End-Users), and a key-labelled one is unreadable.
    const local = harness({ claims: { iss: 'https://i', sub: 's', email: 'shared@example.test' } });
    await local.flow.complete({
      state: 'state-value',
      callbackUrl: new URL(`${ORIGIN}${INTEGRATION_OAUTH_CALLBACK_PATH}?code=c&state=state-value`),
      resolveProvider,
    });
    const write = local.rpcCalls.find((c) => c.name === 'integrations_write_credential')!.args;
    expect(write.p_label).toBe('shared@example.test');
    expect(write.p_metadata).toEqual({ accountKey: 'https://i s' });
  });

  it('⚠️ falls back to the provider name when the token carried no identity', async () => {
    // A tenant that strips the id_token, or a provider we never asked `openid`
    // of. The connection is fine; only its name is anonymous. Refusing the grant
    // here would turn a cosmetic gap into an outage.
    const local = harness({ claims: null });
    await local.flow.complete({
      state: 'state-value',
      callbackUrl: new URL(`${ORIGIN}${INTEGRATION_OAUTH_CALLBACK_PATH}?code=c&state=state-value`),
      resolveProvider,
    });
    const write = local.rpcCalls.find((c) => c.name === 'integrations_write_credential')!.args;
    expect(write.p_label).toBe('Fixture');
    expect(write.p_metadata).toEqual({});
  });

  it('⚠️ suffixes a label already in use, so no two rows read the same', async () => {
    // The tie-breaker, and the reason it is needed even WITH an identity:
    // reconnecting the same account produces a second row with the same address.
    // n8n does the same thing — its live picker reads "Microsoft Outlook
    // account" and "Microsoft Outlook account 2".
    const local = harness({ existingLabels: ['first@example.test', 'first@example.test 2'] });
    await local.flow.complete({
      state: 'state-value',
      callbackUrl: new URL(`${ORIGIN}${INTEGRATION_OAUTH_CALLBACK_PATH}?code=c&state=state-value`),
      resolveProvider,
    });
    const write = local.rpcCalls.find((c) => c.name === 'integrations_write_credential')!.args;
    expect(write.p_label).toBe('first@example.test 3');
  });

  it('⚠️ a failed label read must not fail an authorization that succeeded', async () => {
    // The tokens are already exchanged at this point. Throwing over a cosmetic
    // read would lose a working grant and send the operator back through consent.
    const local = harness({ labelReadFails: true });
    const result = await local.flow.complete({
      state: 'state-value',
      callbackUrl: new URL(`${ORIGIN}${INTEGRATION_OAUTH_CALLBACK_PATH}?code=c&state=state-value`),
      resolveProvider,
    });
    expect(result.connectionId).toBe('connection-1');
    const write = local.rpcCalls.find((c) => c.name === 'integrations_write_credential')!.args;
    expect(write.p_label).toBe('first@example.test');
  });

  it('scopes the label read to this provider, not the whole table', async () => {
    // Two providers may legitimately both have a connection called the same
    // thing; suffixing across them would rename for no reason.
    await complete();
    expect(h.labelEq).toHaveBeenCalledWith('provider', 'fixture');
  });

  it('⚠️ carries the actor from the state row into the connection', async () => {
    await complete();

    const write = h.rpcCalls.find((c) => c.name === 'integrations_write_credential')!.args;
    expect(write.p_created_by).toBe(ACTOR);
    // A callback is a fresh request with no session: auth.uid() under the
    // service role is NULL, so this is the only place provenance can come from.
  });

  it('⚠️ stores what was GRANTED, not what was asked for', async () => {
    // The state row requested Scope.Send AND Scope.Calendar; the provider
    // granted only Scope.Send — a user unticking a scope at the consent screen.
    // RFC 6749 §3.3 obliges the server to report that, and recording the request
    // instead would leave the runtime believing in a permission it never has.
    await complete();

    const write = h.rpcCalls.find((c) => c.name === 'integrations_write_credential')!.args;
    expect(write.p_scopes).toEqual(['Scope.Send']);
    expect(write.p_scopes).not.toContain('Scope.Calendar');
  });

  it('falls back to the requested set only when the server reports no scope', async () => {
    // §5.1: `scope` is optional only when identical to what was asked for, so
    // silence is not ambiguity — it means "exactly that".
    const local = harness();
    local.authorizationCodeGrant.mockResolvedValueOnce({
      access_token: 'access-1',
      token_type: 'bearer' as const,
      refresh_token: 'refresh-1',
      expires_in: 3600,
      expiresIn: () => 3600,
    } as never);

    await local.flow.complete({ state: 'state-value', callbackUrl, resolveProvider });

    const write = local.rpcCalls.find((c) => c.name === 'integrations_write_credential')!.args;
    expect(write.p_scopes).toEqual(['Scope.Send', 'Scope.Calendar']);
  });

  it('passes the PKCE verifier and the expected state to the exchange', async () => {
    await complete();

    expect(h.authorizationCodeGrant).toHaveBeenCalledWith(expect.anything(), callbackUrl, {
      pkceCodeVerifier: 'verifier-value',
      expectedState: 'state-value',
    });
  });

  it('returns where the browser should land', async () => {
    await expect(complete()).resolves.toMatchObject({
      connectionId: 'connection-1',
      redirectTo: '/admin/integrations',
    });
  });

  it('⚠️ a replayed state matches nothing and is refused', async () => {
    // Single use is the UPDATE's own WHERE clause — the first callback already
    // set `consumed_at`, so the second one finds no row.
    const local = harness({ stateRow: null });

    await expect(
      local.flow.complete({ state: 'state-value', callbackUrl, resolveProvider }),
    ).rejects.toMatchObject({
      code: 'integration_oauth_state_invalid',
      classification: 'permanent',
    });
  });

  it('does not say WHY a state failed', async () => {
    // Unknown, used and expired are deliberately indistinguishable: telling them
    // apart would let someone probe which states exist.
    const local = harness({ stateRow: null });

    await local.flow
      .complete({ state: 'state-value', callbackUrl, resolveProvider })
      .catch((error: Error) => {
        expect(error.message).not.toMatch(/expired|already|unknown/i);
      });
  });

  it('never writes a connection when the exchange fails', async () => {
    h.authorizationCodeGrant.mockRejectedValueOnce(new Error('invalid_grant'));

    await expect(complete()).rejects.toMatchObject({
      code: 'integration_authorization_failed',
    });
    expect(h.rpcCalls).toHaveLength(0);
  });

  it('refuses a state row naming a provider that is no longer registered', async () => {
    await expect(
      h.flow.complete({ state: 'state-value', callbackUrl, resolveProvider: () => undefined }),
    ).rejects.toMatchObject({ code: 'integration_provider_unknown' });
  });
});
