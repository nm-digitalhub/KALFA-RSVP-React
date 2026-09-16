import 'server-only';

import { createCredentialAccessor, type CredentialAccessor } from './credential-accessor';
import { IntegrationRuntimeError, readIntegrationRuntimeError } from './errors';
import {
  getProvider,
  type CredentialPresentation,
  type ProviderDefinition,
} from './provider';

export type IntegrationRequestArgs = {
  provider: string;
  connectionId: string;
  capability: string;
  input: unknown;
};

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type AuthenticatedIntegrationRequest = (
  args: IntegrationRequestArgs,
) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 20_000;
const FORBIDDEN_PROVIDER_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'host',
] as const;

export function createAuthenticatedIntegrationRequest(
  deps: { credentials?: CredentialAccessor; fetchImpl?: FetchLike } = {},
): AuthenticatedIntegrationRequest {
  const credentials = deps.credentials ?? createCredentialAccessor();
  const fetchImpl = deps.fetchImpl ?? fetch;

  return async (args) => {
    const provider = getProvider(args.provider);
    if (!provider) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_provider_unknown',
        `Integration provider "${args.provider}" is not registered.`,
      );
    }

    if (!Object.hasOwn(provider.capabilities, args.capability)) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_capability_unsupported',
        `Integration provider "${provider.id}" does not support "${args.capability}".`,
      );
    }
    const requiredScopes = provider.capabilities[args.capability] ?? [];

    let providerRequest;
    try {
      providerRequest = provider.endpoint(args.capability, args.input);
    } catch (error) {
      if (readIntegrationRuntimeError(error)) throw error;
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_input_invalid',
        'Integration operation input is invalid.',
        { cause: error },
      );
    }

    // Validated on a TEMPLATE, once. The checks are about what the adapter
    // produced, and that does not change between attempts — while the objects a
    // request is actually sent with must be rebuilt per attempt, because
    // attaching a credential mutates them.
    const templateUrl = new URL(providerRequest.url.href);
    validateDestination(provider, templateUrl);

    let templateHeaders: Headers;
    try {
      templateHeaders = new Headers(providerRequest.init?.headers);
    } catch (cause) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_request_invalid_headers',
        'Integration provider produced invalid request headers.',
        { cause },
      );
    }

    for (const name of FORBIDDEN_PROVIDER_HEADERS) {
      if (templateHeaders.has(name)) {
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_request_forbidden_header',
          `Integration provider attempted to set forbidden header "${name}".`,
        );
      }
    }
    validateCredentialSlot(provider.presentation, templateHeaders, templateUrl);

    /**
     * One attempt. Builds a fresh URL and a fresh Headers every time.
     *
     * ⚠️ NEVER REUSE THE OBJECTS FROM A PREVIOUS ATTEMPT. `attachCredential`
     * writes the credential INTO them, so replaying with the same Headers would
     * re-send the token that just earned a 401 — and for the `query`
     * presentation, `searchParams.set` on an already-stamped URL would leave the
     * stale value if the refresh returned the same token under a different name.
     */
    const send = async (credential: string): Promise<Response> => {
      const url = new URL(providerRequest.url.href);
      const headers = new Headers(templateHeaders);
      attachCredential(provider.presentation, credential, headers, url);

      try {
        return await fetchImpl(url, {
          ...providerRequest.init,
          headers,
          redirect: 'manual',
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (cause) {
        const timedOut =
          cause instanceof Error &&
          (cause.name === 'AbortError' || cause.name === 'TimeoutError');
        throw new IntegrationRuntimeError(
          'transient',
          timedOut ? 'integration_request_timeout' : 'integration_network_error',
          timedOut
            ? 'Integration provider request timed out.'
            : 'Integration provider request failed before a response was received.',
          { cause },
        );
      }
    };

    // Secret material is read only after the request destination and headers have
    // passed the egress checks above.
    let response = await send(
      await credentials.resolve({
        connectionId: args.connectionId,
        provider,
        requiredScopes,
      }),
    );

    // ⚠️ THE FIRST 401 IS NOT AN ERROR. It is a lifecycle event: the credential
    // we hold is spent, and the expiry we stored — if the server ever gave one —
    // was wrong or absent. Turning it into an `IntegrationRuntimeError` here
    // would make `permanent` mean "the provider said no once", which is exactly
    // the reading that killed connections before the refresh path existed.
    //
    // 403 IS DELIBERATELY NOT IN THIS BRANCH. It is permission, policy or a
    // conditional-access challenge — states a new access token does not resolve,
    // and which re-consent may not resolve either. Refreshing on 403 would spend
    // a refresh token to learn nothing.
    if (response.status === 401) {
      await discardBody(response);

      if (!isReplayable(providerRequest.init?.body)) {
        // A stream body was already consumed by the first attempt, so a replay
        // would send an empty request and read its rejection as a second 401.
        // Saying so is better than retrying something that cannot work.
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_request_not_replayable',
          'The credential was rejected and the request body cannot be replayed.',
        );
      }

      // May throw — a refresh that fails permanently (no refresh token, a
      // revoked grant) has already recorded that on the connection.
      const refreshed = await credentials.refresh({
        connectionId: args.connectionId,
        provider,
        requiredScopes,
      });

      response = await send(refreshed);

      // EXACTLY ONE REPLAY. A provider that answers 401 to a freshly minted
      // token is not going to answer differently to a third; looping here would
      // burn refresh tokens against a wall, and with rotation each turn of the
      // loop invalidates the one before it.
      if (response.status === 401) {
        await discardBody(response);
        await credentials.markRequiresReauthorization({
          connectionId: args.connectionId,
          reason: 'the provider rejected a freshly refreshed access token',
        });
        throw new IntegrationRuntimeError(
          'permanent',
          'integration_auth_rejected',
          'The integration provider rejected a freshly refreshed credential; the connection must be authorized again.',
        );
      }
    }

    if (response.status >= 300 && response.status < 400) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_redirect_blocked',
        `Integration provider returned redirect status ${response.status}; authenticated redirects are blocked.`,
      );
    }
    if (response.ok) return response;

    if (response.status === 403) {
      // Not a token problem. See the note on the 401 branch: a 403 survives a
      // refresh, so classifying it as permanent is the honest answer rather than
      // a missed opportunity to retry.
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_forbidden',
        'The integration provider refused the operation for this connection.',
      );
    }
    if (response.status === 429) {
      throw new IntegrationRuntimeError(
        'transient',
        'integration_rate_limited',
        'Integration provider rate-limited the request.',
      );
    }
    if (response.status >= 500) {
      throw new IntegrationRuntimeError(
        'transient',
        'integration_provider_unavailable',
        `Integration provider returned HTTP ${response.status}.`,
      );
    }

    throw new IntegrationRuntimeError(
      'permanent',
      'integration_request_rejected',
      `Integration provider rejected the request with HTTP ${response.status}.`,
    );
  };
}

/**
 * Drain and close a response we are not going to read.
 *
 * An un-consumed body keeps its socket out of the pool in undici, and a 401 body
 * is the one we most want gone: it is the response we never surface, so nothing
 * else will ever read it. Never logged — a provider error body can echo request
 * material back.
 */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed or already errored. Nothing here is worth failing over.
  }
}

/** A stream body is gone once sent; anything else can be handed to fetch twice. */
function isReplayable(body: BodyInit | null | undefined): boolean {
  return !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream);
}

function validateDestination(provider: ProviderDefinition, url: URL): void {
  if (url.protocol !== 'https:') {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_destination_insecure',
      'Integration provider request destination must use HTTPS.',
    );
  }
  if (url.username || url.password) {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_destination_invalid',
      'Integration provider request destination must not contain URL credentials.',
    );
  }
  if (!provider.apiOrigins.includes(url.origin)) {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_destination_not_allowed',
      `Integration provider destination origin "${url.origin}" is not allowed.`,
    );
  }
}

function validateCredentialSlot(
  presentation: CredentialPresentation,
  headers: Headers,
  url: URL,
): void {
  if (presentation.type === 'bearer') return;

  if (presentation.type === 'header') {
    if (headers.has(presentation.name)) {
      throw new IntegrationRuntimeError(
        'permanent',
        'integration_credential_slot_occupied',
        `Integration provider request already contains credential header "${presentation.name}".`,
      );
    }
    return;
  }

  if (url.searchParams.has(presentation.name)) {
    throw new IntegrationRuntimeError(
      'permanent',
      'integration_credential_slot_occupied',
      `Integration provider request already contains credential query parameter "${presentation.name}".`,
    );
  }
}

function attachCredential(
  presentation: CredentialPresentation,
  credential: string,
  headers: Headers,
  url: URL,
): void {
  if (presentation.type === 'bearer') {
    headers.set('authorization', `Bearer ${credential}`);
    return;
  }

  if (presentation.type === 'header') {
    headers.set(
      presentation.name,
      `${presentation.prefix ?? ''}${credential}`,
    );
    return;
  }

  url.searchParams.set(presentation.name, credential);
}
