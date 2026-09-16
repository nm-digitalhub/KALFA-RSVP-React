import 'server-only';

import type { IntegrationsPort } from '@/lib/workflow/engine/ports';

import {
  createAuthenticatedIntegrationRequest,
  type AuthenticatedIntegrationRequest,
} from './authenticated-request';
import { registerBuiltInProviders } from './providers';

export function createIntegrationRuntime(
  deps: { request?: AuthenticatedIntegrationRequest } = {},
): IntegrationsPort {
  registerBuiltInProviders();
  const request = deps.request ?? createAuthenticatedIntegrationRequest();

  return {
    async execute(args) {
      const response = await request(args);
      return { status: response.status };
    },
  };
}
