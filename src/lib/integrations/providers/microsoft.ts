import 'server-only';

import { registerProvider, type ProviderDefinition } from '../provider';
import {
  MICROSOFT_GRAPH_ORIGIN,
  microsoftGraphRequest,
} from '../transports/microsoft-graph';

export const MICROSOFT_PROVIDER_ID = 'microsoft';

export const microsoftProvider = {
  id: MICROSOFT_PROVIDER_ID,
  displayName: 'Microsoft 365',
  credentialKind: 'oauth2_authorization_code',
  presentation: { type: 'bearer' },
  capabilities: {
    'mail.send': ['Mail.Send'],
  },
  apiOrigins: [MICROSOFT_GRAPH_ORIGIN],
  oauth: {
    server: new URL(
      'https://login.microsoftonline.com/organizations/v2.0/.well-known/openid-configuration',
    ),
    clientAuth: 'post',
    // Without this Microsoft returns NO refresh token at all — "Only provided
    // if `offline_access` scope was requested" — and the connection would die
    // at the first access-token expiry with no way back but re-consent.
    //
    // It sits here and not in `capabilities` because it is not a permission the
    // access token carries: Microsoft does not report it in the token
    // response's `scope`, so a runtime check for it could never pass.
    authorizationScopes: ['offline_access'],
  },
  endpoint: microsoftGraphRequest,
} satisfies ProviderDefinition;

export function registerMicrosoftProvider(): void {
  registerProvider(microsoftProvider);
}
