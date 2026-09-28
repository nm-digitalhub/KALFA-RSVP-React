import 'server-only';

import type { NextRequest } from 'next/server';

import { getAppOrigin } from '@/lib/url';

// Authentication itself is Supabase OAuth (src/lib/owner-agent/mcp/oauth.ts).
// The static KALFA_MCP_SECRET_TOKEN bearer this file used to check is gone: it
// carried no user, so it could not be tied to a staff member's permissions.

/** This MCP server's public URL — the RFC 9728 `resource` identifier. */
export async function mcpResourceUrl(): Promise<URL> {
  return new URL('/api/mcp', await getAppOrigin());
}

export function isAllowedMcpOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true;

  const allowed = (process.env.KALFA_MCP_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  try {
    const normalizedOrigin = new URL(origin).origin;
    return allowed.some((value) => new URL(value).origin === normalizedOrigin);
  } catch {
    return false;
  }
}
