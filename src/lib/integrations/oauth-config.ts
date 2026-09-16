import 'server-only';

import * as client from 'openid-client';

import { createAdminClient } from '@/lib/supabase/admin';

import { IntegrationRuntimeError } from './errors';
import type { ProviderDefinition } from './provider';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Turns a provider definition plus this deployment's stored OAuth client into
 * something the library can make a token request with.
 *
 * TWO SOURCES, DELIBERATELY. The definition says what the provider IS — its
 * issuer, how it authenticates a client, which scopes a capability needs. The
 * `integration_provider_configs` row says what THIS DEPLOYMENT was registered
 * as. Neither belongs in the other: a provider is code, a registration is
 * operational data, and only one of them differs between beta and production.
 */
export type OAuthConfigLoader = {
  load(provider: ProviderDefinition): Promise<client.Configuration>;
};

/**
 * `discovery` for a provider that publishes a document, the `Configuration`
 * constructor for one that does not. Injected so the refresh service can be
 * tested without a network call to an issuer.
 */
export type DiscoveryFn = typeof client.discovery;

export function createOAuthConfigLoader(
  deps: { admin?: AdminClient; discovery?: DiscoveryFn } = {},
): OAuthConfigLoader {
  const admin = deps.admin ?? createAdminClient();
  const discovery = deps.discovery ?? client.discovery;

  return {
    async load(provider) {
      if (!provider.oauth) {
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_provider_not_oauth',
          `Integration provider "${provider.id}" has no OAuth configuration.`,
        );
      }

      const { data: row, error } = await admin
        .from('integration_provider_configs')
        // `vault_secret_id` is deliberately NOT selected. The uuid is worthless
        // without the vault privilege, but selecting it would put it in a query
        // result that may end up in a log line, for no gain — the secret is
        // fetched by the RPC below, by provider name.
        .select('provider, client_id, extra, enabled')
        .eq('provider', provider.id)
        .maybeSingle();

      if (error) {
        throw new IntegrationRuntimeError(
          'transient',
          'integration_provider_config_lookup_failed',
          'Integration provider configuration could not be read.',
          { cause: error },
        );
      }
      if (!row) {
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_provider_not_configured',
          `No OAuth client is configured for integration provider "${provider.id}".`,
        );
      }
      if (!row.enabled) {
        // Mirrors what `integrations_read_provider_secret` raises, caught here
        // first so the caller does not have to read a Postgres error string to
        // learn something this row already says.
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_provider_disabled',
          `Integration provider "${provider.id}" is disabled.`,
        );
      }

      const clientSecret = await readClientSecret(admin, provider.id);
      const clientAuth = buildClientAuth(provider.oauth.clientAuth, clientSecret);

      // ⚠️ The fourth argument is passed on every path. The library's default is
      // CONDITIONAL — ClientSecretPost when a secret is present, None otherwise —
      // so a deployment whose secret failed to load would silently downgrade to
      // public-client authentication instead of failing. `clientAuth` is
      // required on the provider definition for exactly this reason; passing it
      // is what makes that requirement mean something.
      try {
        return provider.oauth.server instanceof URL
          ? await discovery(provider.oauth.server, row.client_id, undefined, clientAuth)
          : new client.Configuration(
              provider.oauth.server,
              row.client_id,
              undefined,
              clientAuth,
            );
      } catch (cause) {
        // Discovery is an HTTPS round-trip to the issuer. A failure here is the
        // issuer being unreachable far more often than it is a misconfiguration,
        // so it must not burn the connection's status.
        throw new IntegrationRuntimeError(
          'transient',
          'integration_provider_discovery_failed',
          `Could not load authorization server metadata for "${provider.id}".`,
          { cause },
        );
      }
    },
  };
}

async function readClientSecret(
  admin: AdminClient,
  providerId: string,
): Promise<string | undefined> {
  const { data, error } = await admin.rpc('integrations_read_provider_secret', {
    p_provider: providerId,
  });

  if (error) {
    // The RPC raises P0001 'integration_provider_disabled' for a configured but
    // disabled provider. That is a decision someone made, not an outage, so it
    // keeps its meaning instead of being flattened into "read failed".
    if (error.message.includes('integration_provider_disabled')) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_provider_disabled',
        `Integration provider "${providerId}" is disabled.`,
      );
    }
    throw new IntegrationRuntimeError(
      'transient',
      'integration_provider_secret_read_failed',
      'Integration provider client secret could not be read.',
      { cause: error },
    );
  }

  // `null` is legitimate: a public client has no secret, and `clientAuth: 'none'`
  // is how a provider declares that. Whether the absence is a problem is decided
  // by `buildClientAuth`, which knows what the provider asked for.
  return typeof data === 'string' && data.length > 0 ? data : undefined;
}

function buildClientAuth(
  method: NonNullable<ProviderDefinition['oauth']>['clientAuth'],
  clientSecret: string | undefined,
): client.ClientAuth {
  if (method === 'none') return client.None();

  if (!clientSecret) {
    // Refusing here rather than letting the library fall back is the whole point
    // of making `clientAuth` explicit: a confidential client that reaches the
    // token endpoint with no secret would be treated as a public one, and the
    // failure would arrive from the provider as an opaque `invalid_client`.
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_provider_secret_missing',
      'The provider requires client authentication but no client secret is stored.',
    );
  }

  return method === 'basic'
    ? client.ClientSecretBasic(clientSecret)
    : client.ClientSecretPost(clientSecret);
}
