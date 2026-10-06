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

export type ProviderOAuthConfig = {
  /**
   * A discovery URL when the provider publishes one, or literal server
   * metadata when it does not. `openid-client` accepts both — plain OAuth2
   * providers with no discovery document are not a special case.
   */
  server: URL | ServerMetadata;

  /**
   * Where the client secret goes at the token endpoint. Providers differ and
   * neither is a safe assumption, so the adapter states it. `openid-client`
   * defaults to `post` when omitted.
   */
  clientAuth?: 'post' | 'basic';

  /**
   * Extra authorization-request parameters. This is where a provider's
   * requirements for issuing a refresh token at all live — several will not
   * issue one without an explicit flag, and some require it again on
   * re-authorization. Declared per provider so no branch for it exists in the
   * shared flow.
   */
  authorizationParams?: Record<string, string>;

  /**
   * Capability → the scopes that capability needs. `startConnection` unions the
   * requested capabilities' scopes; the accessor matches a stored connection's
   * `scopes` against them when resolving.
   */
  capabilities: Record<Capability, string[]>;
};

export type ProviderRequest = {
  url: string;
  init?: RequestInit;
};

export type ProviderDefinition = {
  id: ProviderId;
  credentialKind: CredentialKind;

  /** Operator-facing name. Used for the default connection label. */
  displayName: string;

  /** How the accessor attaches this provider's credential. Defaults to bearer. */
  presentation?: CredentialPresentation;

  /**
   * Present for both OAuth2 kinds. Optional on purpose: `authorization` must not
   * be assumed to mean "a redirect" — the library also implements Device
   * Authorization and CIBA, which poll instead, and a `static` provider has no
   * authorization step at all.
   */
  oauth?: ProviderOAuthConfig;

  /**
   * Turns a capability plus the node's input into a request. Keeps provider
   * URLs and payload shapes out of node handlers — a handler says what it
   * wants, the adapter says where that goes, and the accessor attaches the
   * credential.
   */
  endpoint(capability: Capability, input: unknown): ProviderRequest;

  /**
   * Optional. Called once after a connection is established, with the
   * provider's own account response, so a connection can be labelled with
   * something an operator recognises instead of a uuid.
   */
  describeAccount?(response: Response): Promise<{ label: string; metadata?: unknown }>;
};

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
