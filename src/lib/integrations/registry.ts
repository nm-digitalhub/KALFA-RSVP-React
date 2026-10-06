import 'server-only';

import { getProvider, type ProviderDefinition } from './provider';
import { registerBuiltInProviders } from './providers';

/**
 * Look up a provider, having made sure the registry is populated.
 *
 * The registry is module state, and a route handler is not guaranteed to have
 * gone through whatever else populates it — `createIntegrationRuntime` does it
 * for the workflow worker, but an OAuth callback arrives on a cold path of its
 * own. Registration is replacement-safe, so calling it here costs a Map write
 * and removes an ordering dependency nobody would think to look for.
 */
export function resolveProvider(providerId: string): ProviderDefinition | undefined {
  registerBuiltInProviders();
  return getProvider(providerId);
}
