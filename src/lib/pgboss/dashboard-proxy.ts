import type { NextRequest } from 'next/server';

import { requireAdmin } from '@/lib/auth/dal';

// Shared authenticated reverse-proxy for the pg-boss ops dashboard.
//
// The dashboard (@pg-boss/dashboard) is a standalone HTTP server built with a
// baked base path of `/admin/jobs`, listening only on loopback, with NO auth of
// its own — access is gated here by requireAdmin(), reusing the same Supabase
// admin session as the rest of /admin.
//
// This lives in a shared module because the dashboard's URL space does NOT fit
// under a single Next segment. It is a React Router app, and React Router asks
// for a route's data by appending `.data` to the ROUTE PATH:
//
//   Jobs      /admin/jobs/jobs    → /admin/jobs/jobs.data    child of /admin/jobs
//   Queues    /admin/jobs/queues  → /admin/jobs/queues.data  child of /admin/jobs
//   Overview  /admin/jobs         → /admin/jobs.data         SIBLING, not a child
//
// `admin/jobs/[[...path]]` matches `/admin/jobs` and `/admin/jobs/**`, so it
// covers every page's data request EXCEPT the index route's — `jobs.data` is a
// different segment from `jobs`. That one URL fell through to Next's own 404,
// React Router got an HTML error page where it expected its data stream, and
// rendered its 404 boundary INSIDE the layout: full sidebar, "404 The requested
// page could not be found" in the content. Server-rendered first loads were
// fine, so it only appeared on client-side navigation to Overview.
//
// Verified live (2026-07-21) before and after: the upstream served
// /admin/jobs.data 200 the whole time — the request simply never reached it.
// The network log showed 404 for /admin/jobs.data alongside 200 for
// /admin/jobs/queues.data and /admin/jobs/jobs.data.

// Loopback upstream — the base-path dashboard build (pm2 "kalfa-pgboss-ui").
export const UPSTREAM =
  process.env.PGBOSS_DASHBOARD_UPSTREAM ?? 'http://127.0.0.1:3011';

// The dashboard serves everything under this prefix (baked at build time), so
// requests are forwarded WITH the prefix intact.
export const BASE_PATH = '/admin/jobs';

// Hop-by-hop / encoding headers that must not be copied verbatim when
// re-streaming, or the browser sees a length/encoding mismatch.
const STRIP_RESPONSE_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
];

// `upstreamPath` is the FULL path on the dashboard, prefix included. Callers
// build it; this function never guesses, so the two route files stay explicit
// about which part of the dashboard's URL space they own.
export async function proxyToDashboard(
  request: NextRequest,
  upstreamPath: string,
): Promise<Response> {
  // Redirects unauthenticated users and non-admins (server-side, trusted).
  await requireAdmin();

  const target = `${UPSTREAM}${upstreamPath}${request.nextUrl.search}`;

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
