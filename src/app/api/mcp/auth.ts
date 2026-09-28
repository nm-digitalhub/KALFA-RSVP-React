import type { NextRequest } from 'next/server';

export function validateMcpToken(request: NextRequest): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7);
  const secureToken = process.env.KALFA_MCP_SECRET_TOKEN;

  if (!secureToken || secureToken.length < 16) {
    console.error('MCP Init Error: KALFA_MCP_SECRET_TOKEN is not set or too weak.');
    return false;
  }

  return token === secureToken;
}
