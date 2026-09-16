import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

import { parseOAuthCredentialSecret } from './credential-secret';
import { IntegrationRuntimeError } from './errors';
import type { ProviderDefinition } from './provider';
import {
  CONNECTION_COLUMNS,
  createCredentialRefreshService,
  type CredentialRefreshService,
  type IntegrationConnectionRow,
} from './refresh-service';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * How early a token counts as spent.
 *
 * Not a safety blanket: a token that expires while a provider request is in
 * flight fails as a 401 that the reactive path then has to unwind. Spending the
 * last half-minute of a token's life is worth less than avoiding that.
 */
const EXPIRY_SKEW_MS = 30_000;

/**
 * The statuses a credential can be SERVED from, which is wider than the ones it
 * can be served from DIRECTLY.
 *
 * `expired` is here because that is what self-healing means: the accessor
 * refreshes it and returns a live token. It is not an error state, it is a state
 * with a known remedy. Everything outside this pair — pending, revoked, failed,
 * requires_reauthorization — names a remedy no automatic path can perform.
 */
const SERVABLE_STATUSES = new Set(['active', 'expired']);

export function createCredentialAccessor(
  deps: {
    admin?: AdminClient;
    now?: () => number;
    refreshService?: CredentialRefreshService;
  } = {},
) {
  const admin = deps.admin ?? createAdminClient();
  const now = deps.now ?? Date.now;
  const refreshService = deps.refreshService ?? createCredentialRefreshService({ admin });

  async function load(
    connectionId: string,
    provider: ProviderDefinition,
    requiredScopes: readonly string[],
  ): Promise<IntegrationConnectionRow> {
    const { data: connection, error } = await admin
      .from('integration_connections')
      .select(CONNECTION_COLUMNS)
      .eq('id', connectionId)
      .maybeSingle();

    if (error) {
      throw new IntegrationRuntimeError(
        'transient',
        'integration_connection_lookup_failed',
        'Integration connection lookup failed.',
        { cause: error },
      );
    }
    if (!connection) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_connection_not_found',
        'The selected integration connection does not exist.',
      );
    }
    if (connection.provider !== provider.id) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_connection_provider_mismatch',
        'The selected connection belongs to a different integration provider.',
      );
    }
    if (connection.credential_kind !== provider.credentialKind) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_connection_credential_kind_mismatch',
        'The selected connection uses an unexpected credential kind.',
      );
    }
    if (!SERVABLE_STATUSES.has(connection.status)) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_connection_inactive',
        `The selected integration connection is ${connection.status}.`,
      );
    }

    // Checked against what the provider REPORTED AS GRANTED, not what was asked
    // for. A consent screen that lets a user untick a scope is the case this
    // exists for, and it is why `capabilities` may only ever list access-token
    // scopes — a scope the provider never reports could not pass this.
    const missingScopes = requiredScopes.filter((scope) => !connection.scopes.includes(scope));
    if (missingScopes.length > 0) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_scope_missing',
        `The selected integration connection is missing required scope: ${missingScopes.join(', ')}.`,
      );
    }

    return connection;
  }

  /**
   * True when the stored credential is spent, or will be before a request using
   * it can land.
   *
   * ⚠️ A NULL EXPIRY IS NOT "EXPIRED", AND NOT "NEVER EXPIRES". It means the
   * authorization server did not say — `expires_in` is RECOMMENDED, not
   * REQUIRED (RFC 6749 §5.1). There is nothing to be proactive about, so such a
   * connection is carried entirely by the reactive path: it is used until the
   * provider answers 401. That is the whole reason the nullable expiry and the
   * 401 retry had to ship together.
   */
  function isSpent(connection: IntegrationConnectionRow): boolean {
    if (connection.status === 'expired') return true;
    if (!connection.expires_at) return false;

    const expiresAt = Date.parse(connection.expires_at);
    if (!Number.isFinite(expiresAt)) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_connection_invalid_expiry',
        'The selected integration connection has an invalid expiry timestamp.',
      );
    }
    return expiresAt <= now() + EXPIRY_SKEW_MS;
  }

  async function readStoredToken(
    connection: IntegrationConnectionRow,
    provider: ProviderDefinition,
  ): Promise<string> {
    const { data: rawSecret, error } = await admin.rpc('integrations_read_credential', {
      p_connection_id: connection.id,
      p_expected_provider: provider.id,
      p_expected_kind: provider.credentialKind,
    });

    if (error) {
      throw new IntegrationRuntimeError(
        'transient',
        'integration_credential_read_failed',
        'Integration credential could not be read.',
        { cause: error },
      );
    }
    if (typeof rawSecret !== 'string' || rawSecret.length === 0) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_credential_missing',
        'The selected integration connection has no usable credential.',
      );
    }

    if (provider.credentialKind === 'static') return rawSecret;
    return parseOAuthCredentialSecret(rawSecret).accessToken;
  }

  return {
    /**
     * The credential to attach to one provider request.
     *
     * PROACTIVE REFRESH LIVES HERE, not in the transport. The request layer's
     * job is to get a credential onto a request without the credential leaking;
     * whether that credential had to be renewed first is a lifecycle question,
     * and keeping it here is what lets the transport stay ignorant of OAuth.
     */
    async resolve(args: {
      connectionId: string;
      provider: ProviderDefinition;
      requiredScopes: readonly string[];
    }): Promise<string> {
      const connection = await load(args.connectionId, args.provider, args.requiredScopes);

      // A static credential has no expiry and nothing to refresh with.
      if (args.provider.credentialKind !== 'static' && isSpent(connection)) {
        return refreshService.refresh({ connection, provider: args.provider });
      }

      return readStoredToken(connection, args.provider);
    },

    /**
     * Renew unconditionally. The reactive path calls this after a 401, where the
     * stored expiry — if there even was one — has already been proved wrong.
     */
    async refresh(args: {
      connectionId: string;
      provider: ProviderDefinition;
      requiredScopes: readonly string[];
    }): Promise<string> {
      const connection = await load(args.connectionId, args.provider, args.requiredScopes);

      if (args.provider.credentialKind === 'static') {
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_refresh_not_supported',
          'A static credential cannot be refreshed; replace it in the admin surface.',
        );
      }

      return refreshService.refresh({ connection, provider: args.provider });
    },

    /**
     * Record that only a human can restore this connection.
     *
     * A direct column write rather than an RPC, and stated rather than hidden:
     * `integrations_release_credential_refresh` is the guarded path, but it
     * matches on a lease, and this is called where there is no lease to hold —
     * after a refresh already succeeded and the provider rejected the NEW token.
     * The CHECK constraint still bounds the value, and the column-level grant
     * still bounds which columns are writable at all.
     */
    async markRequiresReauthorization(args: {
      connectionId: string;
      reason: string;
    }): Promise<void> {
      const { error } = await admin
        .from('integration_connections')
        .update({ status: 'requires_reauthorization', last_error: args.reason })
        .eq('id', args.connectionId);

      if (error) {
        // Never fatal. The caller is already throwing the real failure, and
        // replacing it with a bookkeeping error would hide what went wrong.
        console.error('[integrations] failed to mark connection for reauthorization', {
          connectionId: args.connectionId,
          code: error.code,
        });
      }
    },
  };
}

export type CredentialAccessor = ReturnType<typeof createCredentialAccessor>;
