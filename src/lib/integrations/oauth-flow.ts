import 'server-only';

import { createHash } from 'node:crypto';

import * as client from 'openid-client';

import { createAdminClient } from '@/lib/supabase/admin';
import { getAppOrigin } from '@/lib/url';

import { IntegrationRuntimeError } from './errors';
import { readAccountIdentity } from './account-identity';
import { createOAuthConfigLoader, type OAuthConfigLoader } from './oauth-config';
import type { ProviderDefinition } from './provider';
import { normalizeTokenResponse } from './token-response';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * ONE callback path for every provider, and it is a constant.
 *
 * The provider is recovered from the state row, not from the URL, so nothing
 * about the path varies. That matters twice over: it is the value registered at
 * each provider, and `authorizationCodeGrant` derives the `redirect_uri` it
 * sends to the token endpoint from the URL it is handed — so the two legs agree
 * only because both are built from this constant and `getAppOrigin()`.
 */
export const INTEGRATION_OAUTH_CALLBACK_PATH = '/api/integrations/oauth/callback';

/**
 * Long enough for a person to read a consent screen, short enough that an
 * abandoned authorization is not a standing credential-shaped row.
 */
const STATE_TTL_MINUTES = 10;

/**
 * The transaction clock, not this server's.
 *
 * Measured: Postgres reads the literal `now` as the transaction timestamp
 * (`'now'::timestamptz = now()` → true). Sending it instead of an ISO string
 * takes the Next.js server's clock out of the comparison entirely — a skew of
 * seconds between app and database would otherwise decide whether a state has
 * expired.
 */
const DB_NOW = 'now';

export type StartAuthorizationResult = {
  authorizationUrl: string;
};

export type CompleteAuthorizationResult = {
  connectionId: string;
  /** Where the browser should land, as recorded when the flow began. */
  redirectTo: string;
};

export function createOAuthFlow(
  deps: {
    admin?: AdminClient;
    configLoader?: OAuthConfigLoader;
    authorizationCodeGrant?: typeof client.authorizationCodeGrant;
    now?: () => number;
    randomState?: () => string;
    randomPKCECodeVerifier?: () => string;
    appOrigin?: () => Promise<string>;
  } = {},
) {
  const admin = deps.admin ?? createAdminClient();
  const configLoader = deps.configLoader ?? createOAuthConfigLoader({ admin });
  const grant = deps.authorizationCodeGrant ?? client.authorizationCodeGrant;
  const now = deps.now ?? Date.now;
  const randomState = deps.randomState ?? client.randomState;
  const randomVerifier = deps.randomPKCECodeVerifier ?? client.randomPKCECodeVerifier;
  const appOrigin = deps.appOrigin ?? getAppOrigin;

  async function redirectUri(): Promise<string> {
    return new URL(INTEGRATION_OAUTH_CALLBACK_PATH, await appOrigin()).href;
  }

  return {
    /**
     * Begin an authorization, and record everything the callback will need.
     *
     * The state row is written BEFORE the browser leaves, because the callback
     * arrives as a brand-new request with no session of its own: everything it
     * is allowed to know — which provider, which verifier, which scopes, and WHO
     * started this — has to already be in the row it consumes.
     */
    async start(args: {
      provider: ProviderDefinition;
      /** Which capabilities the operator selected. Their scopes are the ask. */
      capabilities: readonly string[];
      /** Where to send the browser afterwards. Already validated by the caller. */
      redirectTo: string;
      /** The authenticated admin. `integration_oauth_states.created_by` is NOT NULL. */
      createdBy: string;
    }): Promise<StartAuthorizationResult> {
      const { provider } = args;
      if (!provider.oauth || provider.credentialKind !== 'oauth2_authorization_code') {
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_provider_not_interactive',
          `Integration provider "${provider.id}" does not use an interactive authorization flow.`,
        );
      }

      const unknown = args.capabilities.filter(
        (capability) => !Object.hasOwn(provider.capabilities, capability),
      );
      if (unknown.length > 0) {
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_capability_unsupported',
          `Integration provider "${provider.id}" does not support: ${unknown.join(', ')}.`,
        );
      }

      // ⚠️ TWO SETS, AND ONLY ONE OF THEM IS PERSISTED.
      //
      // `accessScopes` are permissions the ACCESS TOKEN will carry, and they are
      // what the callback records on the connection and what the runtime checks
      // a capability against. `authorizationScopes` are asked for at the
      // authorization endpoint and never granted to the token — a provider does
      // not report them back in `scope`, so storing them would make every later
      // request demand something that can never be present.
      const accessScopes = [
        ...new Set(args.capabilities.flatMap((c) => provider.capabilities[c] ?? [])),
      ];
      const requestScopes = [
        ...new Set([...accessScopes, ...(provider.oauth.authorizationScopes ?? [])]),
      ];

      const codeVerifier = randomVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const state = randomState();

      // Only the HASH is stored. A leak of this table yields nothing replayable:
      // the callback presents the raw value, and a row can only be found by
      // someone who already holds it.
      const { error: stateError } = await admin.from('integration_oauth_states').insert({
        state_hash: hashState(state),
        provider: provider.id,
        code_verifier: codeVerifier,
        redirect_to: args.redirectTo,
        requested_scopes: accessScopes,
        created_by: args.createdBy,
        expires_at: new Date(now() + STATE_TTL_MINUTES * 60_000).toISOString(),
      });

      if (stateError) {
        throw new IntegrationRuntimeError(
          'transient',
          'integration_oauth_state_write_failed',
          'The authorization could not be started.',
          { cause: stateError },
        );
      }

      const configuration = await configLoader.load(provider);

      return {
        authorizationUrl: client.buildAuthorizationUrl(configuration, {
          ...(provider.oauth.authorizationParams ?? {}),
          redirect_uri: await redirectUri(),
          scope: requestScopes.join(' '),
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          // Always sent, even when the server supports PKCE. Here `state` is not
          // only CSRF protection — it is the key to the row holding the verifier
          // and the actor, so the flow cannot complete without it.
          state,
        }).href,
      };
    },

    /**
     * Finish an authorization: consume the state, exchange the code, store the
     * credential.
     */
    async complete(args: {
      /** The raw `state` from the callback query. */
      state: string;
      /** The `code`/`error` carrying URL, rebuilt from `getAppOrigin()`. */
      callbackUrl: URL;
      /** Looked up by the caller from the consumed row's provider id. */
      resolveProvider: (providerId: string) => ProviderDefinition | undefined;
    }): Promise<CompleteAuthorizationResult> {
      // ONE STATEMENT. The single-use guarantee is the UPDATE's own WHERE
      // clause: a second callback with the same state matches nothing, because
      // the first one already set `consumed_at`. Reading first and updating
      // after would leave a window in which both replays pass.
      const { data: stateRow, error: consumeError } = await admin
        .from('integration_oauth_states')
        .update({ consumed_at: DB_NOW })
        .eq('state_hash', hashState(args.state))
        .is('consumed_at', null)
        .gt('expires_at', DB_NOW)
        .select('provider, code_verifier, redirect_to, requested_scopes, created_by')
        .maybeSingle();

      if (consumeError) {
        throw new IntegrationRuntimeError(
          'transient',
          'integration_oauth_state_consume_failed',
          'The authorization could not be completed.',
          { cause: consumeError },
        );
      }
      if (!stateRow) {
        // Unknown, already used, or expired — deliberately indistinguishable.
        // Telling them apart would let someone probe which states exist.
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_oauth_state_invalid',
          'This authorization link is no longer valid. Start the connection again.',
        );
      }

      const provider = args.resolveProvider(stateRow.provider);
      if (!provider?.oauth) {
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_provider_unknown',
          `Integration provider "${stateRow.provider}" is not registered.`,
        );
      }

      const configuration = await configLoader.load(provider);

      let tokens;
      try {
        tokens = await grant(configuration, args.callbackUrl, {
          pkceCodeVerifier: stateRow.code_verifier,
          expectedState: args.state,
        });
      } catch (cause) {
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_authorization_failed',
          'The provider did not complete the authorization.',
          { cause },
        );
      }

      const normalized = normalizeTokenResponse({
        tokens,
        // First grant: there is no earlier credential to inherit a refresh token
        // from, and the fallback set is what THIS request asked for.
        requestedAccessScopes: stateRow.requested_scopes,
        nowMs: now(),
      });

      // WHO this connection is, if the provider was willing to say.
      //
      // `claims()` is `openid-client`'s accessor for the ID token's claim set,
      // and it returns them only after the library has verified the token —
      // signature, issuer, audience, expiry. Reading the JWT ourselves would
      // skip every one of those checks on a value that decides which account a
      // connection belongs to. `undefined` when no `id_token` came back, which
      // `readAccountIdentity` handles as "no identity" rather than an error.
      const identity = readAccountIdentity(
        typeof tokens.claims === 'function' ? tokens.claims() : undefined,
      );

      const label = await uniqueConnectionLabel(
        admin,
        provider.id,
        identity.displayName ?? provider.displayName,
      );

      const { data: connectionId, error: writeError } = await admin.rpc(
        'integrations_write_credential',
        {
          p_provider: provider.id,
          p_credential_kind: provider.credentialKind,
          p_label: label,
          p_scopes: normalized.accessScopes,
          // `accountKey` is the ONLY field here anything compares. It is stored
          // rather than acted on: today nothing dedups, and a future decision to
          // update-instead-of-insert on a reconnect needs this value to already
          // be on the older rows. Writing it now is what makes that choice
          // available later without a backfill nobody can perform.
          p_metadata: identity.key === null ? {} : { accountKey: identity.key },
          p_secret: normalized.secret,
          p_expires_at: normalized.expiresAt,
          // The actor recorded when the flow BEGAN. A callback is a fresh
          // request with no session, and `auth.uid()` under the service role is
          // NULL — measured — so provenance has to travel in the state row.
          p_created_by: stateRow.created_by,
        },
      );

      if (writeError || typeof connectionId !== 'string') {
        throw new IntegrationRuntimeError(
          'transient',
          'integration_connection_write_failed',
          'The authorization succeeded but the connection could not be stored.',
          { cause: writeError },
        );
      }

      return { connectionId, redirectTo: stateRow.redirect_to };
    },

    /** Exposed so a route handler builds the same URL the token exchange will. */
    redirectUri,
  };
}

/**
 * A label no existing connection of this provider already uses.
 *
 * ⚠️ WITHOUT THIS, TWO CONNECTIONS CAN STILL SHARE A NAME. An identity solves
 * the common case — two mailboxes have two addresses — but not every one:
 * a tenant that strips the ID token leaves every connection on the provider's
 * display name, and reconnecting the SAME account produces a second row with
 * the same address on it. Both end as rows a person cannot tell apart, which is
 * the whole defect this is meant to remove.
 *
 * n8n reaches for the same shape and we have now seen it in their live product:
 * `credentials.store.ts` asks the server for a name and gets "Microsoft Outlook
 * account", then "Microsoft Outlook account 2". The counter is a TIE-BREAKER,
 * not an identity — it only ever appends to a name that was already chosen.
 *
 * NOT RACE-PROOF, deliberately. Two authorizations completing for one provider
 * within the same instant would both read the same set and pick the same suffix.
 * Making that impossible needs a unique index and a retry loop, i.e. a migration
 * — and the collision it would prevent is two rows sharing a label, which is
 * exactly the state we are already in today and recover from by renaming. The
 * cost is not worth the ceremony; n8n's server-side version has the same
 * property.
 */
async function uniqueConnectionLabel(
  admin: AdminClient,
  providerId: string,
  preferred: string,
): Promise<string> {
  const { data, error } = await admin
    .from('integration_connections')
    .select('label')
    .eq('provider', providerId);

  // A label is cosmetic; a failed read here must not fail an authorization that
  // otherwise succeeded. Fall back to the preferred name and accept a possible
  // duplicate over losing the connection.
  if (error) return preferred;

  const taken = new Set((data ?? []).map((row) => row.label));
  if (!taken.has(preferred)) return preferred;

  // Starts at 2 because the unsuffixed name IS the first one.
  for (let n = 2; n <= taken.size + 2; n += 1) {
    const candidate = `${preferred} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }

  // Unreachable while the loop runs past the number of rows, but a label is
  // required and `NOT NULL` — never return an empty string to the insert.
  return preferred;
}

/**
 * The raw state never reaches the database.
 *
 * sha256 and not a salted KDF on purpose: the input is 32 bytes of CSPRNG
 * output, so there is no dictionary to stretch against, and the lookup has to be
 * a plain equality match on an indexed column.
 */
function hashState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}
