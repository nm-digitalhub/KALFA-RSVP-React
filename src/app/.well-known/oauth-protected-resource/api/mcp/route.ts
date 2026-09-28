import { oauthMetadataResponse } from '@modelcontextprotocol/server';
import { NextResponse } from 'next/server';

import { mcpResourceUrl } from '@/app/api/mcp/auth';
import { supabaseAuthServerMetadata } from '@/lib/owner-agent/mcp/oauth';

export const runtime = 'nodejs';

// RFC 9728 Protected Resource Metadata for /api/mcp: names Supabase Auth as the
// Authorization Server. The 401 from /api/mcp points here (WWW-Authenticate
// resource_metadata=…), and an MCP client follows it to Supabase's own RFC 8414
// document. Built by the MCP SDK (JSON, permissive CORS, 405 for non-GET).
async function handle(request: Request): Promise<Response> {
  const response = oauthMetadataResponse(request, {
    oauthMetadata: supabaseAuthServerMetadata(),
    resourceServerUrl: await mcpResourceUrl(),
    resourceName: 'KALFA owner MCP',
  });
  return response ?? new NextResponse('Not Found', { status: 404 });
}

export const GET = handle;
export const OPTIONS = handle;
