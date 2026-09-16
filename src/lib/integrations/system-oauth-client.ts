import 'server-only';

/**
 * Deployment-level OAuth client credentials.
 *
 * These are the credentials of KALFA itself as an OAuth application, not a
 * user's connected account. They are deliberately separate from the existing
 * app-only Microsoft Graph certificate configuration (`MS_GRAPH_*`).
 *
 * Naming is generic so adding another OAuth provider does not require changing
 * this module. A provider id such as `microsoft` maps to:
 *
 *   INTEGRATION_OAUTH_MICROSOFT_CLIENT_ID
 *   INTEGRATION_OAUTH_MICROSOFT_CLIENT_SECRET
 *
 * Database-backed provider configuration remains authoritative when a row
 * exists. This module is only the system/deployment fallback used when no row
 * has been configured in `integration_provider_configs`.
 */
export type SystemOAuthClient = {
  clientId: string;
  clientSecret: string;
};

export function systemOAuthEnvKeys(providerId: string): {
  clientId: string;
  clientSecret: string;
} {
  const key = providerId
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

  return {
    clientId: `INTEGRATION_OAUTH_${key}_CLIENT_ID`,
    clientSecret: `INTEGRATION_OAUTH_${key}_CLIENT_SECRET`,
  };
}

export function readSystemOAuthClient(
  providerId: string,
): SystemOAuthClient | null {
  const keys = systemOAuthEnvKeys(providerId);
  const clientId = process.env[keys.clientId]?.trim() ?? '';
  const rawSecret = process.env[keys.clientSecret] ?? '';

  // A half-configured client is intentionally treated as unavailable. The OAuth
  // loader will then fail with the same generic "provider not configured" path
  // rather than attempting a token exchange with partial credentials.
  if (!clientId || rawSecret.trim().length === 0) return null;

  // Do not trim the secret that is actually used for client authentication.
  return { clientId, clientSecret: rawSecret };
}

/**
 * Boolean-only probe for Server Components and status surfaces. This keeps the
 * secret from being materialized into UI-facing module state when the caller
 * only needs to know whether a complete deployment client exists.
 */
export function hasSystemOAuthClient(providerId: string): boolean {
  return readSystemOAuthClient(providerId) !== null;
}
