import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth/dal';

// Authenticated reverse-proxy for the pg-boss ops dashboard.
//
// The dashboard (@pg-boss/dashboard) is a standalone HTTP server built with a
// baked base path of `/admin/jobs` and listening only on loopback. It has NO
// auth of its own — access is gated HERE by requireAdmin(), reusing the same
// Supabase admin session as the rest of /admin. That removes the second
// password prompt and keeps the dashboard off the public internet entirely.
//
// The (admin) layout does NOT wrap route handlers, so the admin check must live
// in the handler. The dashboard is pure HTTP (SSR + polling, no WebSocket/SSE),
// so a streaming Response proxy is sufficient.

export const dynamic = 'force-dynamic';

// Loopback upstream — the base-path dashboard build (pm2 "kalfa-pgboss-ui").
const UPSTREAM =
  process.env.PGBOSS_DASHBOARD_UPSTREAM ?? 'http://127.0.0.1:3011';
// The dashboard serves everything under this prefix (baked at build time), so
// requests are forwarded WITH the prefix intact.
const BASE_PATH = '/admin/jobs';

// Hop-by-hop / encoding headers that must not be copied verbatim when
// re-streaming, or the browser sees a length/encoding mismatch.
const STRIP_RESPONSE_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
];

async function proxy(
  request: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  // Redirects unauthenticated users and non-admins (server-side, trusted).
  await requireAdmin();

  const { path } = await ctx.params;
  const suffix = path?.length ? `/${path.map(encodeURIComponent).join('/')}` : '';
  const target = `${UPSTREAM}${BASE_PATH}${suffix}${request.nextUrl.search}`;

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');
  // Force an uncompressed upstream response so re-streaming can't produce a
  // content-encoding/length mismatch.
  headers.delete('accept-encoding');

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    // Required by undici when streaming a request body.
    init.duplex = 'half';
  }

  const upstream = await fetch(target, init);

  const responseHeaders = new Headers(upstream.headers);
  for (const name of STRIP_RESPONSE_HEADERS) responseHeaders.delete(name);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
  proxy as OPTIONS,
};
