import 'server-only';

import type { ServerMetadata } from 'openid-client';

// The contract a provider adapter implements, and the registry it lands in.
//
// ⚠️ NO PROVIDER IS IMPLEMENTED IN THIS DIRECTORY, AND THAT IS THE TEST.
// The credential store, the OAuth routes, the accessor and the refresh cycle
// are finished when a second provider can join by adding a `ProviderDefinition`
// and nothing else. If adding one requires editing a table, an RPC, the
// callback or `credentials.ts`, this layer is not generic yet and the fix
// belongs there rather than in a special case here.
//
// That is also why `provider` is `text` in the database and not an enum: a new
// provider must never be a migration. `ProviderId` is a plain string for the
// same reason — a union here would put every provider in this file's diff.

export type ProviderId = string;

/**
 * How a credential is ACQUIRED and RENEWED — nothing else.
 *
 * ⚠️ FOUR SEPARATE SOURCES ANSWER FOUR SEPARATE QUESTIONS, and collapsing any
 * two of them into this one is how a generic layer stops being generic:
 *
 *   credential_kind     how it is acquired and by what mechanism it renews
 *   the stored secret   which tokens were ACTUALLY issued and exist right now
 *   server metadata     which endpoints the provider publishes (e.g. revocation)
 *   presentation        how the credential is attached to an API request
 *
 * `'oauth2'` was the first draft and carried all four. It broke on the first
 * honest example: an API key presented as `Authorization: Bearer <key>` has the
 * same PRESENTATION as an OAuth2 token and a completely different ACQUISITION,
 * while the same key at another provider arrives as `X-Api-Key` — same
 * acquisition, different presentation. One column carrying both axes needs
 * `api_key_bearer`, `api_key_header`, `api_key_query`, … which is a new value
 * per provider, i.e. the migration-per-provider this layer exists to avoid.
 *
 * `api_key` and `basic` therefore collapse into `static`: to the STORE they are
 * identical — operator-supplied, no refresh, no revocation — and their only
 * difference was presentation, which now lives separately.
 */
export type CredentialKind =
  /** Redirect + callback + PKCE. Renews with `refreshTokenGrant`, when a refresh token was issued. */
  | 'oauth2_authorization_code'
  /** Server to server, no user and no callback. Renews by re-running the grant. */
  | 'oauth2_client_credentials'
  /** Supplied by an operator. No automatic renewal. */
  | 'static';

/**
 * How the credential is attached to an outgoing request.
 *
 * ⚠️ DECLARATIVE, NOT A CALLBACK, AND THAT IS A SECURITY PROPERTY. An adapter
 * that attached the credential itself would have to RECEIVE it, making every
 * adapter a place secret material can be logged or leaked. Declared this way,
 * only the accessor ever holds it — the same reason `providerFetch` returns a
 * `Response` and never a token.
 */
export type CredentialPresentation =
  | { type: 'bearer' }
  | { type: 'header'; name: string; prefix?: string }
  | { type: 'query'; name: string };

/**
 * A capability is what a workflow node asks for — "write a calendar event",
 * "send a message" — never a scope string and never a connection id. The
 * accessor resolves capability → connection → token, so a node never names,
 * holds, or can leak credential material.
 */
export type Capability = string;

/**
 * What every OAuth2 flow needs, whichever grant it uses.
 *
 * Split from the flow-specific halves below because the library draws the same
 * line: `Configuration` takes server metadata, client id, client metadata and a
 * `ClientAuth`, and is then handed unchanged to `authorizationCodeGrant`,
 * `refreshTokenGrant` and `clientCredentialsGrant` alike. Everything that
 * differs between grants is passed per call, not held on the configuration.
 */
export type ProviderOAuthCommonConfig = {
  /**
   * A discovery URL when the provider publishes one, or literal server metadata
   * when it does not — `new Configuration(serverMetadata, …)` accepts the second
   * form, so a plain-OAuth2 provider with no discovery document is not a special
   * case.
   */
  server: URL | ServerMetadata;

  /**
   * How the client authenticates at the token endpoint. **Required, and three
   * values rather than two.**
   *
   * ⚠️ The library's default is CONDITIONAL, which is exactly why we do not rely
   * on it: *"The default is `ClientSecretPost` if `ClientMetadata.client_secret`
   * is present, `None` otherwise."* A provider whose secret is missing for any
   * reason would silently downgrade to public-client authentication instead of
   * failing. Client authentication is one of the two most security-sensitive
   * fields in this contract, so a provider states it outright.
   *
   * `'none'` is a legitimate value, not an escape hatch: `None()` sends
   * `client_id` as a form parameter and no secret, which is correct for a public
   * client. `private_key_jwt` and mTLS exist in the library and are deliberately
   * absent here — adding them later widens this union without touching the
   * database.
   */
  clientAuth: 'post' | 'basic' | 'none';

  /**
   * Capability → the scopes it needs. `startConnection` unions the requested
   * capabilities' scopes; the accessor matches a stored connection's `scopes`
   * against them when resolving.
   */
  capabilities: Record<Capability, string[]>;
};

/**
 * Authorization-code only. `buildAuthorizationUrl` supplies `client_id` and
 * `response_type` itself, so this carries only what a specific provider adds on
 * top — most commonly the flags some require before they will issue a refresh
 * token at all.
 */
export type AuthorizationCodeOAuthConfig = ProviderOAuthCommonConfig & {
  authorizationParams?: Record<string, string>;
};

/**
 * Client-credentials needs nothing beyond the common configuration: no redirect,
 * no PKCE, no state, and `clientCredentialsGrant(config, parameters?)` takes its
 * parameters per call.
 *
 * Named rather than aliased inline so the discriminated union reads
 * symmetrically and a future addition has somewhere to land.
 *
 * ⚠️ NO SHARED `tokenEndpointParams` FIELD, DELIBERATELY. Each grant accepts its
 * own parameters — `authorizationCodeGrant`, `refreshTokenGrant` and
 * `clientCredentialsGrant` all take a separate argument — so one shared field
 * would invent a coupling the library does not have. It gets added when a
 * provider actually needs it, per operation, not in anticipation.
 */
export type ClientCredentialsOAuthConfig = ProviderOAuthCommonConfig;

export type ProviderRequest = {
  url: string;
  init?: RequestInit;
};

type ProviderDefinitionBase = {
  id: ProviderId;

  /** Operator-facing name. Used for the default connection label. */
  displayName: string;

  /**
   * How the accessor attaches this provider's credential. **Required.**
   *
   * No implicit default, for the same reason as `clientAuth`: these are the two
   * most security-sensitive fields in the contract, and a silent fallback to
   * bearer would mean a provider that wanted a custom header quietly sent its
   * credential somewhere it does not belong.
   */
  presentation: CredentialPresentation;

  /**
   * Turns a capability plus the node's input into a request. Keeps provider URLs
   * and payload shapes out of node handlers — a handler says what it wants, the
   * adapter says where that goes, and the accessor attaches the credential.
   */
  endpoint(capability: Capability, input: unknown): ProviderRequest;

  /**
   * Optional. Called once after a connection is established, with the provider's
   * own account response, so a connection can be labelled with something an
   * operator recognises instead of a uuid.
   */
  describeAccount?(response: Response): Promise<{ label: string; metadata?: unknown }>;
};

/**
 * Discriminated on `credentialKind`, so the compiler enforces what the flow
 * already requires: an authorization-code provider cannot omit its OAuth block,
 * a client-credentials provider cannot declare authorization parameters it will
 * never send, and a `static` provider cannot carry OAuth configuration at all.
 *
 * `oauth?: never` on the static arm is the part that earns this shape. Without
 * it a `static` provider could hold an OAuth block that nothing would ever read
 * — configuration that looks meaningful and is not.
 */
export type ProviderDefinition =
  | (ProviderDefinitionBase & {
      credentialKind: 'oauth2_authorization_code';
      oauth: AuthorizationCodeOAuthConfig;
    })
  | (ProviderDefinitionBase & {
      credentialKind: 'oauth2_client_credentials';
      oauth: ClientCredentialsOAuthConfig;
    })
  | (ProviderDefinitionBase & {
      credentialKind: 'static';
      oauth?: never;
    });

// Module-level, like the SDK's own plugin registries: registration happens once
// at import time and the map is read on every resolve. A duplicate id REPLACES
// rather than appends, so a hot reload cannot stack two definitions for one
// provider.
const registry = new Map<ProviderId, ProviderDefinition>();

export function registerProvider(definition: ProviderDefinition): void {
  registry.set(definition.id, definition);
}

/**
 * Look a provider up. Returns `undefined` for an unknown id rather than
 * throwing: the id reaches this function from a stored row, and a connection to
 * a provider that has since been removed from the build is a configuration
 * problem to report, not a crash.
 *
 * ⚠️ `Map.get` and not object indexing — a provider id arrives from the
 * database as arbitrary text, and a plain object would resolve `'constructor'`
 * off `Object.prototype` and hand back a function. The same hazard the workflow
 * engine's `isKnownNodeType` guard closes in `activity-runner.ts`.
 */
export function getProvider(id: ProviderId): ProviderDefinition | undefined {
  return registry.get(id);
}

export function listProviders(): ProviderDefinition[] {
  return [...registry.values()];
}

/** Test seam. Never called by application code. */
export function __resetProviderRegistryForTests(): void {
  registry.clear();
}
