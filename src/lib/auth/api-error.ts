import 'server-only';

import { getURLFromRedirectError } from 'next/dist/client/components/redirect';
import { isRedirectError } from 'next/dist/client/components/redirect-error';

// Transport adapter for API consumers of the browser-oriented DAL guards.
// Only known auth destinations are translated; other framework/errors must
// retain their original behavior. Keep Next's digest parsing in Next itself.
export function platformAuthErrorResponse(error: unknown): Response | null {
  if (!isRedirectError(error)) return null;
  const destination = getURLFromRedirectError(error);
  if (destination !== '/auth/login' && destination !== '/access-denied') return null;

  const unauthenticated = destination === '/auth/login';
  return Response.json(
    { error: unauthenticated ? 'unauthorized' : 'forbidden' },
    {
      status: unauthenticated ? 401 : 403,
      headers: { 'Cache-Control': 'private, no-store' },
    },
  );
}
