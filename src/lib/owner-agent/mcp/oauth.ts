import 'server-only';

import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthMetadata } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { getPublicSupabaseEnv } from '@/lib/supabase/env';
import { OWNER_AGENT_PERMISSIONS, type OwnerAgentPermission } from '@/lib/owner-agent/tools/shared';

// The HTTP MCP endpoint (/api/mcp) as an OAuth 2.1 Resource Server whose
// Authorization Server is Supabase Auth (docs: auth/oauth-server, read in full
// 2026-09-28). What that means here:
//
//  - A client finds Supabase from our RFC 9728 Protected Resource Metadata
//    (/.well-known/oauth-protected-resource/api/mcp) and gets a Supabase access
//    token through /oauth/consent.
//  - The token is a Supabase JWT. We validate exactly what "Token validation →
//    What to validate" lists: signature (ES256, the project's JWKS), `iss`,
//    `aud = authenticated`, `exp`, and `client_id` — which must be a client we
//    registered by hand (KALFA_MCP_OAUTH_CLIENT_IDS; dynamic registration is
//    off, and an empty list rejects every token).
//  - Supabase has no custom scopes ("Custom scopes are not currently
//    supported"), so a scope can never mean `view_events`. The tools a caller
//    gets come from `sub` alone: the staff member's platform permissions,
//    resolved server-side with has_platform_permission_for_user (which also
//    requires a platform_staff row). A user who is not staff gets nothing.
//  - The tools read through the service-role client, so RLS does NOT narrow
//    what they return. The permission check above is the whole boundary, and
//    it runs on every request.

/** Supabase access tokens are signed with the project's asymmetric key (JWKS: ES256 only, measured 2026-09-28). */
const ALGORITHMS = ['ES256'];
const AUDIENCE = 'authenticated';

export function supabaseAuthIssuer(): string {
  return `${getPublicSupabaseEnv().url.replace(/\/+$/, '')}/auth/v1`;
}

/**
 * RFC 8414 metadata for Supabase Auth, as its discovery document publishes it
 * (/.well-known/oauth-authorization-server/auth/v1). Only the fields the MCP
 * SDK needs to build our Protected Resource Metadata.
 */
export function supabaseAuthServerMetadata(): OAuthMetadata {
  const issuer = supabaseAuthIssuer();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
  };
}

/** The OAuth clients allowed to call /api/mcp. Unset or empty = none (fail closed). */
export function allowedMcpClientIds(raw: string | undefined = process.env.KALFA_MCP_OAUTH_CLIENT_IDS): ReadonlySet<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

const claimsSchema = z.object({
  sub: z.uuid(),
  role: z.literal('authenticated'),
  client_id: z.string().min(1),
  exp: z.number().int(),
  scope: z.string().optional(),
});

export interface McpTokenVerifierOptions {
  issuer: string;
  jwks: JWTVerifyGetKey;
  allowedClientIds: ReadonlySet<string>;
}

function invalidToken(): never {
  // One generic reason for every failure: nothing about WHY reaches the caller.
  throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid access token');
}

/** Validates a Supabase OAuth access token; the result's `extra.userId` is the token's `sub`. */
export function createMcpTokenVerifier(opts: McpTokenVerifierOptions) {
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      let payload: unknown;
      try {
        ({ payload } = await jwtVerify(token, opts.jwks, {
          issuer: opts.issuer,
          audience: AUDIENCE,
          algorithms: ALGORITHMS,
        }));
      } catch (e) {
        // A JWKS that cannot be fetched is our outage, not a bad token.
        if (e instanceof joseErrors.JWKSTimeout) {
          throw new OAuthError(OAuthErrorCode.ServerError, 'Token verification unavailable');
        }
        invalidToken();
      }
      const claims = claimsSchema.safeParse(payload);
      if (!claims.success) invalidToken();
      // A session token (no client_id) or a client we never registered.
      if (!opts.allowedClientIds.has(claims.data.client_id)) invalidToken();

      return {
        token,
        clientId: claims.data.client_id,
        scopes: claims.data.scope?.split(' ').filter(Boolean) ?? [],
        expiresAt: claims.data.exp,
        extra: { userId: claims.data.sub },
      };
    },
  };
}

let remoteJwks: { issuer: string; get: JWTVerifyGetKey } | null = null;

/** The production verifier: Supabase's JWKS (cached by jose), the configured client allowlist. */
export function getMcpTokenVerifier() {
  const issuer = supabaseAuthIssuer();
  if (remoteJwks?.issuer !== issuer) {
    remoteJwks = { issuer, get: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) };
  }
  return createMcpTokenVerifier({ issuer, jwks: remoteJwks.get, allowedClientIds: allowedMcpClientIds() });
}

/**
 * The owner-agent permissions `userId` holds, resolved server-side — the same
 * per-key RPC the report path uses (reports/report.ts). Throws on an RPC error
 * so a database failure never reads as "no permissions" or as a grant.
 */
export async function grantedOwnerAgentPermissions(userId: string): Promise<ReadonlySet<OwnerAgentPermission>> {
  const admin = createAdminClient();
  const results = await Promise.all(
    OWNER_AGENT_PERMISSIONS.map(async (key) => {
      const { data, error } = await admin.rpc('has_platform_permission_for_user', { _user_id: userId, _key: key });
      if (error) throw new Error('mcp_permission_lookup_failed');
      return data === true ? key : null;
    }),
  );
  return new Set(results.filter((key): key is OwnerAgentPermission => key !== null));
}
