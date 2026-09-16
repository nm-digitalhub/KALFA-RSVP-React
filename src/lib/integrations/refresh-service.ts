import 'server-only';

import * as client from 'openid-client';

import { createAdminClient } from '@/lib/supabase/admin';

import { parseOAuthCredentialSecret } from './credential-secret';
import { IntegrationRuntimeError, readIntegrationRuntimeError } from './errors';
import { createOAuthConfigLoader, type OAuthConfigLoader } from './oauth-config';
import type { ProviderDefinition } from './provider';
import { normalizeTokenResponse } from './token-response';

type AdminClient = ReturnType<typeof createAdminClient>;

/** The columns every lifecycle decision is made from. Read once, passed down. */
export type IntegrationConnectionRow = {
  id: string;
  provider: string;
  credential_kind: string;
  status: string;
  scopes: string[];
  expires_at: string | null;
};

export const CONNECTION_COLUMNS = 'id, provider, credential_kind, status, scopes, expires_at';

/**
 * Must exceed the provider request timeout, or a refresh loses its own claim
 * mid-flight. See the budget chain in
 * 20260916160150_integration_credential_refresh_lease.sql.
 */
const LEASE_SECONDS = 60;

/**
 * How long to wait for another worker's refresh before giving up and letting the
 * engine retry. Deliberately far shorter than the lease: holding a node for a
 * full lease TTL would eat the node budget for a wait that the queue can absorb
 * for free.
 */
const LOCKED_POLL_ATTEMPTS = 5;
const LOCKED_POLL_INTERVAL_MS = 400;

export type CredentialRefreshService = {
  refresh(args: {
    connection: IntegrationConnectionRow;
    provider: ProviderDefinition;
  }): Promise<string>;
};

export function createCredentialRefreshService(
  deps: {
    admin?: AdminClient;
    configLoader?: OAuthConfigLoader;
    refreshGrant?: typeof client.refreshTokenGrant;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): CredentialRefreshService {
  const admin = deps.admin ?? createAdminClient();
  const configLoader = deps.configLoader ?? createOAuthConfigLoader({ admin });
  const refreshGrant = deps.refreshGrant ?? client.refreshTokenGrant;
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function readSecret(connection: IntegrationConnectionRow): Promise<string> {
    const { data, error } = await admin.rpc('integrations_read_credential', {
      p_connection_id: connection.id,
      p_expected_provider: connection.provider,
      p_expected_kind: connection.credential_kind,
    });

    if (error) {
      throw new IntegrationRuntimeError(
        'transient',
        'integration_credential_read_failed',
        'Integration credential could not be read.',
        { cause: error },
      );
    }
    if (typeof data !== 'string' || data.length === 0) {
      // The RPC answers null for a connection that is no longer in a readable
      // status, so this is also how "someone revoked it while we waited" arrives.
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_credential_missing',
        'The selected integration connection has no usable credential.',
      );
    }
    return data;
  }

  async function release(
    connectionId: string,
    leaseId: string,
    nextStatus: 'requires_reauthorization' | 'failed' | undefined,
    lastError: string | undefined,
  ): Promise<void> {
    // Best effort by design. The lease has a TTL, so a failure to release costs
    // the next worker a bounded wait — whereas throwing here would replace the
    // real reason for the refresh failure with a bookkeeping error.
    const { error } = await admin.rpc('integrations_release_credential_refresh', {
      p_connection_id: connectionId,
      p_lease_id: leaseId,
      p_next_status: nextStatus,
      p_last_error: lastError,
    });
    if (error) {
      console.error('[integrations] failed to release refresh lease', {
        connectionId,
        // Never the lease id, never the error body — a lease id is a capability
        // and a provider error body can carry token material.
        code: error.code,
      });
    }
  }

  /**
   * Another worker holds the lease. Wait a short, bounded time and read what it
   * persisted, rather than refreshing in parallel — two refreshes with the same
   * refresh token is the exact race the lease exists to prevent.
   */
  async function awaitOtherWorker(connection: IntegrationConnectionRow): Promise<string> {
    for (let attempt = 0; attempt < LOCKED_POLL_ATTEMPTS; attempt += 1) {
      await sleep(LOCKED_POLL_INTERVAL_MS);

      const { data: row, error } = await admin
        .from('integration_connections')
        .select('refresh_lease_until')
        .eq('id', connection.id)
        .maybeSingle();

      if (error || !row) continue;

      const until = row.refresh_lease_until;
      if (until === null || Date.parse(until) <= now()) {
        // `readSecret` re-reads through the RPC, which filters on status — so a
        // worker that failed and set `requires_reauthorization` is reported as
        // a missing credential here rather than silently retried.
        const raw = await readSecret(connection);
        return parseOAuthCredentialSecret(raw).accessToken;
      }
    }

    // Transient, not permanent: nothing is wrong with the connection, we simply
    // arrived while someone else was working on it. The queue can afford to try
    // again in a moment; a node cannot afford to hold a worker for a lease TTL.
    throw new IntegrationRuntimeError(
      'transient',
      'integration_refresh_in_progress',
      'Another worker is refreshing this integration credential.',
    );
  }

  return {
    async refresh({ connection, provider }) {
      const { data: claimRows, error: claimError } = await admin.rpc(
        'integrations_claim_credential_refresh',
        {
          p_connection_id: connection.id,
          p_expected_provider: connection.provider,
          p_expected_kind: connection.credential_kind,
          p_lease_seconds: LEASE_SECONDS,
        },
      );

      if (claimError) {
        throw new IntegrationRuntimeError(
          'transient',
          'integration_refresh_claim_failed',
          'Could not claim the integration credential refresh lease.',
          { cause: claimError },
        );
      }

      const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
      if (!claim) {
        throw new IntegrationRuntimeError(
          'transient',
          'integration_refresh_claim_failed',
          'The refresh lease claim returned no result.',
        );
      }

      if (claim.outcome === 'locked') return awaitOtherWorker(connection);

      if (claim.outcome !== 'claimed' || !claim.lease_id) {
        // `not_refreshable`: the connection is pending, revoked, failed or
        // requires_reauthorization. The database made that decision, and each of
        // those states names a remedy a refresh cannot perform.
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_refresh_not_permitted',
          `The integration connection is ${connection.status} and cannot be refreshed automatically.`,
        );
      }

      const leaseId = claim.lease_id;

      try {
        const previous = parseOAuthCredentialSecret(await readSecret(connection));

        if (!previous.refreshToken) {
          // Nothing to refresh WITH. Only a human re-authorizing can produce one
          // — for most providers a refresh token is issued at the first consent
          // and never again without it.
          await release(
            connection.id,
            leaseId,
            'requires_reauthorization',
            'no refresh token is stored for this connection',
          );
          throw new IntegrationRuntimeError(
            'permanent',
            'integration_refresh_token_missing',
            'The connection has no refresh token; it must be authorized again.',
          );
        }

        const configuration = await configLoader.load(provider);
        const tokens = await refreshGrant(configuration, previous.refreshToken);

        const normalized = normalizeTokenResponse({
          tokens,
          previous,
          // ⚠️ The PREVIOUSLY GRANTED set, never what was requested originally.
          // RFC 6749 §6: a refresh request that omits `scope` asks for the scope
          // already granted — so inheriting the original request would quietly
          // re-widen a connection the user had narrowed at the consent screen.
          requestedAccessScopes: connection.scopes,
          nowMs: now(),
        });

        const { data: replaced, error: replaceError } = await admin.rpc(
          'integrations_replace_credential',
          {
            p_connection_id: connection.id,
            p_expected_provider: connection.provider,
            p_expected_kind: connection.credential_kind,
            p_secret: normalized.secret,
            p_expires_at: normalized.expiresAt,
            p_lease_id: leaseId,
          },
        );

        if (replaceError) {
          throw new IntegrationRuntimeError(
            'transient',
            'integration_refresh_persist_failed',
            'The refreshed credential could not be stored.',
            { cause: replaceError },
          );
        }
        if (replaced !== true) {
          // Our lease lapsed or was taken over while the provider was answering.
          // Someone else's result is now authoritative and ours is stale, so the
          // only safe move is to start over rather than force the write.
          throw new IntegrationRuntimeError(
            'transient',
            'integration_refresh_lease_lost',
            'The refresh lease expired before the new credential could be stored.',
          );
        }

        // `integrations_replace_credential` clears the lease in the same
        // statement, so there is no release on the success path.
        return parseOAuthCredentialSecret(normalized.secret).accessToken;
      } catch (error) {
        await release(connection.id, leaseId, ...classifyRefreshFailure(error));
        throw toRuntimeError(error);
      }
    },
  };
}

/**
 * What an OAuth error code at the TOKEN ENDPOINT means, in one table.
 *
 * Two different questions are answered from one place on purpose, because
 * answering them separately is how they drift:
 *
 *   connection — does this change the connection's status?
 *   request    — is the caller's failure permanent or worth retrying?
 *
 * The distinction that matters most: A BLIP MUST NOT BURN THE CONNECTION.
 * `requires_reauthorization` is a claim that a human has to act, and making it
 * on a 503 would send an operator to re-consent something that was never
 * broken. Only an answer that the GRANT ITSELF is gone earns it.
 *
 * Codes are RFC 6749 §5.2 unless noted.
 */
const TOKEN_ENDPOINT_ERRORS: Record<
  string,
  { status: 'requires_reauthorization' | 'failed' | undefined; permanent: boolean }
> = {
  // "expired, revoked, [or] does not match the redirection URI" — the grant is
  // gone, and only a new consent produces another one.
  invalid_grant: { status: 'requires_reauthorization', permanent: true },
  // The granted scope no longer stands. Re-consent is the remedy.
  invalid_scope: { status: 'requires_reauthorization', permanent: true },

  // OUR registration, not the user's grant. Re-consenting would not fix it, so
  // it must not be described as though it would.
  invalid_client: { status: 'failed', permanent: true },
  unauthorized_client: { status: 'failed', permanent: true },
  unsupported_grant_type: { status: 'failed', permanent: true },
  invalid_request: { status: 'failed', permanent: true },

  // §4.1.2.1 codes some servers also return from the token endpoint. They say
  // "later", not "no" — leave the status alone and let the next attempt try.
  temporarily_unavailable: { status: undefined, permanent: false },
  server_error: { status: undefined, permanent: false },
  slow_down: { status: undefined, permanent: false },
};

/** An unknown code is treated as our problem, not the user's: no re-consent prompt. */
const UNKNOWN_TOKEN_ENDPOINT_ERROR = { status: 'failed', permanent: true } as const;

function classifyRefreshFailure(
  error: unknown,
): ['requires_reauthorization' | 'failed' | undefined, string | undefined] {
  if (error instanceof client.ResponseBodyError) {
    const mapped = TOKEN_ENDPOINT_ERRORS[error.error] ?? UNKNOWN_TOKEN_ENDPOINT_ERROR;
    return mapped.status === undefined
      ? [undefined, undefined]
      : [mapped.status, `token endpoint returned ${error.error}`];
  }

  const known = readIntegrationRuntimeError(error);
  if (known?.code === 'integration_provider_disabled') {
    // Withdrawing the platform configuration is a decision, and its documented
    // consequence is that renewal stops. Recording it means an operator sees a
    // reason rather than a connection that quietly went stale.
    return ['requires_reauthorization', 'the provider configuration is disabled'];
  }
  if (known?.code === 'integration_refresh_token_missing') {
    return [undefined, undefined]; // already recorded before the throw
  }
  if (known?.classification === 'permanent') {
    return ['failed', known.code];
  }

  // Transient, or something we do not recognise: clear the lease, change
  // nothing. An unrecognised error is not evidence about the grant.
  return [undefined, undefined];
}

function toRuntimeError(error: unknown): unknown {
  if (readIntegrationRuntimeError(error)) return error;

  if (error instanceof client.ResponseBodyError) {
    const mapped = TOKEN_ENDPOINT_ERRORS[error.error] ?? UNKNOWN_TOKEN_ENDPOINT_ERROR;
    return new IntegrationRuntimeError(
      mapped.permanent ? 'permanent' : 'transient',
      'integration_refresh_rejected',
      `The token endpoint rejected the refresh with "${error.error}".`,
      { cause: error },
    );
  }

  // A network failure, a timeout, a 5xx with no OAuth error body. None of them
  // are evidence that the grant is gone.
  return new IntegrationRuntimeError(
    'transient',
    'integration_refresh_failed',
    'The integration credential could not be refreshed.',
    { cause: error },
  );
}
