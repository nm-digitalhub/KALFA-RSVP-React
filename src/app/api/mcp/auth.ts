import { timingSafeEqual } from 'node:crypto';

import type { NextRequest } from 'next/server';

function equalTokens(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

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

  return equalTokens(token, secureToken);
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
