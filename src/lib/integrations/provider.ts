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

/** What kind of material the connection's vault secret holds. */
export type CredentialKind = 'oauth2' | 'api_key' | 'basic';

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

  /** Present only when `credentialKind === 'oauth2'`. */
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
