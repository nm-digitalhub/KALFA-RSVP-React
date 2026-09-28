import { createMcpHandler } from '@modelcontextprotocol/server';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { createMcpServer } from './tools';
import { validateMcpToken } from './auth';

export const runtime = 'nodejs';

const mcpHandler = createMcpHandler(() => createMcpServer(), {
  legacy: 'stateless',
  onerror: () => {
    console.error('[owner-mcp] request_failed');
  },
});

async function handleMcpRequest(request: NextRequest): Promise<Response> {
  if (!validateMcpToken(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  return mcpHandler.fetch(request);
}

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
