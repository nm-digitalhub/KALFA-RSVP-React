import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
  type AuthInfo,
} from '@modelcontextprotocol/server';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { getMcpTokenVerifier, grantedOwnerAgentPermissions } from '@/lib/owner-agent/mcp/oauth';
import { isAllowedMcpOrigin, mcpResourceUrl } from './auth';
import { createMcpServer } from './tools';

export const runtime = 'nodejs';

// Every request: Origin check → Supabase OAuth access token (requireBearerAuth:
// a missing/invalid token gets 401 + WWW-Authenticate with resource_metadata,
// so the client can discover Supabase Auth) → the caller's platform
// permissions, resolved from the token's `sub` → only those tools.
// See src/lib/owner-agent/mcp/oauth.ts for what is validated and why.

type GrantedAuthInfo = AuthInfo & { extra: { userId: string; granted: ReadonlySet<string>; origin: string } };

const mcpHandler = createMcpHandler(
  (ctx) => {
    const extra = (ctx.authInfo as GrantedAuthInfo | undefined)?.extra;
    return createMcpServer(extra?.granted ?? new Set(), extra?.origin);
  },
  {
    legacy: 'stateless',
    onerror: () => {
      console.error('[owner-mcp] request_failed');
    },
  },
);

async function handleMcpRequest(request: NextRequest): Promise<Response> {
  if (!isAllowedMcpOrigin(request)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const resourceUrl = await mcpResourceUrl();
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(resourceUrl);
  const auth = await requireBearerAuth({ verifier: getMcpTokenVerifier(), resourceMetadataUrl })(request);
  if (auth instanceof Response) return auth;

  const userId = auth.extra?.userId;
  if (typeof userId !== 'string') {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  let granted: ReadonlySet<string>;
  try {
    granted = await grantedOwnerAgentPermissions(userId);
  } catch {
    console.error('[owner-mcp] permission_lookup_failed');
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
  // Not platform staff, or staff without any owner-agent permission.
  if (granted.size === 0) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const authInfo: GrantedAuthInfo = { ...auth, extra: { userId, granted, origin: resourceUrl.origin } };
  return mcpHandler.fetch(request, { authInfo });
}

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
